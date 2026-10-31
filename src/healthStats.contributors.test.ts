import { describe, expect, it } from "vitest";
import type { HealthDay } from "./api";
import {
  baseline,
  comparison,
  count,
  decimal,
  describeContributor,
  direction,
  seriesContributors,
  sleepContributors,
  sleepHours,
  todayContributors,
  todayHint,
  type Contributor,
} from "./healthStats";

/** Synthetic daily series, oldest first, ending 2026-10-31. */
function series(n: number, make: (i: number) => Partial<HealthDay>): HealthDay[] {
  const end = Date.UTC(2026, 9, 31);
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      steps: null,
      activeEnergy: null,
      restingHr: null,
      hrv: null,
      sleep: null,
      weight: null,
      weightSource: null,
      ...make(i),
    };
  });
}

const bpm: Contributor = {
  key: "hr",
  name: "Resting heart rate",
  value: 55,
  average: 58,
  format: count("bpm"),
};

describe("baseline", () => {
  it("averages the 30 days before the date, leaving the day itself out", () => {
    // 40 days: the first 9 read 100, the 30 before the last read 60, the last 10.
    const days = series(40, (i) => ({ restingHr: i < 9 ? 100 : i < 39 ? 60 : 10 }));
    expect(baseline(days, "2026-10-31", (d) => d.restingHr)).toBe(60);
  });

  it("skips missing readings and is null with none", () => {
    const days = series(5, (i) => ({ steps: i % 2 === 0 ? 1000 : null }));
    expect(baseline(days, "2026-10-31", (d) => d.steps)).toBe(1000);
    expect(baseline(days, "2026-10-31", (d) => d.hrv)).toBeNull();
    expect(baseline([], "2026-10-31", (d) => d.steps)).toBeNull();
  });
});

describe("direction", () => {
  it("is level within 3% of the average", () => {
    expect(direction(103, 100)).toBe("level");
    expect(direction(97, 100)).toBe("level");
    expect(direction(100, 100)).toBe("level");
  });

  it("is up or down beyond 3%", () => {
    expect(direction(103.5, 100)).toBe("up");
    expect(direction(96.5, 100)).toBe("down");
    expect(direction(1, 0)).toBe("up");
  });

  it("is null when the value or the average is missing", () => {
    expect(direction(null, 100)).toBeNull();
    expect(direction(100, null)).toBeNull();
    expect(direction(Number.NaN, 100)).toBeNull();
  });
});

describe("describeContributor", () => {
  it("says the value and how far it is from the 30-day average, in plain words", () => {
    expect(describeContributor(bpm)).toBe(
      "Resting heart rate 55 bpm, 3 bpm below your 30-day average",
    );
    expect(comparison(bpm)).toBe("3 bpm below your 30-day average");
    expect(describeContributor({ ...bpm, value: 64 })).toBe(
      "Resting heart rate 64 bpm, 6 bpm above your 30-day average",
    );
  });

  it("says level within 3%", () => {
    expect(describeContributor({ ...bpm, value: 57 })).toBe(
      "Resting heart rate 57 bpm, level with your 30-day average",
    );
  });

  it("writes a missing value as a dash and a missing average in words (T8)", () => {
    expect(describeContributor({ ...bpm, value: null })).toBe("Resting heart rate —, no reading");
    expect(describeContributor({ ...bpm, average: null })).toBe(
      "Resting heart rate 55 bpm, no 30-day average yet",
    );
  });

  it("formats sleep and steps gaps in their own units", () => {
    const sleep = { key: "s", name: "Sleep", value: 6.5, average: 7.25, format: sleepHours };
    expect(comparison(sleep)).toBe("45 min below your 30-day average");
    const steps = { key: "st", name: "Steps", value: 9000, average: 7600, format: count("steps") };
    expect(describeContributor(steps)).toBe(
      "Steps 9,000 steps, 1,400 steps above your 30-day average",
    );
  });
});

describe("count and decimal", () => {
  it("write whole numbers and one decimal place with the unit", () => {
    expect(count("steps")(6499.6)).toBe("6,500 steps");
    expect(count("")(12)).toBe("12");
    expect(decimal("kg")(72.44)).toBe("72.4 kg");
  });
});

