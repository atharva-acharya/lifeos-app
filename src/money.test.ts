import { describe, expect, it } from "vitest";
import {
  addDays,
  compareWeeks,
  longDate,
  monthsOf,
  previousWeek,
  UNCATEGORISED,
  weekDates,
  weekdayName,
  weekFor,
  weekLabel,
  weekStart,
  weekTotals,
  breakdown,
  changeText,
  changeTone,
  compareMonths,
  monthName,
  pounds,
  rangeMonths,
  savingsRate,
  toPence,
  yearIsCut,
} from "./money";

const m = (month: string, income: number, spent: number) => ({ month, income, spent });

describe("money formatting", () => {
  it("formats and reads pounds", () => {
    expect(pounds(123456)).toBe("£1,234.56");
    expect(toPence("£1,200")).toBe(120000);
    expect(toPence("12.5")).toBe(1250);
    expect(toPence("abc")).toBeNull();
  });

  it("names months", () => {
    expect(monthName("2026-09")).toBe("September");
    expect(monthName("2026-01")).toBe("January");
  });

  it("computes savings rate only when there is income", () => {
    expect(savingsRate({ income: 200_000, spent: 50_000 })).toBe(75);
    expect(savingsRate({ income: 100, spent: 300 })).toBe(-200);
    expect(savingsRate({ income: 0, spent: 300 })).toBeNull();
  });
});

describe("vs previous period", () => {
  it("says more, less or same in words", () => {
    expect(changeText(1_200, "September", "pence")).toBe("£12.00 more than September");
    expect(changeText(-350, "September", "pence")).toBe("£3.50 less than September");
    expect(changeText(0, "September", "pence")).toBe("Same as September");
    expect(changeText(-4, "September", "points")).toBe("4 pts less than September");
  });

  it("treats spending up as bad and income up as good", () => {
    expect(changeTone(100, false)).toBe("bad");
    expect(changeTone(-100, false)).toBe("good");
    expect(changeTone(100, true)).toBe("good");
    expect(changeTone(-100, true)).toBe("bad");
    expect(changeTone(0, true)).toBeNull();
  });

  it("compares the last month with the one before", () => {
    const vs = compareMonths([
      m("2026-08", 0, 0),
      m("2026-09", 200_000, 100_000),
      m("2026-10", 250_000, 150_000),
    ]);
    expect(vs).toEqual({ previous: "September", spent: 50_000, income: 50_000, net: 0, rate: -10 });
  });

  it("has no rate change when either month lacks income", () => {
    expect(compareMonths([m("2026-09", 0, 5_000), m("2026-10", 100_000, 0)])?.rate).toBeNull();
  });

  it("shows nothing without a previous month with data", () => {
    expect(compareMonths([m("2026-10", 100, 100)])).toBeNull();
    expect(compareMonths([m("2026-09", 0, 0), m("2026-10", 100, 100)])).toBeNull();
    expect(compareMonths([])).toBeNull();
  });
});

