import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, type Health, type HealthDay } from "../api";
import { addDays } from "../fitnessStats";
import { invoke } from "../test/tauri-mocks";
import { HealthPage } from "./HealthPage";

const DATE = localDate();
const HOUR = 3_600_000;

function emptyDay(offset: number, over: Partial<HealthDay> = {}): HealthDay {
  return {
    date: addDays(DATE, -offset),
    steps: null,
    activeEnergy: null,
    restingHr: null,
    hrv: null,
    sleep: null,
    weight: null,
    weightSource: null,
    ...over,
  };
}

/** 90 days, oldest first, with readings on the last few. */
function days(): HealthDay[] {
  const out: HealthDay[] = [];
  for (let offset = 89; offset >= 0; offset--) {
    const over: Partial<HealthDay> = {};
    if (offset <= 40 && offset % 2 === 0) {
      over.restingHr = 52 + (offset % 5);
      over.hrv = 40 + (offset % 7);
    }
    if (offset === 0) {
      over.steps = 9120;
      over.activeEnergy = 410;
      over.sleep = { total: 7.2, core: 4.2, deep: 1.1, rem: 1.8, awake: 0.4 };
      over.weight = 81.4;
      over.weightSource = "health";
    }
    if (offset === 1) {
      over.weight = 81.9;
      over.weightSource = "vault";
      over.sleep = { total: 6.5, core: 3.5, deep: 1.0, rem: 1.5, awake: 0.5 };
    }
    out.push(emptyDay(offset, over));
  }
  return out;
}

function health(over: Partial<Health> = {}): Health {
  const all = days();
  return {
    lastExport: Date.now() - 3 * HOUR,
    latestData: DATE,
    stale: false,
    days: all,
    ringsDay: { ...all[89], isToday: true },
    goals: { steps: 8000, activeEnergy: 500, sleepHours: 8 },
    workouts: [
      {
        source: "health",
        date: DATE,
        name: "Outdoor Run",
        durationMin: 30,
        activeEnergy: 310,
        distanceKm: 5.1,
        path: null,
      },
      {
        source: "vault",
        date: addDays(DATE, -2),
        name: "Pull A",
        durationMin: 62,
        activeEnergy: null,
        distanceKm: null,
        path: "Fitness/Log/a.md",
      },
    ],
    badFiles: [],
    badFileCount: 0,
    skippedFiles: 0,
    fileCount: 3,
    ...over,
  };
}

