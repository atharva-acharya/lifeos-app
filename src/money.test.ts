import { describe, expect, it } from "vitest";
import {
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
