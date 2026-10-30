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

/** Thrown on purpose by the diagnostics test; every other error fails. */
const PROBE = "e2e-probe";

test.afterEach(async () => {
  // Uncaught errors (for example from the frozen Object.prototype) blank the page.
  const { errors, page } = running();
  const seen = errors.splice(0).filter((e) => !e.includes(PROBE));
  expect(seen).toEqual([]);
  // A page caught by the error boundary is a failure too, even if nothing was uncaught.
  expect(await page.locator("[data-error-boundary]").count()).toBe(0);
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

test("Jobs shows the pipeline, outreach and saved applications", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Jobs" }).click();
  await expect(page.getByRole("listitem", { name: "Screen" })).toContainText(
    "Example Security Ltd",
  );
  await page.getByRole("tab", { name: "Outreach" }).click();
  await expect(page.getByText("Alex Example")).toBeVisible();
  await page.getByRole("tab", { name: "Applications" }).click();
  await expect(page.getByRole("cell", { name: "Sample Bank" })).toBeVisible();
  await expect(page.getByText("6 total")).toBeVisible();
  await expect(page.getByText("The Sheet is missing: message id.")).toBeVisible();
  // Offline copy only: no Google connection in the test profile, so no refresh.
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
});

test("Sheet values are shown as text, never run as markup", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Jobs" }).click();
  await page.getByRole("tab", { name: "Applications" }).click();
  await page.getByPlaceholder("Company, role or notes").fill("Contoso");
  await expect(page.getByRole("cell", { name: "Contoso Group" })).toBeVisible();
  expect(await page.locator("main img, main script").count()).toBe(0);
});

test("Charts are drawn from the saved copy", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Jobs" }).click();
  await page.getByRole("tab", { name: "Charts" }).click();
  await expect(page.getByRole("heading", { name: "Applications per week" })).toBeVisible();
  await expect(page.getByText(/This week/)).toContainText("This week 1");
  await expect(page.locator(".bar-chart__bar").first()).toBeVisible();
  await expect(page.getByRole("row", { name: "Company site 2 1 1 100%" })).toBeVisible();
  await expect(page.getByRole("row", { name: "LinkedIn Easy Apply 1 0 0 0%" })).toBeVisible();
  await expect(page.getByText(/1 reply not matched/)).toBeVisible();
});

test("Settings shows the connected vault", async () => {
  const { page, vault } = running();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByText("Connected")).toBeVisible();
  await expect(page.getByText(vault)).toBeVisible();
});

test("an uncaught error is logged locally and shown in Diagnostics", async () => {
  const { page } = running();
  await page.evaluate((probe) => {
    setTimeout(() => {
      throw new Error(probe);
    });
  }, PROBE);
  await page.getByRole("button", { name: "Today" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Diagnostics" })).toBeVisible();
  await expect(page.getByText("Version 0.2.0")).toBeVisible();
  await expect(page.getByText("1 recent error logged")).toBeVisible();
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