describe("category breakdown", () => {
  const c = (category: string, spent: number) => ({ category, spent });

  it("ranks this month, matches names ignoring case and keeps last month", () => {
    const rows = breakdown(
      [c("Rent", 900), c("groceries", 260)],
      [c("Groceries", 200), c("Fun", 50)],
    );
    expect(rows).toEqual([
      { category: "Rent", current: 900, previous: 0, other: false },
      { category: "groceries", current: 260, previous: 200, other: false },
      { category: "Fun", current: 0, previous: 50, other: false },
    ]);
  });

  it("folds everything past the top six into Other, keeping totals", () => {
    const current = ["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => c(n, 800 - i * 100));
    const rows = breakdown(current, [c("H", 40), c("Z", 10), c("A", 5)]);
    expect(rows).toHaveLength(7);
    expect(rows.slice(0, 6).map((r) => r.category)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(rows[6]).toEqual({ category: "Other", current: 200 + 100, previous: 50, other: true });
    expect(rows.reduce((s, r) => s + r.current, 0)).toBe(3_600);
    expect(rows.reduce((s, r) => s + r.previous, 0)).toBe(55);
  });

  it("has no Other row with six categories or fewer", () => {
    expect(breakdown([c("A", 1)], []).some((r) => r.other)).toBe(false);
  });
});

describe("ranges", () => {
  const trend = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"].map((month) =>
    m(month, 1, 1),
  );

  it("shows the whole window for six months and this year's months for the year", () => {
    expect(rangeMonths(trend, "six")).toHaveLength(6);
    expect(rangeMonths(trend, "year").map((t) => t.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(rangeMonths([], "year")).toEqual([]);
  });

  it("knows when the year has more months than the window covers", () => {
    expect(yearIsCut(trend)).toBe(false);
    const autumn = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) =>
      m(month, 1, 1),
    );
    expect(yearIsCut(autumn)).toBe(true);
    expect(yearIsCut([])).toBe(false);
  });
});

describe("weeks", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-03-30", -7)).toBe("2026-03-23");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-26")).toBe("2026-10-26"); // Monday
    expect(weekStart("2026-10-31")).toBe("2026-10-26"); // Saturday
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // Friday, over New Year
  });

  it("uses the week holding today in the current month, even into next month", () => {
    expect(weekFor("2026-10", "2026-10-31")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(weekFor("2026-02", "2026-02-02")).toEqual({ start: "2026-02-02", end: "2026-02-08" });
    // Early in a month, the week starts in the month before.
    expect(weekFor("2026-10", "2026-10-02")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });

  it("uses the last whole week of an earlier or later month", () => {
    // September 2026 ends on a Wednesday.
    expect(weekFor("2026-09", "2026-10-31")).toEqual({ start: "2026-09-21", end: "2026-09-27" });
    // May 2026 ends on a Sunday, so its last week is whole.
    expect(weekFor("2026-05", "2026-10-31")).toEqual({ start: "2026-05-25", end: "2026-05-31" });
    // February 2026 ends on a Saturday.
    expect(weekFor("2026-02", "2026-10-31")).toEqual({ start: "2026-02-16", end: "2026-02-22" });
    expect(weekFor("2026-12", "2026-10-31")).toEqual({ start: "2026-12-21", end: "2026-12-27" });
  });

  it("finds the week before and the months two weeks touch", () => {
    const week = weekFor("2027-01", "2027-01-01");
    expect(week).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(previousWeek(week)).toEqual({ start: "2026-12-21", end: "2026-12-27" });
    expect(monthsOf(previousWeek(week).start, week.end)).toEqual(["2026-12", "2027-01"]);
    expect(monthsOf("2026-10-19", "2026-11-01")).toEqual(["2026-10", "2026-11"]);
    expect(monthsOf("2026-10-12", "2026-10-25")).toEqual(["2026-10"]);
    expect(weekDates(week)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  it("labels weeks and days", () => {
    expect(weekLabel({ start: "2026-10-19", end: "2026-10-25" })).toBe("19–25 Oct");
    expect(weekLabel({ start: "2026-10-26", end: "2026-11-01" })).toBe("26 Oct – 1 Nov");
    expect(weekLabel({ start: "2026-12-28", end: "2027-01-03" })).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(weekdayName("2026-10-26")).toBe("Mon");
    expect(weekdayName("2026-11-01")).toBe("Sun");
    expect(longDate("2026-10-26")).toMatch(/^Monday,? 26 October 2026$/);
  });
});

describe("weekTotals", () => {
  const week = { start: "2026-10-26", end: "2026-11-01" };
  const row = (date: string, amount: number, category: string | null = "Groceries") => ({
    date,
    amount,
    category,
  });

  it("groups money out and in by day, Monday first, signs made positive", () => {
    const t = weekTotals(
      [
        row("2026-10-26", -1_000),
        row("2026-10-26", -500, "Fun"),
        row("2026-10-28", 20_000, "Salary"),
        row("2026-11-01", -250, "Transport"), // Sunday, in next month
      ],
      week,
    );
    expect(t.days.map((d) => d.date)).toEqual(weekDates(week));
    expect(t.days[0]).toEqual({ date: "2026-10-26", spent: 1_500, income: 0 });
    expect(t.days[2]).toEqual({ date: "2026-10-28", spent: 0, income: 20_000 });
    expect(t.days[6]).toEqual({ date: "2026-11-01", spent: 250, income: 0 });
    expect(t.spent).toBe(1_750);
    expect(t.income).toBe(20_000);
  });

  it("leaves out rows outside the week and zero amounts", () => {
    const t = weekTotals(
      [row("2026-10-25", -9_999), row("2026-11-02", -9_999), row("2026-10-27", 0)],
      week,
    );
    expect(t.spent).toBe(0);
    expect(t.income).toBe(0);
    expect(t.spending).toEqual([]);
  });

  it("gives an empty week seven zero days", () => {
    const t = weekTotals([], week);
    expect(t.days).toHaveLength(7);
    expect(t.days.every((d) => d.spent === 0 && d.income === 0)).toBe(true);
    expect(t).toMatchObject({ start: week.start, end: week.end, spent: 0, income: 0 });
  });

  it("ranks categories by money out, matching names ignoring case", () => {
    const t = weekTotals(
      [
        row("2026-10-26", -1_000, "Groceries"),
        row("2026-10-27", -700, "groceries"),
        row("2026-10-27", -2_000, "Rent"),
        row("2026-10-28", -300, null),
        // A refund is income: it does not lower Groceries.
        row("2026-10-29", 400, "Groceries"),
      ],
      week,
    );
    expect(t.spending).toEqual([
      { category: "Rent", spent: 2_000 },
      { category: "Groceries", spent: 1_700 },
      { category: UNCATEGORISED, spent: 300 },
    ]);
    expect(t.income).toBe(400);
  });

  it("works for a week crossing New Year", () => {
    const t = weekTotals(
      [row("2026-12-31", -100), row("2027-01-01", -200), row("2027-01-03", 50)],
      { start: "2026-12-28", end: "2027-01-03" },
    );
    expect(t.days.map((d) => d.spent)).toEqual([0, 0, 0, 100, 200, 0, 0]);
    expect(t.days[6].income).toBe(50);
  });
});

describe("compareWeeks", () => {
  const week = { start: "2026-10-26", end: "2026-11-01" };
  const before = { start: "2026-10-19", end: "2026-10-25" };
  const r = (date: string, amount: number) => ({ date, amount, category: "Fun" });

  it("gives this week minus last week for spent and income", () => {
    const rows = [r("2026-10-26", -3_000), r("2026-10-27", 1_000), r("2026-10-20", -1_800)];
    const vs = compareWeeks(weekTotals(rows, week), weekTotals(rows, before));
    expect(vs).toEqual({ spent: 1_200, income: 1_000 });
    if (!vs) throw new Error("no comparison");
    // The metric row's wording and tone carry over.
    expect(changeText(vs.spent, "last week", "pence")).toBe("£12.00 more than last week");
    expect(changeTone(vs.spent, false)).toBe("bad");
    expect(changeTone(vs.income, true)).toBe("good");
  });

  it("says less when this week is lower, and is null against an empty week", () => {
    const rows = [r("2026-10-20", -5_000), r("2026-10-21", 9_000)];
    expect(compareWeeks(weekTotals(rows, week), weekTotals(rows, before))).toEqual({
      spent: -5_000,
      income: -9_000,
    });
    expect(compareWeeks(weekTotals(rows, before), weekTotals(rows, week))).toBeNull();
  });
});