describe("todayContributors", () => {
  it("lists every input of the day against the 30 days before it", () => {
    const days = series(31, (i) => ({
      steps: i === 30 ? 6500 : 8000,
      activeEnergy: 400,
      restingHr: i === 30 ? 55 : 58,
      hrv: null,
      sleep: i === 30 ? null : { total: 7, core: 4, deep: 1, rem: 1.5, awake: 0.5 },
    }));
    const out = todayContributors(days, days[30]);
    expect(out.map((c) => c.name)).toEqual([
      "Steps",
      "Active energy",
      "Sleep",
      "Resting heart rate",
      "Heart rate variability",
    ]);
    expect(out.map(describeContributor)).toEqual([
      "Steps 6,500 steps, 1,500 steps below your 30-day average",
      "Active energy 400 kcal, level with your 30-day average",
      "Sleep —, no reading",
      "Resting heart rate 55 bpm, 3 bpm below your 30-day average",
      "Heart rate variability —, no reading",
    ]);
  });
});

describe("sleepContributors", () => {
  it("compares each stage of the newest night with the 30 nights before it", () => {
    const night = (total: number, deep: number) => ({
      total,
      core: 4,
      deep,
      rem: 1.5,
      awake: 0.5,
    });
    const days = series(32, (i) => ({
      sleep: i === 31 ? null : i === 30 ? night(8, 1.5) : night(7, 1),
    }));
    const out = sleepContributors(days);
    expect(out.map((c) => c.name)).toEqual(["Total sleep", "Core", "Deep", "REM", "Awake"]);
    expect(comparison(out[0])).toBe("1 h above your 30-day average");
    expect(comparison(out[1])).toBe("Level with your 30-day average");
    expect(comparison(out[2])).toBe("30 min above your 30-day average");
  });

  it("is all dashes with no night recorded", () => {
    const out = sleepContributors(series(3, () => ({})));
    expect(out.every((c) => c.value === null && c.average === null)).toBe(true);
    expect(describeContributor(out[0])).toBe("Total sleep —, no reading");
  });
});

describe("seriesContributors", () => {
  it("compares the latest reading and its 7-day average with the 30 days before", () => {
    const values = [...Array.from({ length: 30 }, () => 50), 60, null];
    const out = seriesContributors("HRV", values, count("ms"));
    expect(out[0]).toMatchObject({ name: "HRV", value: 60, average: 50 });
    expect(out[1].name).toBe("7-day average");
    expect(out[1].value).toBeCloseTo((6 * 50 + 60) / 7);
    expect(describeContributor(out[0])).toBe("HRV 60 ms, 10 ms above your 30-day average");
  });

  it("is missing when the series has no readings", () => {
    const out = seriesContributors("Weight", [null, null], decimal("kg"));
    expect(out.map(describeContributor)).toEqual([
      "Weight —, no reading",
      "7-day average —, no reading",
    ]);
  });
});

describe("todayHint", () => {
  it("says how much is left today", () => {
    expect(todayHint("steps", 7600, 10000, true)).toBe("2,400 steps to go");
    expect(todayHint("energy", 379.2, 500, true)).toBe("121 kcal to go");
    expect(todayHint("sleep", 6.5, 8, true)).toBe("1 h 30 min short of your sleep goal");
  });

  it("says the goal is reached at or over it", () => {
    expect(todayHint("steps", 10000, 10000, true)).toBe("Goal reached");
    expect(todayHint("sleep", 8.5, 8, true)).toBe("Goal reached");
  });

  it("speaks of a past day in the past", () => {
    expect(todayHint("steps", 7600, 10000, false)).toBe("Ended 2,400 steps short");
  });

  it("handles missing data and missing goals", () => {
    expect(todayHint("steps", null, 10000, true)).toBe("Nothing recorded yet");
    expect(todayHint("sleep", null, 8, true)).toBe("No sleep recorded");
    expect(todayHint("energy", 100, 0, true)).toBe("No goal set");
  });
});
