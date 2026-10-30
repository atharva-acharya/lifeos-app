import { expect, test, type Page } from "@playwright/test";
import { launchApp, type RunningApp } from "./app";

let app: RunningApp | undefined;

function running(): RunningApp {
  if (!app) throw new Error("app did not start");
  return app;
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // No settings.json and an empty data folder: a first run.
  app = await launchApp({ vault: false });
});

test.afterAll(async () => {
  await app?.close();
});

async function expectNotConnected(page: Page, text: string): Promise<void> {
  const card = page.locator("section.placeholder");
  await expect(card.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(card).toContainText(text);
  await expect(card.getByRole("button", { name: "Open settings" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Try with sample data" })).toBeVisible();
}

test("a first run shows Welcome, then every page explains what is missing", async () => {
  const { page, errors } = running();

  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Life OS" })).toBeVisible();
  // Welcome stands alone: no sidebar yet, and a way to choose, look around or skip.
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose vault folder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try with sample data" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("button", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expectNotConnected(page, "Choose your Life OS vault folder to see today's dashboard.");

  await page.getByRole("button", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expectNotConnected(page, "pipeline and outreach");
  await page.getByRole("tab", { name: "Outreach" }).click();
  await expectNotConnected(page, "pipeline and outreach");
  await page.getByRole("tab", { name: "Applications" }).click();
  await expect(page.getByText("Google Sheet").first()).toBeVisible();
  await page.getByRole("tab", { name: "Charts" }).click();
  await expect(page.getByText("Google Sheet").first()).toBeVisible();

  await page.getByRole("button", { name: "Fitness" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fitness" })).toBeVisible();
  await expectNotConnected(page, "weight, workouts and lifts");

  await page.getByRole("button", { name: "Health" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Health" })).toBeVisible();
  const health = page.locator("section.placeholder");
  await expect(health.getByText("Not set up", { exact: true })).toBeVisible();
  await expect(health).toContainText("Choose the folder where Health Auto Export saves its files");
  await expect(health.getByRole("button", { name: "Try with sample data" })).toBeVisible();

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expectNotConnected(page, "projects and where to resume");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const setup = page.getByRole("region", { name: "Setup" });
  await expect(setup.getByText("0 of 6 set up", { exact: true })).toBeVisible();
  await expect(setup.getByRole("progressbar", { name: "Setup progress" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expect(setup.getByRole("button", { name: "Choose folder" })).toBeVisible();
  // The vault is required, so it cannot be skipped; the optional items can.
  await expect(setup.getByRole("button", { name: "Skip" })).toHaveCount(5);
  await setup.getByRole("button", { name: "Skip" }).first().click();
  await expect(setup.getByText("0 of 6 set up · 1 skipped", { exact: true })).toBeVisible();
  await setup.getByRole("button", { name: "Undo" }).click();
  await expect(setup.getByText("0 of 6 set up", { exact: true })).toBeVisible();
  await expect(setup.getByRole("link", { name: "Settings › Health" })).toBeVisible();
  // A guide shows the exact front matter to copy.
  await setup.getByRole("button", { name: "Guide" }).first().click();
  await expect(setup.locator("pre").first()).toContainText("type:");

  // A blank profile is a normal state, not a failure.
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  await expect(page.locator("[data-error-boundary]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