function ready(over: Partial<Health> = {}) {
  invoke.mockResolvedValue({ status: "ready", health: health(over) });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HealthPage", () => {
  it("shows the heading, last export, rings and trends", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Health" })).toBeInTheDocument();
    expect(await screen.findByText(/Last export arrived 3 hours ago/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_health", {
      date: DATE,
      nowMs: expect.any(Number) as number,
    });

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    const legend = screen.getByText("Active energy").closest("ul");
    expect(legend).not.toBeNull();
    const text = legend?.textContent ?? "";
    expect(text).toContain("9,120 / 8,000");
    expect(text).toContain("410 kcal / 500 kcal");
    expect(text).toContain("7 h 12 min / 8 h");

    expect(screen.queryByText(/No new export/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Resting heart rate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Heart rate variability" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weight" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sleep" })).toBeInTheDocument();
  });

  it("lists the latest night's stages and the weight source in the tables", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    const stages = await screen.findByRole("list", { name: "Latest night stages" });
    expect(within(stages).getByText("Core · 4 h 12 min")).toBeInTheDocument();
    expect(within(stages).getByText("Deep · 1 h 6 min")).toBeInTheDocument();
    expect(within(stages).getByText("REM · 1 h 48 min")).toBeInTheDocument();
    expect(within(stages).getByText("Awake · 24 min")).toBeInTheDocument();

    const weight = screen.getByRole("table", { name: "Weight" });
    const rows = within(weight).getAllByRole("row");
    // Header plus the two weighed days in the week.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Vault");
    expect(rows[2]).toHaveTextContent("Apple Health");
  });

  it("warns when the newest export is stale", async () => {
    ready({ stale: true, lastExport: Date.now() - 80 * HOUR });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No new export for 3 days/)).toHaveTextContent(
      "Check Health Auto Export on your iPhone and iCloud for Windows.",
    );
  });

  it("names the export files that could not be read", async () => {
    ready({
      badFiles: [
        { name: "broken.json", reason: "not valid JSON" },
        { name: "odd.json", reason: "unexpected layout" },
      ],
      badFileCount: 2,
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    const notice = await screen.findByText(/2 export files could not be read/);
    expect(notice).toHaveTextContent("broken.json, odd.json");
  });

  it("says when more files were found than the app reads", async () => {
    ready({ skippedFiles: 12 });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/12 of the oldest were left out/)).toBeInTheDocument();
  });

  it("asks for a folder when none is set", async () => {
    invoke.mockResolvedValue({ status: "notConfigured" });
    const onNavigate = vi.fn();
    render(<HealthPage onNavigate={onNavigate} />);
    expect(await screen.findByText("Not set up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try with sample data" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "data");
    expect(screen.queryByRole("heading", { name: "Trends" })).not.toBeInTheDocument();
  });

  it("explains an empty folder", async () => {
    ready({
      fileCount: 0,
      lastExport: null,
      latestData: null,
      stale: true,
      ringsDay: null,
      workouts: [],
      days: days().map((d) => emptyDay(0, { date: d.date })),
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No files yet")).toBeInTheDocument();
    expect(screen.queryByText(/Last export arrived/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No new export/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trends" })).not.toBeInTheDocument();
  });

  it("copes with files that hold no data in range", async () => {
    ready({
      latestData: null,
      ringsDay: null,
      workouts: [],
      days: days().map((d) => emptyDay(0, { date: d.date })),
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/have no steps, energy, sleep/)).toBeInTheDocument();
    expect(screen.getByText(/No steps, energy or sleep in the exports yet/)).toBeInTheDocument();
    expect(screen.getAllByText("No readings in this range.")).toHaveLength(3);
    expect(screen.getByText("No sleep recorded in this range.")).toBeInTheDocument();
    expect(screen.getByText("No workouts yet.")).toBeInTheDocument();
  });

  it("labels the rings with the latest day when today has no data", async () => {
    const all = days();
    const latest = { ...all[85], steps: 4000, isToday: false };
    ready({ ringsDay: latest });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /^Latest: / })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`this shows ${latest.date}`))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Today" })).not.toBeInTheDocument();
  });

  it("switches the range with the tabs and with the arrow keys", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    const week = await screen.findByRole("tab", { name: "Week" });
    expect(week).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("tabindex", "-1");

    const hrRows = () =>
      within(screen.getByRole("table", { name: "Resting heart rate" })).getAllByRole("row").length;
    // Readings every second day: 3 or 4 in a week.
    expect(hrRows()).toBeLessThanOrEqual(5);
    const weekRows = hrRows();

    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
    expect(hrRows()).toBeGreaterThan(weekRows);

    const month = screen.getByRole("tab", { name: "Month" });
    month.focus();
    fireEvent.keyDown(month, { key: "ArrowRight" });
    const quarter = screen.getByRole("tab", { name: "3 months" });
    expect(quarter).toHaveAttribute("aria-selected", "true");
    expect(quarter).toHaveFocus();
    fireEvent.keyDown(quarter, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Week" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "3 months" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Week" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveAttribute("aria-selected", "true");
    // Other keys leave the tab alone.
    fireEvent.keyDown(screen.getByRole("tab", { name: "3 months" }), { key: "a" });
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveAttribute("aria-selected", "true");
  });

  it("merges Apple Health and vault workouts with source pills", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Workouts, newest first" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Apple Health");
    expect(items[0]).toHaveTextContent("Outdoor Run");
    expect(items[0]).toHaveTextContent("30 min");
    expect(items[0]).toHaveTextContent("310 kcal");
    expect(items[0]).toHaveTextContent("5.1 km");
    expect(items[1]).toHaveTextContent("Vault");
    expect(items[1]).toHaveTextContent("Pull A");
    expect(items[1]).toHaveTextContent("62 min");
    expect(items[1]).not.toHaveTextContent("kcal");
  });

  it("shows a load error", async () => {
    invoke.mockRejectedValue("the Health folder could not be read: NotFound");
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be read");
  });

  it("falls back to a generic message for an unknown error", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load health.");
  });

  it("fetches again on window focus and every five minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Midday, so the date check cannot add a fetch when run near midnight.
    vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Trends" });
    const calls = () => invoke.mock.calls.filter((c) => c[0] === "get_health").length;
    expect(calls()).toBe(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(calls()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(calls()).toBe(3);
  });

  it("fetches for the new date after midnight", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 30));
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Trends" });
    expect(invoke).toHaveBeenLastCalledWith("get_health", {
      date: "2026-10-29",
      nowMs: expect.any(Number) as number,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(invoke).toHaveBeenLastCalledWith("get_health", {
      date: "2026-10-30",
      nowMs: expect.any(Number) as number,
    });
  });
});
