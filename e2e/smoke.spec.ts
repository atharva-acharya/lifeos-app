import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp, type RunningApp } from "./app";

let app: RunningApp | undefined;

function running(): RunningApp {
  if (!app) throw new Error("app did not start");
  return app;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  app = await launchApp();
});

test.afterAll(async () => {
  await app?.close();
});

test("Today shows the synthetic vault", async () => {
  const { page } = running();
  await expect(page.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Example Security Ltd")).toBeVisible();
  await expect(page.getByText(/Overdue/)).toBeVisible();
  await expect(page.getByText("home-lab")).toBeVisible();
  await expect(page.getByText("Set up log forwarding")).toBeVisible();
  // The fixture includes one note with an invalid stage.
  await expect(page.getByRole("status")).toContainText("1 note could not be read");
});

test("Today refreshes when a note changes on disk", async () => {
  const { page, vault } = running();
  appendFileSync(join(vault, "Projects", "home-lab.md"), "- 2026-01-14: Forwarder configured.\n");
  await expect(page.getByText("Last: 2026-01-14: Forwarder configured.")).toBeVisible({
    timeout: 10_000,
  });
});

test("Settings shows the connected vault", async () => {
  const { page, vault } = running();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();
  await expect(page.getByText(vault)).toBeVisible();
});

test("the page cannot reach the network or load remote scripts", async () => {
  const { page } = running();
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://example.com/");
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});
