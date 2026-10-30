import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXE = join(ROOT, "src-tauri", "target", "debug", "lifeos-app.exe");
const FIXTURE_VAULT = join(ROOT, "src-tauri", "tests", "fixtures", "vault");
const FIXTURE_CACHE = join(ROOT, "e2e", "fixtures", "applications.json");
const PORT = 9333;

export interface RunningApp {
  page: Page;
  vault: string;
  /** Uncaught page errors seen so far. */
  errors: string[];
  close: () => Promise<void>;
}

/** Starts the debug build against a copy of the synthetic vault in a throwaway data folder. */
export async function launchApp(): Promise<RunningApp> {
  const work = mkdtempSync(join(tmpdir(), "lifeos-e2e-"));
  const vault = join(work, "vault");
  const data = join(work, "data");
  cpSync(FIXTURE_VAULT, vault, { recursive: true });
  mkdirSync(data);
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

  const child: ChildProcess = spawn(EXE, [], {
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: data,
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
    close: async () => {
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
