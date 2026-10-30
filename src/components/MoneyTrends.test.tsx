import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MonthTotals } from "../api";
import { MoneyTrends, monthOnMonth, savingsRate, topCategories } from "./MoneyTrends";

function month(m: string, income: number, spending: [string, number][]): MonthTotals {
  return {
    month: m,
    income,
    spent: spending.reduce((n, [, v]) => n + v, 0),
    spending: spending.map(([category, spent]) => ({ category, spent })),
    incomeBySource: income > 0 ? [{ category: "Salary", spent: income }] : [],
  };
}

const TREND: MonthTotals[] = [
  month("2026-05", 0, []),
  month("2026-06", 0, []),
  month("2026-07", 0, []),
  month("2026-08", 200_000, [["Rent", 90_000]]),
  month("2026-09", 200_000, [
    ["Rent", 90_000],
    ["Groceries", 20_000],
    ["Fun", 5_000],
  ]),
  month("2026-10", 220_000, [
    ["Rent", 90_000],
    ["groceries", 26_000],
    ["Travel", 4_000],
  ]),
];

describe("money trend helpers", () => {
  it("computes savings rate only when there is income", () => {
    expect(savingsRate({ income: 200_000, spent: 50_000 })).toBe(75);
    expect(savingsRate({ income: 100, spent: 300 })).toBe(-200);
    expect(savingsRate({ income: 0, spent: 300 })).toBeNull();
  });

  it("ranks categories over the window, ignoring case", () => {
    expect(topCategories(TREND)).toEqual(["Rent", "Groceries", "Fun", "Travel"]);
    expect(topCategories(TREND, 2)).toEqual(["Rent", "Groceries"]);
  });

  it("compares this month with last, biggest rise first", () => {
    const changes = monthOnMonth(TREND[4].spending, TREND[5].spending);
    expect(changes.map((c) => [c.category, c.current - c.previous])).toEqual([
      ["groceries", 6_000],
      ["Travel", 4_000],
      ["Rent", 0],
      ["Fun", -5_000],
    ]);
  });
});

describe("MoneyTrends", () => {
  it("renders nothing without any money in the window", () => {
    const { container } = render(<MoneyTrends trend={[month("2026-10", 0, [])]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the charts, the accessible tables and month on month", () => {
    render(<MoneyTrends trend={TREND} />);
    expect(screen.getByRole("heading", { name: "Income and spending" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Savings rate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spending by category" })).toBeInTheDocument();

    const flows = screen.getByRole("table", { name: "Income and spending by month" });
    const oct = within(flows).getByRole("row", { name: /2026-10/ });
    expect(oct).toHaveTextContent("£2,200.00");
    expect(oct).toHaveTextContent("£1,200.00");
    expect(oct).toHaveTextContent("45%");
    expect(within(flows).getByRole("row", { name: /2026-05/ })).toHaveTextContent("—");

    const mom = screen.getByRole("table", {
      name: "Spending by category, last month and this month",
    });
    expect(within(mom).getByRole("row", { name: /groceries/ })).toHaveTextContent("+£60.00");
    expect(within(mom).getByText("+£60.00")).toHaveClass("money__up");
    expect(within(mom).getByText("-£50.00")).toHaveClass("money__in");
    expect(within(mom).getByText("±£0.00")).toBeInTheDocument();
    expect(screen.getByText("Income by source")).toBeInTheDocument();
  });
});
