import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp, type RunningApp } from "./app";

let app: RunningApp | undefined;

function running(): RunningApp {
  if (!app) throw new Error("app did not start");
  return app;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  app = await launchApp({ vault: false, health: true });
});

test.afterAll(async () => {
  await app?.close();
});

test("sample data is labelled everywhere, read-only, and leaves no trace", async () => {
  const { page, data, healthDir, errors } = running();
  const settingsFile = join(data, "settings.json");

  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Life OS" })).toBeVisible();
  await page.getByRole("button", { name: "Try with sample data" }).click();

  const banner = page.getByLabel("Sample data");
  const goTo = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(banner).toContainText("You're looking at sample data. None of it is yours.");
  };

  // Today
  await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(banner).toBeVisible();
  await expect(page.getByText("Set up log forwarding")).toBeVisible();
  await expect(page.locator("section.placeholder")).toHaveCount(0);
  // The pill in the sidebar and the real data folder: sample mode writes no settings.
  await expect(page.locator(".titlebar").getByText("Sample data", { exact: true })).toBeVisible();
  expect(existsSync(join(data, "sample"))).toBe(true);

  // Jobs
  await goTo("Jobs");
  await expect(page.getByRole("listitem", { name: "Applied" })).toContainText("Northwind Labs");
  await page.getByRole("tab", { name: "Outreach" }).click();
  await expect(banner).toBeVisible();
  await page.getByRole("tab", { name: "Applications" }).click();
  await expect(page.getByRole("cell", { name: "Sample Bank" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Charts" }).click();
  await expect(page.getByRole("heading", { name: "Applications per week" })).toBeVisible();

  // Fitness
  await goTo("Fitness");
  await expect(page.getByRole("heading", { name: "Weight trend" })).toBeVisible();
  await expect(page.locator(".line-chart__dot").first()).toBeVisible();

  // Health: the sample export, never the owner's own folder (which is set
  // and holds 9,120 steps today).
  await goTo("Health");
  await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible();
  await expect(page.getByText("5,511 /")).toBeVisible();
  await expect(page.getByText("9,120")).toHaveCount(0);
  await expect(page.getByText("Outdoor Run").first()).toBeVisible();
  await expect(page.locator("section.placeholder")).toHaveCount(0);

  // Money: the sample ledger and budgets; quick add is off.
  await goTo("Money");
  await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Transactions" }).getByText("Bookshop").first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Income and spending" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Spending by category" })).toBeVisible();
  await expect(page.getByText("You owe Alex £7.30")).toBeVisible();
  await expect(page.getByText("Settled up with Sam")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a transaction" })).toBeDisabled();

  // Projects
  await goTo("Projects");
  await expect(page.getByRole("heading", { name: "home-lab" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "reading-list" })).toBeVisible();

  // Settings: nothing can be changed while sample data is on.
  await goTo("Settings");
  await expect(page.getByText("Leave sample data to change settings.")).toBeVisible();
  // A disabled fieldset disables every control inside it (isDisabled honours that).
  const controls = page
    .locator("fieldset.settings-group")
    .locator("button, input, select, textarea");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    expect(await control.isDisabled()).toBe(true);
  }
  await expect(page.getByRole("button", { name: "Choose folder" })).toBeDisabled();
  // The Health folder cannot be changed either.
  await expect(page.getByRole("button", { name: "Change Health folder" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove" })).toBeDisabled();
  // The setup checklist is hidden, so it cannot be skipped into the demo.
  await expect(page.getByRole("region", { name: "Setup" })).toHaveCount(0);

  // Leave: back to Welcome, no settings, no sample folder.
  await banner.getByRole("button", { name: "Leave sample data" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Life OS" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  if (existsSync(settingsFile)) {
    expect(
      JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>,
    ).not.toHaveProperty("vaultPath");
  }
  expect(existsSync(join(data, "sample"))).toBe(false);
  expect(existsSync(join(data, "index-sample.db"))).toBe(false);
  // The owner's Health folder is still set, and was left as it was.
  expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toHaveProperty("healthPath", healthDir);

  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.locator("[data-error-boundary]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
