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

/** Days in the owner's own baseline (ui-spec P4). */
export const BASELINE_DAYS = 30;

/** Within this share of the average, a value counts as level with it. */
export const LEVEL_SHARE = 0.03;

/**
 * The owner's own average of `pick` over the 30 days before `date` (the day
 * itself is left out, so it is compared with what came before it). `days` is
 * the daily series, oldest first. Null when none of those days has a reading.
 */
export function baseline(
  days: HealthDay[],
  date: string,
  pick: (d: HealthDay) => number | null,
): number | null {
  const before = days.filter((d) => d.date < date);
  return mean(before.slice(Math.max(0, before.length - BASELINE_DAYS)).map(pick));
}

export type Direction = "up" | "down" | "level";

/** Up, down or level (within ±3% of the average); null when either is missing. */
export function direction(value: number | null, average: number | null): Direction | null {
  if (value === null || average === null || !Number.isFinite(value) || !Number.isFinite(average))
    return null;
  const diff = value - average;
  if (Math.abs(diff) <= Math.abs(average) * LEVEL_SHARE) return "level";
  return diff > 0 ? "up" : "down";
}

/** One input behind a score or ring, against the owner's 30-day average. */
export interface Contributor {
  key: string;
  name: string;
  value: number | null;
  average: number | null;
  /** Writes a value with its unit, e.g. "55 bpm" or "7 h 12 min". */
  format: (n: number) => string;
}

/** "6,500 steps": a whole number in en-GB style with a unit after it. */
export function count(unit: string): (n: number) => string {
  return (n) => `${Math.round(n).toLocaleString("en-GB")}${unit ? ` ${unit}` : ""}`;
}

/** "72.4 kg": one decimal place with a unit after it. */
export function decimal(unit: string): (n: number) => string {
  return (n) => `${n.toFixed(1)} ${unit}`;
}

/** How a contributor compares, e.g. "3 bpm below your 30-day average". */
export function comparison(c: Contributor): string {
  if (c.value === null || !Number.isFinite(c.value)) return "No reading";
  const dir = direction(c.value, c.average);
  if (dir === null || c.average === null) return "No 30-day average yet";
  if (dir === "level") return "Level with your 30-day average";
  const gap = c.format(Math.abs(c.value - c.average));
  return `${gap} ${dir === "up" ? "above" : "below"} your 30-day average`;
}

/**
 * A contributor in plain words, e.g. "Resting heart rate 55 bpm, 3 bpm below
 * your 30-day average". A missing value is written as "—" (ui-spec T8).
 */
export function describeContributor(c: Contributor): string {
  const value = c.value === null || !Number.isFinite(c.value) ? "—" : c.format(c.value);
  const how = comparison(c);
  return `${c.name} ${value}, ${how.charAt(0).toLowerCase()}${how.slice(1)}`;
}

type SleepPart = "total" | "core" | "deep" | "rem" | "awake";

const sleepPart =
  (part: SleepPart) =>
  (d: HealthDay): number | null =>
    d.sleep ? d.sleep[part] : null;

interface Input {
  key: string;
  name: string;
  pick: (d: HealthDay) => number | null;
  format: (n: number) => string;
}

const TODAY_INPUTS: Input[] = [
  { key: "steps", name: "Steps", pick: (d) => d.steps, format: count("steps") },
  { key: "energy", name: "Active energy", pick: (d) => d.activeEnergy, format: count("kcal") },
  { key: "sleep", name: "Sleep", pick: sleepPart("total"), format: sleepHours },
  { key: "hr", name: "Resting heart rate", pick: (d) => d.restingHr, format: count("bpm") },
  { key: "hrv", name: "Heart rate variability", pick: (d) => d.hrv, format: count("ms") },
];

/** What is behind the Today rings: each input of `day` against the 30 days before it. */
export function todayContributors(days: HealthDay[], day: HealthDay): Contributor[] {
  return TODAY_INPUTS.map((i) => ({
    key: i.key,
    name: i.name,
    value: i.pick(day),
    average: baseline(days, day.date, i.pick),
    format: i.format,
  }));
}

const SLEEP_PARTS: { key: SleepPart; name: string }[] = [
  { key: "total", name: "Total sleep" },
  { key: "core", name: "Core" },
  { key: "deep", name: "Deep" },
  { key: "rem", name: "REM" },
  { key: "awake", name: "Awake" },
];

/** The stages of the newest night in `days`, each against the 30 nights before it. */
export function sleepContributors(days: HealthDay[]): Contributor[] {
  const night = latestSleep(days);
  return SLEEP_PARTS.map((p) => ({
    key: p.key,
    name: p.name,
    value: night?.sleep ? night.sleep[p.key] : null,
    average: night ? baseline(days, night.date, sleepPart(p.key)) : null,
    format: sleepHours,
  }));
}

/**
 * The latest reading of a daily series (oldest first) and its 7-day average,
 * each against the 30-day average of the days before the latest reading.
 */
export function seriesContributors(
  name: string,
  values: (number | null)[],
  format: (n: number) => string,
): Contributor[] {
  const at = values.reduce<number>((last, v, i) => (v === null ? last : i), -1);
  const latest = at >= 0 ? values[at] : null;
  const average = at >= 0 ? mean(values.slice(Math.max(0, at - BASELINE_DAYS), at)) : null;
  const week = at >= 0 ? mean(values.slice(Math.max(0, at - 6), at + 1)) : null;
  return [
    { key: "latest", name, value: latest, average, format },
    { key: "week", name: "7-day average", value: week, average, format },
  ];
}

/** Ring names on Health Today. */
export type TodayRing = "steps" | "energy" | "sleep";

/**
 * One sentence on what to do next for a ring on Health Today (ui-spec P3),
 * e.g. "2,400 steps to go" or "Goal reached". For a past day (nothing
 * recorded today yet) it says how far short that day ended.
 */
export function todayHint(
  ring: TodayRing,
  value: number | null,
  goal: number,
  isToday: boolean,
): string {
  if (value === null || !Number.isFinite(value)) {
    return ring === "sleep" ? "No sleep recorded" : "Nothing recorded yet";
  }
  if (!(goal > 0)) return "No goal set";
  if (value >= goal) return "Goal reached";
  const gap = goal - value;
  if (ring === "sleep") return `${sleepHours(gap)} short of your sleep goal`;
  const amount = count(ring === "steps" ? "steps" : "kcal")(Math.ceil(gap));
  return isToday ? `${amount} to go` : `Ended ${amount} short`;
}
