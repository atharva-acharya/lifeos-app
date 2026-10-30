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
    name: null,
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
    path: `${date ?? "none"}.md`,
    date,
    day: null,
    week: null,
    deload: false,
    durationMin: null,
    exercises: [],
  };
}

describe("date helpers at boundaries", () => {
  it("handles leap days and century rules", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
  });

  it("moves across year ends in both directions and by large deltas", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2025-12-31", 366)).toBe("2027-01-01");
    expect(addDays("2026-06-15", 0)).toBe("2026-06-15");
    expect(addDays("2026-06-15", -365 * 3)).toBe("2023-06-16");
  });

  it("leaves unreadable dates unchanged", () => {
    for (const bad of ["", "2026-1-1", "26-01-01", "2026/01/01", " 2026-01-01", "2026-01-01T00"]) {
      expect(addDays(bad, 3)).toBe(bad);
      expect(weekStart(bad)).toBe(bad);
      expect(shortLabel(bad)).toBe(bad);
    }
  });

  it("finds Monday across a year boundary", () => {
    // 2026-01-01 is a Thursday.
    expect(weekStart("2026-01-01")).toBe("2025-12-29");
    expect(weekStart("2025-12-29")).toBe("2025-12-29");
    expect(weekStart("2024-12-31")).toBe("2024-12-30");
    // 1970-01-01 (epoch) was a Thursday too, and dates before the epoch work.
    expect(weekStart("1970-01-01")).toBe("1969-12-29");
    expect(weekStart("1969-12-28")).toBe("1969-12-22");
  });

  it("labels the first and last day of a year in UTC", () => {
    expect(shortLabel("2026-01-01")).toBe("1 Jan");
    expect(shortLabel("2025-12-31")).toBe("31 Dec");
    expect(shortLabel("2024-02-29")).toBe("29 Feb");
  });
});

describe("calendar edge cases", () => {
  it("returns nothing for zero days and an empty list yields all-null days", () => {
    expect(calendar([], "2026-01-01", 0)).toEqual([]);
    const out = calendar([], "2026-01-01", 3);
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.weight === null && d.steps === null && d.proteinG === null)).toBe(
      true,
    );
  });

  it("spans a year boundary and keeps zero values distinct from missing", () => {
    const out = calendar(
      [day("2025-12-31", { steps: 0, weight: 0, proteinG: 0 }), day("2026-01-01", { steps: 5 })],
      "2026-01-02",
      3,
    );
    expect(out.map((d) => d.date)).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
    expect(out[0]).toMatchObject({ steps: 0, weight: 0, proteinG: 0 });
    expect(out[2].steps).toBeNull();
  });

  it("with an unreadable today still returns n entries without throwing", () => {
    const out = calendar([day("2026-01-01", { steps: 1 })], "not-a-date", 3);
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.date === "not-a-date")).toBe(true);
  });
});

describe("rollingAverage edge cases", () => {
  it("copes with all nulls, one value and a window of one", () => {
    expect(rollingAverage([null, null, null])).toEqual([null, null, null]);
    expect(rollingAverage([80])).toEqual([80]);
    expect(rollingAverage([80, 82, null], 1)).toEqual([80, 82, null]);
  });

  it("skips non-finite readings", () => {
    expect(rollingAverage([80, Number.NaN, Number.POSITIVE_INFINITY, 82], 7)).toEqual([
      80, 80, 80, 81,
    ]);
    expect(rollingAverage([Number.NaN])).toEqual([null]);
  });

  it("rounds to two decimals and treats zero as a reading", () => {
    expect(rollingAverage([80, 80, 81])[2]).toBe(80.33);
    expect(rollingAverage([0, 0, 3])[2]).toBe(1);
  });

  it("does not mutate its input", () => {
    const v = [1, null, 3];
    rollingAverage(v);
    expect(v).toEqual([1, null, 3]);
  });
});

