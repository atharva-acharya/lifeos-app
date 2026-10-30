import { describe, expect, it } from "vitest";
import type { HealthDay } from "./api";
import { ago, latestSleep, mean, range, sleepHours, wholeDays } from "./healthStats";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("range edge cases", () => {
  it("never returns more than asked, whatever the length", () => {
    const one = [1];
    expect(range(one, "week")).toEqual([1]);
    expect(
      range(
        Array.from({ length: 7 }, (_, i) => i),
        "week",
      ),
    ).toHaveLength(7);
    expect(
      range(
        Array.from({ length: 8 }, (_, i) => i),
        "week",
      )[0],
    ).toBe(1);
    expect(
      range(
        Array.from({ length: 200 }, (_, i) => i),
        "quarter",
      ),
    ).toHaveLength(90);
  });

  it("does not mutate its input", () => {
    const src = [1, 2, 3];
    range(src, "week").push(9);
    expect(src).toEqual([1, 2, 3]);
  });
});

describe("sleepHours edge cases", () => {
  it("handles the boundaries between minutes and hours", () => {
    expect(sleepHours(1 / 60)).toBe("1 min");
    expect(sleepHours(59 / 60)).toBe("59 min");
    expect(sleepHours(59.5 / 60)).toBe("1 h");
    expect(sleepHours(24)).toBe("24 h");
    expect(sleepHours(23.999)).toBe("24 h");
  });

  it("is safe with infinities and huge values", () => {
    expect(sleepHours(Number.POSITIVE_INFINITY)).toBe("—");
    expect(sleepHours(Number.NEGATIVE_INFINITY)).toBe("—");
    expect(sleepHours(-0.0001)).toBe("—");
    expect(sleepHours(1e6)).toBe("1000000 h");
    expect(sleepHours(0.0001)).toBe("0 min");
  });
});

describe("ago and wholeDays edge cases", () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 0);

  it("changes unit exactly at the boundaries", () => {
    expect(ago(now - 59_999, now)).toBe("just now");
    expect(ago(now - 60_000, now)).toBe("1 minute ago");
    expect(ago(now - HOUR + 1, now)).toBe("59 minutes ago");
    expect(ago(now - HOUR, now)).toBe("1 hour ago");
    expect(ago(now - DAY + 1, now)).toBe("23 hours ago");
    expect(ago(now - DAY, now)).toBe("1 day ago");
    expect(ago(now - 48 * HOUR, now)).toBe("2 days ago");
    expect(ago(now - 400 * DAY, now)).toBe("400 days ago");
  });

  it("is safe with non-finite times", () => {
    expect(ago(Number.NaN, now)).toBe("just now");
    expect(ago(Number.POSITIVE_INFINITY, now)).toBe("just now");
    expect(ago(now, Number.NaN)).toBe("just now");
    expect(wholeDays(Number.NaN, now)).toBe(0);
    expect(wholeDays(now, now)).toBe(0);
  });

  it("agrees with the 48 hour staleness edge", () => {
    // Stale starts after 48 h, which is the first moment with 2 whole days.
    expect(wholeDays(now - 48 * HOUR - 1, now)).toBe(2);
    expect(wholeDays(now - 48 * HOUR + 1, now)).toBe(1);
  });
});

describe("mean edge cases", () => {
  it("ignores non-finite values and handles a single reading", () => {
    expect(mean([5])).toBe(5);
    expect(mean([Number.NaN, 4, Number.POSITIVE_INFINITY])).toBe(4);
    expect(mean([Number.NaN])).toBeNull();
    expect(mean([0, 0])).toBe(0);
    expect(mean([-2, 2])).toBe(0);
  });
});

describe("latestSleep edge cases", () => {
  const day = (date: string, total: number | null): HealthDay => ({
    date,
    steps: null,
    activeEnergy: null,
    restingHr: null,
    hrv: null,
    sleep: total === null ? null : { total, core: 0, deep: 0, rem: 0, awake: 0 },
    weight: null,
    weightSource: null,
  });

  it("returns null for an empty list and picks a night with zero total", () => {
    expect(latestSleep([])).toBeNull();
    expect(latestSleep([day("a", 7), day("b", 0)])?.date).toBe("b");
  });
});
