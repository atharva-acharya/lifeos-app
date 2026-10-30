import { describe, expect, it } from "vitest";
import type { FitnessDay, FitnessPlan, FitnessWorkout } from "./api";
import {
  addDays,
  averageChange,
  calendar,
  rollingAverage,
  shortLabel,
  targetLine,
  weekStart,
  weekSummary,
} from "./fitnessStats";

function day(date: string, over: Partial<FitnessDay> = {}): FitnessDay {
  return { date, weight: null, steps: null, proteinG: null, ...over };
}

function plan(over: Partial<FitnessPlan> = {}): FitnessPlan {
  return {
    name: "Arc",
    start: "2026-01-01",
    end: "2026-01-11",
    startWeight: 90,
    targetWeight: 80,
    stepsGoal: 8000,
    proteinGoal: 170,
    ...over,
  };
}

function workout(date: string | null): FitnessWorkout {
  return {
    path: `Fitness/Log/${date ?? "undated"}.md`,
    date,
    day: "Legs",
    week: 1,
    deload: false,
    durationMin: null,
    exercises: [],
  };
}

describe("date helpers", () => {
  it("moves across month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("nope", 1)).toBe("nope");
  });

  it("finds Monday", () => {
    // 2026-10-30 is a Friday.
    expect(weekStart("2026-10-30")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });

  it("labels short dates", () => {
    expect(shortLabel("2026-10-03")).toBe("3 Oct");
    expect(shortLabel("bad")).toBe("bad");
  });
});

describe("calendar", () => {
  it("fills missing days with nulls and ends on today", () => {
    const out = calendar(
      [day("2026-01-01", { weight: 81 }), day("2026-01-03", { steps: 5 })],
      "2026-01-03",
      4,
    );
    expect(out.map((d) => d.date)).toEqual([
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(out.map((d) => d.weight)).toEqual([null, 81, null, null]);
    expect(out[3].steps).toBe(5);
    expect(out[0]).toEqual({ date: "2025-12-31", weight: null, steps: null, proteinG: null });
  });

  it("drops days outside the range and keeps the first of a duplicate", () => {
    const out = calendar(
      [
        day("2025-01-01", { weight: 99 }),
        day("2026-01-02", { weight: 80 }),
        day("2026-01-02", { weight: 70 }),
      ],
      "2026-01-02",
      2,
    );
    expect(out.map((d) => d.weight)).toEqual([null, 80]);
  });
});

describe("rollingAverage", () => {
  it("averages the readings in the trailing 7 days", () => {
    const out = rollingAverage([80, null, 82, null, null, null, null, null, 84], 7);
    expect(out[0]).toBe(80);
    expect(out[2]).toBe(81);
    expect(out[6]).toBe(81);
    // Window for index 8 is indices 2..8: 82 and 84.
    expect(out[8]).toBe(83);
  });

  it("is null when the window has no readings", () => {
    const out = rollingAverage([80, null, null, null, null, null, null, null], 7);
    expect(out[6]).toBe(80);
    expect(out[7]).toBeNull();
    expect(rollingAverage([])).toEqual([]);
  });
});

describe("averageChange", () => {
  it("compares the latest average with one week earlier", () => {
    const avg = [82, 82, 82, 82, 82, 82, 82, 81, 81, 81];
    expect(averageChange(avg)).toBe(-1);
  });

  it("is null without enough history or a reading a week before", () => {
    expect(averageChange([81, 80])).toBeNull();
    expect(averageChange([null, 82, 82, 82, 82, 82, 82, 81])).toBeNull();
    expect(averageChange([])).toBeNull();
  });

  it("uses the latest average even if the last days are empty", () => {
    expect(averageChange([82, null, null, null, null, null, null, 81, null, null])).toBe(-1);
  });
});

describe("targetLine", () => {
  const dates = ["2025-12-31", "2026-01-01", "2026-01-06", "2026-01-11", "2026-01-12"];

  it("interpolates from start to end and is null outside", () => {
    expect(targetLine(dates, plan())).toEqual([null, 90, 85, 80, null]);
  });

  it("is null when the plan or a field is missing", () => {
    expect(targetLine(dates, null)).toEqual([null, null, null, null, null]);
    expect(targetLine(dates, plan({ targetWeight: null }))[1]).toBeNull();
    expect(targetLine(dates, plan({ startWeight: null }))[1]).toBeNull();
    expect(targetLine(dates, plan({ end: null }))[1]).toBeNull();
    expect(targetLine(dates, plan({ start: null }))[1]).toBeNull();
    expect(targetLine(dates, plan({ end: "2025-01-01" }))[1]).toBeNull();
  });

  it("handles a one-day plan", () => {
    expect(targetLine(dates, plan({ start: "2026-01-06", end: "2026-01-06" }))).toEqual([
      null,
      null,
      80,
      null,
      null,
    ]);
  });
});

describe("weekSummary", () => {
  const today = "2026-10-30"; // Friday; this week started Monday 26th.

  it("averages steps, counts protein days and this week's sessions", () => {
    const days = [
      day("2026-10-23", { steps: 99_999, proteinG: 200 }), // 7 days back: outside
      day("2026-10-25", { steps: 6000, proteinG: 170 }),
      day("2026-10-27", { steps: 10_000, proteinG: 169 }),
      day("2026-10-30", { steps: 8000, proteinG: 180 }),
    ];
    const out = weekSummary(days, plan(), today, [
      workout("2026-10-25"),
      workout("2026-10-26"),
      workout("2026-10-29"),
      workout(null),
    ]);
    expect(out.avgSteps).toBe(8000);
    expect(out.proteinDays).toBe(2);
    expect(out.sessions).toBe(2);
    expect(out.stepsGoal).toBe(8000);
  });

  it("uses plan goals and falls back to defaults", () => {
    const days = [day("2026-10-30", { proteinG: 160 })];
    expect(weekSummary(days, plan({ proteinGoal: 150 }), today).proteinDays).toBe(1);
    const bare = weekSummary(days, null, today);
    expect(bare.proteinDays).toBe(0);
    expect(bare).toMatchObject({ stepsGoal: 8000, proteinGoal: 170, avgSteps: null, sessions: 0 });
  });
});
