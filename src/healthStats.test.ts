import { describe, expect, it } from "vitest";
import type { HealthDay } from "./api";
import { ago, dateTime, latestSleep, mean, range, sleepHours, wholeDays } from "./healthStats";

const day = (date: string, sleep: HealthDay["sleep"] = null): HealthDay => ({
  date,
  steps: null,
  activeEnergy: null,
  restingHr: null,
  hrv: null,
  sleep,
  weight: null,
  weightSource: null,
});

describe("range", () => {
  const days = Array.from({ length: 90 }, (_, i) => i);

  it("keeps the last 7, 30 or 90 entries", () => {
    expect(range(days, "week")).toEqual([83, 84, 85, 86, 87, 88, 89]);
    expect(range(days, "month")).toHaveLength(30);
    expect(range(days, "month")[0]).toBe(60);
    expect(range(days, "quarter")).toHaveLength(90);
  });

  it("returns what there is when the data is shorter", () => {
    expect(range([1, 2, 3], "month")).toEqual([1, 2, 3]);
    expect(range([], "week")).toEqual([]);
  });
});

describe("sleepHours", () => {
  it("writes hours and minutes", () => {
    expect(sleepHours(7.2)).toBe("7 h 12 min");
    expect(sleepHours(8)).toBe("8 h");
    expect(sleepHours(0.75)).toBe("45 min");
    expect(sleepHours(0)).toBe("0 min");
  });

  it("rolls 59.6 minutes over to the next hour", () => {
    expect(sleepHours(6.9933)).toBe("7 h");
  });

  it("shows a dash for missing or bad values", () => {
    expect(sleepHours(null)).toBe("—");
    expect(sleepHours(Number.NaN)).toBe("—");
    expect(sleepHours(-1)).toBe("—");
  });
});

describe("ago", () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);
  const HOUR = 3_600_000;

  it("picks the largest whole unit", () => {
    expect(ago(now - 20_000, now)).toBe("just now");
    expect(ago(now - 60_000, now)).toBe("1 minute ago");
    expect(ago(now - 45 * 60_000, now)).toBe("45 minutes ago");
    expect(ago(now - HOUR, now)).toBe("1 hour ago");
    expect(ago(now - 3 * HOUR, now)).toBe("3 hours ago");
    expect(ago(now - 24 * HOUR, now)).toBe("1 day ago");
    expect(ago(now - 49 * HOUR, now)).toBe("2 days ago");
  });

  it("treats a time in the future as just now", () => {
    expect(ago(now + HOUR, now)).toBe("just now");
    expect(ago(Number.NaN, now)).toBe("just now");
  });
});

describe("wholeDays", () => {
  it("counts complete days", () => {
    const now = 10 * 86_400_000;
    expect(wholeDays(now - 3 * 86_400_000 - 5, now)).toBe(3);
    expect(wholeDays(now - 3_600_000, now)).toBe(0);
    expect(wholeDays(now + 5, now)).toBe(0);
  });
});

describe("dateTime", () => {
  it("includes the day, month and time", () => {
    expect(dateTime(new Date(2026, 9, 29, 14, 5).getTime())).toMatch(/29 Oct.*14:05/);
  });
});

describe("mean and latestSleep", () => {
  it("averages the readings and ignores gaps", () => {
    expect(mean([1, null, 3])).toBe(2);
    expect(mean([null])).toBeNull();
    expect(mean([])).toBeNull();
  });

  it("finds the newest night with sleep", () => {
    const s = { total: 7, core: 4, deep: 1, rem: 2, awake: 0.3 };
    expect(latestSleep([day("a", s), day("b"), day("c", { ...s, total: 6 }), day("d")])?.date).toBe(
      "c",
    );
    expect(latestSleep([day("a")])).toBeNull();
  });
});