describe("averageChange edge cases", () => {
  it("is null for all-null averages and exactly-gap-length input", () => {
    expect(averageChange([null, null, null])).toBeNull();
    expect(averageChange([1, 1, 1, 1, 1, 1, 1])).toBeNull();
    expect(averageChange([1, 1, 1, 1, 1, 1, 1, 2])).toBe(1);
  });

  it("reports a gain, a loss and no change", () => {
    expect(averageChange([80, 82], 1)).toBe(2);
    expect(averageChange([82, 80], 1)).toBe(-2);
    expect(averageChange([82, 82], 1)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(averageChange([80, 80.26], 1)).toBe(0.3);
  });
});

describe("targetLine edge cases", () => {
  const dates = ["2026-01-01", "2026-01-06", "2026-01-11"];

  it("is all null for an empty date list or a plan with every field missing", () => {
    expect(targetLine([], plan())).toEqual([]);
    expect(
      targetLine(dates, plan({ start: null, end: null, startWeight: null, targetWeight: null })),
    ).toEqual([null, null, null]);
  });

  it("is null for unreadable plan dates and unreadable input dates", () => {
    expect(targetLine(dates, plan({ start: "soon" }))).toEqual([null, null, null]);
    expect(targetLine(dates, plan({ end: "2026-1-1" }))).toEqual([null, null, null]);
    expect(targetLine(["bad", "2026-01-06"], plan())).toEqual([null, 85]);
  });

  it("is null for a plan whose end is before its start", () => {
    expect(targetLine(dates, plan({ start: "2026-01-11", end: "2026-01-01" }))).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("rises when the target is above the start weight and holds when equal", () => {
    expect(targetLine(dates, plan({ startWeight: 70, targetWeight: 80 }))).toEqual([70, 75, 80]);
    expect(targetLine(dates, plan({ startWeight: 80, targetWeight: 80 }))).toEqual([80, 80, 80]);
  });

  it("treats zero weights as real values", () => {
    expect(targetLine(dates, plan({ startWeight: 0, targetWeight: 10 }))).toEqual([0, 5, 10]);
  });

  it("is today outside the plan: null before the start and after the end", () => {
    const wide = ["2025-06-01", "2027-06-01"];
    expect(targetLine(wide, plan())).toEqual([null, null]);
  });

  it("works across a year boundary and rounds to two decimals", () => {
    const p = plan({ start: "2025-12-30", end: "2026-01-02", startWeight: 90, targetWeight: 89 });
    expect(targetLine(["2025-12-31", "2026-01-01"], p)).toEqual([89.67, 89.33]);
  });

  it("tolerates non-finite plan weights without throwing", () => {
    const out = targetLine(dates, plan({ targetWeight: Number.NaN }));
    expect(out).toHaveLength(3);
  });
});

describe("weekSummary edge cases", () => {
  const today = "2026-01-04"; // Sunday; the week began Monday 2025-12-29.

  it("is empty with no data and no plan", () => {
    expect(weekSummary([], null, today)).toEqual({
      avgSteps: null,
      proteinDays: 0,
      sessions: 0,
      stepsGoal: 8000,
      proteinGoal: 170,
    });
  });

  it("counts sessions across the year boundary from Monday", () => {
    const out = weekSummary([], null, today, [
      workout("2025-12-28"), // previous Sunday: outside
      workout("2025-12-29"),
      workout("2026-01-01"),
      workout("2026-01-04"),
      workout("2026-01-05"), // tomorrow: outside
    ]);
    expect(out.sessions).toBe(3);
  });

  it("counts a Monday today as the first day of the week", () => {
    const out = weekSummary([], null, "2026-01-05", [workout("2026-01-05"), workout("2026-01-04")]);
    expect(out.sessions).toBe(1);
  });

  it("includes today and the six days before, not the seventh", () => {
    const days = [
      day("2025-12-28", { steps: 1000 }),
      day("2025-12-29", { steps: 2000 }),
      day("2026-01-04", { steps: 4000 }),
    ];
    expect(weekSummary(days, null, today).avgSteps).toBe(3000);
  });

  it("counts zero steps as a logged day and ignores future days", () => {
    const days = [day("2026-01-03", { steps: 0 }), day("2026-01-05", { steps: 99_999 })];
    expect(weekSummary(days, null, today).avgSteps).toBe(0);
  });

  it("meets the protein goal exactly and counts a zero goal as always met", () => {
    const days = [day("2026-01-04", { proteinG: 170 }), day("2026-01-03", { proteinG: 169 })];
    expect(weekSummary(days, null, today).proteinDays).toBe(1);
    const zero = weekSummary(days, plan({ proteinGoal: 0 }), today);
    expect(zero.proteinDays).toBe(2);
  });

  it("uses plan goals as given, including zero", () => {
    const out = weekSummary([], plan({ stepsGoal: 0, proteinGoal: 0 }), today);
    expect(out.stepsGoal).toBe(0);
    expect(out.proteinGoal).toBe(0);
  });

  it("ignores workouts with no date or an unreadable one", () => {
    const out = weekSummary([], null, today, [workout(null), workout("junk")]);
    // "junk" sorts after any digit string, so it must not count as in range.
    expect(out.sessions).toBe(0);
  });
});
