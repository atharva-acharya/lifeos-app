import { chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EXE = join(ROOT, "src-tauri", "target", "debug", "lifeos-app.exe");
const FIXTURE_VAULT = join(ROOT, "src-tauri", "tests", "fixtures", "vault");
const PORT = 9333;

export interface RunningApp {
  page: Page;
  vault: string;
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

  const child: ChildProcess = spawn(EXE, [], {
    env: {
      ...process.env,
      LIFEOS_DATA_DIR: data,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${String(PORT)}`,
    },
    stdio: "ignore",
  });

  const browser = await connect();
  const page = await firstPage(browser);
  await page.waitForLoadState("domcontentloaded");

  return {
    page,
    vault,
    close: async () => {
      await browser.close().catch(() => undefined);
      child.kill();
    },
  };
}

async function connect(): Promise<Browser> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch (err) {
      if (Date.now() > deadline) throw err;
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
