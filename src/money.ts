const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

/** Formats pence as pounds, e.g. 123456 → "£1,234.56". */
export function pounds(pence: number): string {
  return GBP.format(pence / 100);
}

/** Reads a pounds amount typed by the owner ("12.5", "£1,200") into pence. */
export function toPence(text: string): number | null {
  const clean = text.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Share of income kept, as a whole percent; null without income. */
export function savingsRate(t: { income: number; spent: number }): number | null {
  return t.income > 0 ? Math.round(((t.income - t.spent) / t.income) * 100) : null;
}

/** Full month name of a `YYYY-MM` key, e.g. "2026-09" → "September". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long" });
}

export type Direction = "more" | "less" | "same";

export function direction(diff: number): Direction {
  return diff > 0 ? "more" : diff < 0 ? "less" : "same";
}

/**
 * Whether a change is good news: spending going up is not; income, net and
 * savings rate going up are. No change is neither.
 */
export function changeTone(diff: number, upIsGood: boolean): "good" | "bad" | null {
  if (diff === 0) return null;
  return diff > 0 === upIsGood ? "good" : "bad";
}

/** The size of a change in words: "£12.00" for money, "3 pts" for a rate. */
export function changeSize(diff: number, unit: "pence" | "points"): string {
  return unit === "pence" ? pounds(Math.abs(diff)) : `${String(Math.abs(diff))} pts`;
}

/** "£12.00 more than September", "3 pts less than September", "Same as September". */
export function changeText(diff: number, previousLabel: string, unit: "pence" | "points"): string {
  const dir = direction(diff);
  if (dir === "same") return `Same as ${previousLabel}`;
  return `${changeSize(diff, unit)} ${dir} than ${previousLabel}`;
}

interface Totals {
  month: string;
  income: number;
  spent: number;
}

export interface MonthComparison {
  /** Name of the month compared against, e.g. "September". */
  previous: string;
  spent: number;
  income: number;
  net: number;
  /** Percentage points; null when either month had no income. */
  rate: number | null;
}

function hasData(t: Totals): boolean {
  return t.income > 0 || t.spent > 0;
}

/**
 * The selected month (the last in `trend`) against the month before it.
 * Null when there is no earlier month, or it has no income or spending.
 */
export function compareMonths(trend: Totals[]): MonthComparison | null {
  if (trend.length < 2) return null;
  const current = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  if (!hasData(previous)) return null;
  const nowRate = savingsRate(current);
  const thenRate = savingsRate(previous);
  return {
    previous: monthName(previous.month),
    spent: current.spent - previous.spent,
    income: current.income - previous.income,
    net: current.income - current.spent - (previous.income - previous.spent),
    rate: nowRate === null || thenRate === null ? null : nowRate - thenRate,
  };
}

export interface BreakdownRow {
  category: string;
  current: number;
  previous: number;
  /** True for the row that folds every category below the top ones. */
  other: boolean;
}

/** Categories named in a breakdown before the rest fold into "Other". */
export const BREAKDOWN_TOP = 6;

type Amounts = { category: string; spent: number }[];

/**
 * Amounts per category this month, largest first, with last month's amount
 * for the change. Names match ignoring case. Past the top `n`, the rest (and
 * categories only seen last month) fold into one "Other" row, so the rows
 * always add up to both months' totals.
 */
export function breakdown(current: Amounts, previous: Amounts, n = BREAKDOWN_TOP): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>();
  const add = (list: Amounts, field: "current" | "previous") => {
    for (const c of list) {
      const key = c.category.toLowerCase();
      const row = rows.get(key) ?? { category: c.category, current: 0, previous: 0, other: false };
      row[field] += c.spent;
      rows.set(key, row);
    }
  };
  add(current, "current");
  add(previous, "previous");
  const ranked = [...rows.values()].sort(
    (a, b) =>
      b.current - a.current || b.previous - a.previous || a.category.localeCompare(b.category),
  );
  if (ranked.length <= n) return ranked;
  const rest = ranked.slice(n);
  return [
    ...ranked.slice(0, n),
    {
      category: "Other",
      current: rest.reduce((s, r) => s + r.current, 0),
      previous: rest.reduce((s, r) => s + r.previous, 0),
      other: true,
    },
  ];
}

/** "This week" (from transactions), the six-month window, or the selected month's year. */
export type TrendRange = "week" | "six" | "year";

/**
 * The months a range shows: the whole window, or those in the selected
 * month's year. The week range is drawn from transactions, not months.
 */
export function rangeMonths<T extends { month: string }>(trend: T[], range: TrendRange): T[] {
  if (range !== "year" || trend.length === 0) return trend;
  const year = trend[trend.length - 1].month.slice(0, 4);
  return trend.filter((t) => t.month.startsWith(year));
}

/**
 * True when the selected month's year has more months up to it than the
 * window holds, so "This year" cannot show all of them.
 */
export function yearIsCut(trend: { month: string }[]): boolean {
  if (trend.length === 0) return false;
  const elapsed = Number(trend[trend.length - 1].month.slice(5, 7));
  return elapsed > rangeMonths(trend, "year").length;
}

