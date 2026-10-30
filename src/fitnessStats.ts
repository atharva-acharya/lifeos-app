import type { FitnessDay, FitnessPlan, FitnessWorkout } from "./api";

const DAY_MS = 86_400_000;

/** Days since the Unix epoch for `YYYY-MM-DD`, or null if it is not a date. */
function dayNumber(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : Math.round(t / DAY_MS);
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** `iso` moved by `delta` days (unchanged if it is not a date). */
export function addDays(iso: string, delta: number): string {
  const n = dayNumber(iso);
  return n === null ? iso : isoOf(n + delta);
}

/** Short label such as "3 Oct". */
export function shortLabel(iso: string): string {
  const n = dayNumber(iso);
  if (n === null) return iso;
  return new Date(n * DAY_MS).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  const n = dayNumber(iso);
  if (n === null) return iso;
  // 1970-01-01 was a Thursday; (n + 3) % 7 is 0 on a Monday.
  return isoOf(n - ((((n + 3) % 7) + 7) % 7));
}

export interface CalendarDay {
  date: string;
  weight: number | null;
  steps: number | null;
  proteinG: number | null;
}

/** The `n` days ending `today`, oldest first; days with no note are all null. */
export function calendar(days: FitnessDay[], today: string, n: number): CalendarDay[] {
  const byDate = new Map<string, FitnessDay>();
  for (const d of days) if (!byDate.has(d.date)) byDate.set(d.date, d);
  const out: CalendarDay[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const d = byDate.get(date);
    out.push({
      date,
      weight: d?.weight ?? null,
      steps: d?.steps ?? null,
      proteinG: d?.proteinG ?? null,
    });
  }
  return out;
}

/**
 * Trailing mean of the readings in the last `window` calendar days (the
 * value and the days before it), or null when there are none.
 */
export function rollingAverage(values: (number | null)[], window = 7): (number | null)[] {
  return values.map((_, i) => {
    const readings = values
      .slice(Math.max(0, i - window + 1), i + 1)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (readings.length === 0) return null;
    return Math.round((readings.reduce((a, b) => a + b, 0) / readings.length) * 100) / 100;
  });
}

/** Change between the latest average and the one `gap` days before it. */
export function averageChange(averages: (number | null)[], gap = 7): number | null {
  let last = averages.length - 1;
  while (last >= 0 && averages[last] === null) last--;
  if (last < 0) return null;
  const now = averages[last];
  const before = last >= gap ? averages[last - gap] : null;
  if (now === null || before === null) return null;
  return Math.round((now - before) * 10) / 10;
}

/**
 * The planned weight on each date: a straight line from (start, startWeight)
 * to (end, targetWeight), null outside the plan or when a field is missing.
 */
export function targetLine(dates: string[], plan: FitnessPlan | null): (number | null)[] {
  const start = dayNumber(plan?.start ?? null);
  const end = dayNumber(plan?.end ?? null);
  const from = plan?.startWeight ?? null;
  const to = plan?.targetWeight ?? null;
  if (start === null || end === null || from === null || to === null || end < start) {
    return dates.map(() => null);
  }
  return dates.map((date) => {
    const n = dayNumber(date);
    if (n === null || n < start || n > end) return null;
    const t = end === start ? 1 : (n - start) / (end - start);
    return Math.round((from + (to - from) * t) * 100) / 100;
  });
}

export const SESSIONS_GOAL = 5;

export interface WeekSummary {
  /** Mean of the steps logged in the last 7 days, or null if none. */
  avgSteps: number | null;
  /** Days in the last 7 with protein at or over the goal. */
  proteinDays: number;
  /** Workouts from Monday of this week up to today. */
  sessions: number;
  stepsGoal: number;
  proteinGoal: number;
}

export const DEFAULT_STEPS_GOAL = 8000;
export const DEFAULT_PROTEIN_GOAL = 170;

export function weekSummary(
  days: FitnessDay[],
  plan: FitnessPlan | null,
  today: string,
  workouts: FitnessWorkout[] = [],
): WeekSummary {
  const stepsGoal = plan?.stepsGoal ?? DEFAULT_STEPS_GOAL;
  const proteinGoal = plan?.proteinGoal ?? DEFAULT_PROTEIN_GOAL;
  const week = calendar(days, today, 7);
  const steps = week.map((d) => d.steps).filter((v): v is number => v !== null);
  const monday = weekStart(today);
  return {
    avgSteps: steps.length > 0 ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
    proteinDays: week.filter((d) => d.proteinG !== null && d.proteinG >= proteinGoal).length,
    sessions: workouts.filter((w) => w.date !== null && w.date >= monday && w.date <= today).length,
    stepsGoal,
    proteinGoal,
  };
}
