import type { HealthDay } from "./api";

export type RangeId = "week" | "month" | "quarter";

export const RANGES: readonly { id: RangeId; label: string; days: number }[] = [
  { id: "week", label: "Week", days: 7 },
  { id: "month", label: "Month", days: 30 },
  { id: "quarter", label: "3 months", days: 90 },
];

/** The last 7, 30 or 90 days of `days` (oldest first), or all of them if fewer. */
export function range<T>(days: T[], id: RangeId): T[] {
  const n = RANGES.find((r) => r.id === id)?.days ?? 90;
  return days.slice(Math.max(0, days.length - n));
}

/** Hours as "7 h 12 min", "7 h", "45 min"; a missing or negative value is "—". */
export function sleepHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return "—";
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${String(m)} min`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${String(n)} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** How long before `now` the time `ms` was: "3 hours ago", "2 days ago". */
export function ago(ms: number, now: number): string {
  const diff = now - ms;
  if (!Number.isFinite(diff) || diff < MINUTE) return "just now";
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), "minute");
  if (diff < DAY) return plural(Math.floor(diff / HOUR), "hour");
  return plural(Math.floor(diff / DAY), "day");
}

/** Whole days between `ms` and `now` (0 for anything under a day). */
export function wholeDays(ms: number, now: number): number {
  const diff = now - ms;
  return Number.isFinite(diff) && diff > 0 ? Math.floor(diff / DAY) : 0;
}

/** "29 Oct, 14:05" in the owner's locale settings. */
export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Mean of the non-null values, or null when there are none. */
export function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}

/** The newest day in `days` that has a sleep record. */
export function latestSleep(days: HealthDay[]): HealthDay | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].sleep !== null) return days[i];
  return null;
}