// ---- Weeks (ui-spec P7) -------------------------------------------------
// Dates are `YYYY-MM-DD` strings, as the ledger stores them. Day arithmetic
// runs in UTC so a clock change never moves a day.

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` moved by `days` (negative goes back): "2026-10-31" + 1 is "2026-11-01". */
export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** The Monday on or before `date`: weeks start on Monday. */
export function weekStart(date: string): string {
  const weekday = new Date(toUtc(date)).getUTCDay(); // 0 is Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Monday to Sunday, both inclusive. */
export interface WeekBounds {
  start: string;
  end: string;
}

function weekFrom(start: string): WeekBounds {
  return { start, end: addDays(start, 6) };
}

/**
 * The week the week range shows for `month` (`YYYY-MM`): the week holding
 * `today` when `month` is the current month, otherwise the last Monday to
 * Sunday that lies wholly inside `month`.
 */
export function weekFor(month: string, today: string): WeekBounds {
  if (today.startsWith(month)) return weekFrom(weekStart(today));
  const [y, m] = month.split("-").map(Number);
  const last = fromUtc(Date.UTC(y, m, 0));
  const start = weekStart(last);
  // A week that ends on the month's last day is whole; otherwise take the one before.
  return weekFrom(addDays(start, 6) === last ? start : addDays(start, -7));
}

/** The week before `week`. */
export function previousWeek(week: WeekBounds): WeekBounds {
  return weekFrom(addDays(week.start, -7));
}

/** The seven dates of `week`, Monday first. */
export function weekDates(week: WeekBounds): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week.start, i));
}

/** The `YYYY-MM` months from `from` to `to` (dates, inclusive), oldest first. */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const month = d.slice(0, 7);
    if (!out.includes(month)) out.push(month);
  }
  return out;
}

function dayFormat(date: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(toUtc(date)).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
}

/** "19–25 Oct", "26 Oct – 1 Nov", or with years when the week crosses New Year. */
export function weekLabel(week: WeekBounds): string {
  const dm = { day: "numeric", month: "short" } as const;
  if (week.start.slice(0, 4) !== week.end.slice(0, 4)) {
    const full = { ...dm, year: "numeric" } as const;
    return `${dayFormat(week.start, full)} – ${dayFormat(week.end, full)}`;
  }
  if (week.start.slice(0, 7) === week.end.slice(0, 7)) {
    return `${dayFormat(week.start, { day: "numeric" })}–${dayFormat(week.end, dm)}`;
  }
  return `${dayFormat(week.start, dm)} – ${dayFormat(week.end, dm)}`;
}

/** Short weekday of a date: "Mon". */
export function weekdayName(date: string): string {
  return dayFormat(date, { weekday: "short" });
}

/** Full date for tables: "Monday, 26 October 2026". */
export function longDate(date: string): string {
  return dayFormat(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** A ledger row as `get_money` returns it: negative pence is money out. */
export interface LedgerRow {
  date: string;
  category: string | null;
  amount: number;
}

/** The name the core gives rows without a category. */
export const UNCATEGORISED = "Uncategorised";

export interface DayTotals {
  date: string;
  /** Pence out, positive. */
  spent: number;
  /** Pence in, positive. */
  income: number;
}

export interface WeekTotals extends WeekBounds {
  /** Monday to Sunday: always seven days. */
  days: DayTotals[];
  income: number;
  spent: number;
  /** Money out per category, largest first; names match ignoring case. */
  spending: { category: string; spent: number }[];
}

/**
 * A week's money from ledger rows, which may come from several months and
 * include rows outside the week. As in the core, spending counts money out
 * only: a refund is income and does not lower its category's spending.
 */
export function weekTotals(rows: readonly LedgerRow[], week: WeekBounds): WeekTotals {
  const days: DayTotals[] = weekDates(week).map((date) => ({ date, spent: 0, income: 0 }));
  const byCategory = new Map<string, { category: string; spent: number }>();
  for (const r of rows) {
    if (r.date < week.start || r.date > week.end) continue;
    const day = days[Math.round((toUtc(r.date) - toUtc(week.start)) / DAY_MS)];
    if (r.amount > 0) {
      day.income += r.amount;
    } else if (r.amount < 0) {
      day.spent -= r.amount;
      const name = r.category ?? UNCATEGORISED;
      const key = name.toLowerCase();
      const line = byCategory.get(key) ?? { category: name, spent: 0 };
      line.spent -= r.amount;
      byCategory.set(key, line);
    }
  }
  return {
    ...week,
    days,
    income: days.reduce((n, d) => n + d.income, 0),
    spent: days.reduce((n, d) => n + d.spent, 0),
    spending: [...byCategory.values()].sort(
      (a, b) => b.spent - a.spent || a.category.localeCompare(b.category),
    ),
  };
}

export interface WeekComparison {
  /** Pence; positive is more this week. */
  spent: number;
  income: number;
}

/**
 * A week against the week before. Null when the week before had no income
 * or spending, as `compareMonths` does for months.
 */
export function compareWeeks(current: WeekTotals, previous: WeekTotals): WeekComparison | null {
  if (previous.income === 0 && previous.spent === 0) return null;
  return { spent: current.spent - previous.spent, income: current.income - previous.income };
}
