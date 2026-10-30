import { expect, test } from "@playwright/test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ageHealthExport, launchApp, type RunningApp } from "./app";

/** The version under test, so these tests survive version bumps. */
const APP_VERSION = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "src-tauri", "tauri.conf.json"), "utf8"),
  ) as {
    version: string;
  }
).version;

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

test("Fitness shows weight, workout history and lift progress", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Fitness" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Fitness" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weight trend" })).toBeVisible();
  // Today's synthetic weigh-in is the latest reading.
  await expect(page.getByText("Latest 82.0 kg")).toBeVisible();
  await expect(page.locator(".line-chart__dot").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Steps and protein" })).toBeVisible();

  await page.getByRole("tab", { name: "Pull A" }).click();
  await expect(page.getByText("Deadlift 3 × 5 @ 130 kg")).toBeVisible();
  await expect(page.getByText("Barbell row 3 × 8 @ 70 kg")).toBeVisible();

  await expect(page.getByRole("combobox", { name: "Exercise" })).toHaveValue("Deadlift");
  await expect(
    page.getByRole("table", { name: "Deadlift: top set per session" }).getByRole("row"),
  ).toHaveCount(5);
  await expect(page.getByText(/Deload weeks are left out/)).toBeVisible();
  await expect(page.locator(".line-chart__dot").last()).toBeVisible();
  // Every note in the synthetic vault reads cleanly in Daily and Fitness.
  await expect(page.getByText(/daily or fitness note/)).toHaveCount(0);
});

test("Money quick add writes a ledger row to the vault", async () => {
  const { page, vault } = running();
  await page.getByRole("button", { name: "Money", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
  await expect(page.getByText("No money notes yet.")).toBeVisible();

  await page.getByLabel("Description").fill("E2E coffee | test");
  await page.getByLabel("Amount (£)").fill("3.20");
  await page.getByLabel("Category").fill("Eating out");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Saved to Money\/Ledger\//)).toBeVisible();
  await expect(page.getByRole("cell", { name: "E2E coffee / test" })).toBeVisible();

  // The form defaults to the local date, so the note is this local month.
  const now = new Date();
  const month = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const text = readFileSync(join(vault, "Money", "Ledger", `${month}.md`), "utf8");
  expect(text).toMatch(/^---\ntype: ledger\nmonth: \d{4}-\d{2}\n---\n/);
  expect(text).toContain("| E2E coffee / test | Eating out | -3.20 |  |");
});

test("Projects shows progress and where to resume", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  const card = page.locator("section.project", {
    has: page.getByRole("heading", { name: "home-lab" }),
  });
  await expect(card.getByText("Step 2 of 3")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  const resume = card.getByRole("group", { name: "Resume home-lab" });
  await expect(resume).toContainText("Set up log forwarding");
  // The Today test may have appended a newer line; the older one is in the log.
  await card.locator("summary").click();
  await expect(card.getByText("Hypervisor running.").last()).toBeVisible();

  const current = card.locator('li[aria-current="step"]');
  await expect(current).toHaveText(/Set up log forwarding/);
  await expect(current).toHaveClass(/breathing/);

  // The paused project sits under Other and does not breathe.
  const other = page.getByRole("region", { name: "Other" });
  await expect(other.getByRole("heading", { name: "garden-planner" })).toBeVisible();
  await expect(other.locator(".breathing")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Active" }).locator(".breathing")).toHaveCount(1);

  // Reduced motion switches the animation off.
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => current.evaluate((el) => getComputedStyle(el).animationName))
      .toBe("none");
  } finally {
    await page.emulateMedia({ reducedMotion: null });
  }

  await expect(page.getByText(/project notes? could not be read/)).toHaveCount(0);
});

test("Health shows rings, trends and workouts", async () => {
  const { page } = running();
  await page.getByRole("button", { name: "Health" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Health" })).toBeVisible();
  await expect(page.getByText(/Last export arrived/)).toBeVisible();

  // Today's rings against the plan's step goal (8,500) and the default goals.
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("9,120 / 8,500")).toBeVisible();
  await expect(page.getByText("410 kcal / 500 kcal")).toBeVisible();
  await expect(page.getByText("7 h 12 min / 8 h")).toBeVisible();

  // The synthetic export is fresh and every file reads cleanly.
  await expect(page.getByText(/No new export/)).toHaveCount(0);
  await expect(page.getByText(/export files? could not be read/)).toHaveCount(0);

  // Ten days of resting heart rate: a week shows 7 of them, a month all 10.
  const heartRate = page.getByRole("table", { name: "Resting heart rate" }).getByRole("row");
  await expect(heartRate).toHaveCount(8);
  await page.getByRole("tab", { name: "Month", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Month", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(heartRate).toHaveCount(11);
  await expect(page.locator(".line-chart__dot").first()).toBeVisible();
  await expect(page.locator(".bar-chart__bar").first()).toBeVisible();
  await page.getByRole("tab", { name: "Month", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "3 months" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // An Apple Health workout beside a vault workout, each with its source.
  const workouts = page.getByRole("list", { name: "Workouts, newest first" });
  await expect(workouts.getByRole("listitem").filter({ hasText: "Outdoor Run" })).toContainText(
    "Apple Health",
  );
  await expect(workouts.getByRole("listitem").filter({ hasText: "Pull A" }).first()).toContainText(
    "Vault",
  );
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
  await expect(page.getByText(`Version ${APP_VERSION}`)).toBeVisible();
  await expect(page.getByText("1 recent error logged")).toBeVisible();
});

test("an update signed with the wrong key is offered but refused", async () => {
  const { page } = running();
  // The start-up check found the local test server's version 9.9.9.
  const banner = page.getByLabel("Update available");
  await expect(banner).toContainText("Life OS 9.9.9 is available.");
  await banner.getByRole("button", { name: "Install and restart" }).click();
  await expect(banner.getByRole("alert")).toContainText("failed its security check", {
    timeout: 15_000,
  });
  await banner.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText(`Version ${APP_VERSION}`)).toBeVisible();
});

test("an old signed release announced as new is refused (no downgrade)", async () => {
  const { page, offerUpdate } = running();
  offerUpdate("replay");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText("Version 9.9.9 is available.")).toBeVisible();
  await page.getByRole("button", { name: "Install and restart" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "failed its security check" }),
  ).toBeVisible({ timeout: 15_000 });
  // Nothing was installed: same process, same version.
  await expect(page.getByText(`Version ${APP_VERSION}`)).toBeVisible();
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

test("an export folder with nothing new for three days shows the stale warning", async () => {
  const { page, healthDir } = running();
  ageHealthExport(healthDir, 3 * 24 * 60 * 60 * 1000 + 60_000);
  await page.reload();
  await page.getByRole("button", { name: "Health" }).click();
  await expect(page.getByText(/No new export for 3 days/)).toContainText(
    "Check Health Auto Export on your iPhone and iCloud for Windows.",
  );
  await expect(page.getByText(/Last export arrived 3 days ago/)).toBeVisible();
});
