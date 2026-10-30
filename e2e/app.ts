import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXE = join(ROOT, "src-tauri", "target", "debug", "lifeos-app.exe");
const FIXTURE_VAULT = join(ROOT, "src-tauri", "tests", "fixtures", "vault");
const FIXTURE_CACHE = join(ROOT, "e2e", "fixtures", "applications.json");
const FIXTURE_UPDATE = join(ROOT, "e2e", "fixtures", "update");

/**
 * Which forged update the local stand-in for GitHub Releases offers. The app
 * trusts a throwaway test key (`test-key.pub`) in these runs:
 * - "wrong-key": version 9.9.9 signed with a different key.
 * - "replay": a genuine signature for version 0.0.1 announced as 9.9.9 (a
 *   downgrade dressed up as an update).
 * Both must be refused. The app never contacts GitHub during tests.
 */
export type UpdateScenario = "wrong-key" | "replay";

async function startUpdateServer(): Promise<{
  server: Server;
  endpoint: string;
  use: (scenario: UpdateScenario) => void;
}> {
  const installer = readFileSync(join(FIXTURE_UPDATE, "fake-setup.exe"));
  const signatures: Record<UpdateScenario, string> = {
    "wrong-key": readFileSync(join(FIXTURE_UPDATE, "wrong-key.sig"), "utf8").trim(),
    replay: readFileSync(join(FIXTURE_UPDATE, "replay.sig"), "utf8").trim(),
  };
  let scenario: UpdateScenario = "wrong-key";
  const server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    if (req.url === "/latest.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          version: "9.9.9",
          notes: "Test update",
          pub_date: "2026-01-01T00:00:00Z",
          platforms: {
            "windows-x86_64": {
              signature: signatures[scenario],
              url: `http://127.0.0.1:${String(port)}/fake-setup.exe`,
            },
          },
        }),
      );
    } else if (req.url === "/fake-setup.exe") {
      res.end(installer);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    endpoint: `http://127.0.0.1:${String(port)}/latest.json`,
    use: (next) => {
      scenario = next;
    },
  };
}
const PORT = 9333;

export interface RunningApp {
  page: Page;
  vault: string;
  /** Uncaught page errors seen so far. */
  errors: string[];
  /** The app's stdout and stderr so far (for diagnosing failures). */
  output: () => string;
  /** Switches the forged update the local update server offers. */
  offerUpdate: (scenario: UpdateScenario) => void;
  close: () => Promise<void>;
}

/** `YYYY-MM-DD` for the local date `daysAgo` days before today. */
export function localDateAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("en-CA");
}

/**
 * Synthetic training data dated relative to today, so the Fitness page's
 * 90-day window always has readings: 20 daily notes with weight trending
 * down, steps and protein, and two workouts.
 */
function writeFitnessNotes(vault: string): void {
  mkdirSync(join(vault, "Daily"), { recursive: true });
  mkdirSync(join(vault, "Fitness", "Log"), { recursive: true });
  for (let i = 0; i < 20; i++) {
    const date = localDateAgo(i);
    const note = [
      "---",
      "type: daily",
      `date: ${date}`,
      `weight: ${(82 + i * 0.1).toFixed(1)}`,
      `steps: ${String(6000 + i * 150)}`,
      `protein_g: ${String(150 + (i % 3) * 15)}`,
      "---",
      "",
    ];
    writeFileSync(join(vault, "Daily", `e2e-${date}.md`), note.join("\n"));
  }
  const workout = (daysAgo: number, day: string, week: number, lines: string[]) => {
    const date = localDateAgo(daysAgo);
    const note = [
      "---",
      "type: workout",
      `date: ${date}`,
      `day: ${day}`,
      `week: ${String(week)}`,
      "deload: false",
      "duration_min: 60",
      "exercises:",
      ...lines.map((l) => `  - ${l}`),
      "---",
      "",
    ];
    writeFileSync(join(vault, "Fitness", "Log", `e2e-${date}.md`), note.join("\n"));
  };
  workout(2, "Pull A", 4, ["Deadlift 3 x 5 @ 130", "Barbell row 3 x 8 @ 70"]);
  workout(9, "Pull A", 3, ["Deadlift 3 x 5 @ 125"]);
}

/** Starts the debug build against a copy of the synthetic vault in a throwaway data folder. */
export async function launchApp(): Promise<RunningApp> {
  const work = mkdtempSync(join(tmpdir(), "lifeos-e2e-"));
  const vault = join(work, "vault");
  const data = join(work, "data");
  cpSync(FIXTURE_VAULT, vault, { recursive: true });
  mkdirSync(data);
  writeFitnessNotes(vault);
  writeFileSync(join(data, "settings.json"), JSON.stringify({ vaultPath: vault }));
  // A saved copy of the Sheet (synthetic, Sheet-style values), so the Jobs
  // tabs work without Google. One row is dated today for the weekly chart.
  const cache = JSON.parse(readFileSync(FIXTURE_CACHE, "utf8")) as {
    fetchedAt: number;
    rows: Record<string, string | null>[];
  };
  cache.fetchedAt = Date.now();
  cache.rows.push({
    applied: new Date().toLocaleDateString("en-CA"),
    company: "Today Example",
    role: "SOC Analyst",
    source: "Indeed",
    status: "Applied",
  });
  writeFileSync(join(data, "applications.json"), JSON.stringify(cache));

  const updates = await startUpdateServer();
  const child: ChildProcess = spawn(EXE, [], {
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: data,
      LIFEOS_UPDATE_ENDPOINT: updates.endpoint,
      LIFEOS_UPDATE_PUBKEY: readFileSync(join(FIXTURE_UPDATE, "test-key.pub"), "utf8").trim(),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${String(PORT)}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let exited: string | null = null;
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  child.on("error", (e) => (exited = `failed to start: ${e.message}`));
  child.on("exit", (code) => (exited = `exited with code ${String(code)}`));

  const describe = () => `app ${exited ?? "still running"}; output:\n${output || "(none)"}`;
  const browser = await connect(() => exited !== null, describe);
  const page = await firstPage(browser);
  await page.waitForLoadState("domcontentloaded");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  return {
    page,
    vault,
    errors,
    output: () => output,
    offerUpdate: updates.use,
    close: async () => {
      updates.server.close();
      await browser.close().catch(() => undefined);
      child.kill();
    },
  };
}

async function connect(hasExited: () => boolean, describe: () => string): Promise<Browser> {
  // A fresh CI runner can take a while to start WebView2 the first time.
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch (err) {
      if (hasExited() || Date.now() > deadline) {
        const detail = describe();
        console.error(detail);
        throw new Error(`could not connect to the app: ${detail}`, { cause: err });
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function firstPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .at(0);
    if (page) return page;
    if (Date.now() > deadline) throw new Error("app window did not open");
    await new Promise((r) => setTimeout(r, 250));
  }
}
