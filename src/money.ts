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

export type TrendRange = "six" | "year";

/** The months a range shows: the whole window, or those in the selected month's year. */
export function rangeMonths<T extends { month: string }>(trend: T[], range: TrendRange): T[] {
  if (range === "six" || trend.length === 0) return trend;
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
