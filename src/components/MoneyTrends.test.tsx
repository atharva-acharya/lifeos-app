import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthTotals } from "../api";
import { ChangeLine, MoneyTrends } from "./MoneyTrends";

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
    ["Books", 3_000],
    ["Gym", 2_500],
    ["Gifts", 2_000],
    ["Snacks", 1_000],
    ["Phone", 500],
  ]),
];

/** A window that crosses New Year: two months of last year, four of this. */
const ACROSS_YEARS: MonthTotals[] = [
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
].map((m, i) => month(m, 100_000 + i * 1_000, [["Rent", 50_000]]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 31, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ChangeLine", () => {
  it("colours only the arrow and the word, orange when spending rises", () => {
    render(<ChangeLine diff={1_200} previous="September" upIsGood={false} />);
    const line = screen.getByText(/than September/);
    expect(line).toHaveTextContent("↑ £12.00 more than September");
    expect(within(line).getByText("more")).toHaveClass("change__mark--bad");
    expect(within(line).getByText("↑")).toHaveClass("change__mark--bad");
    expect(line).not.toHaveClass("change__mark--bad");
  });

  it("is green when income rises and uses points for a rate", () => {
    render(<ChangeLine diff={-3} previous="September" unit="points" upIsGood={false} />);
    const line = screen.getByText(/than September/);
    expect(line).toHaveTextContent("↓ 3 pts less than September");
    expect(within(line).getByText("less")).toHaveClass("change__mark--good");
    expect(within(line).getByTitle("percentage points")).toBeInTheDocument();
  });

  it("says same without colour", () => {
    const { container } = render(<ChangeLine diff={0} previous="September" upIsGood />);
    expect(container).toHaveTextContent("Same as September");
    expect(container.querySelector("[class*='change__mark']")).toBeNull();
  });
});

describe("MoneyTrends", () => {
  it("renders nothing without any money in the window", () => {
    const { container } = render(<MoneyTrends trend={[month("2026-10", 0, [])]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the flows chart with its accessible table", () => {
    render(<MoneyTrends trend={TREND} />);
    expect(screen.getByRole("heading", { name: "Income and spending" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Savings rate" })).toBeInTheDocument();

    const flows = screen.getByRole("table", { name: "Income and spending by month" });
    const oct = within(flows).getByRole("row", { name: /2026-10/ });
    expect(oct).toHaveTextContent("£2,200.00");
    expect(oct).toHaveTextContent("£1,290.00");
    expect(oct).toHaveTextContent("41%");
    expect(within(flows).getByRole("row", { name: /2026-05/ })).toHaveTextContent("—");
  });

  it("ranks this month's categories as bars, top six plus Other, with the change", () => {
    render(<MoneyTrends trend={TREND} />);
    const card = screen.getByRole("heading", { name: "Spending by category" }).closest("section");
    if (!card) throw new Error("no card");
    expect(card).toHaveTextContent("October vs Sep");
    const names = [...card.querySelectorAll(".breakdown__name")].map((n) => n.textContent);
    expect(names).toEqual(["Rent", "groceries", "Travel", "Books", "Gym", "Gifts", "Other"]);

    const widths = [...card.querySelectorAll<HTMLElement>(".breakdown__bar")].map(
      (b) => b.style.width,
    );
    expect(widths[0]).toBe("100%");
    expect(parseFloat(widths[1])).toBeCloseTo((26_000 / 90_000) * 100);

    // Other folds Snacks, Phone and Fun (only seen in September).
    const table = within(card).getByRole("table", {
      name: "Spending by category, October against September",
    });
    const other = within(table).getByRole("row", { name: /Other/ });
    expect(other).toHaveTextContent("£50.00");
    expect(other).toHaveTextContent("£15.00");
    expect(other).toHaveTextContent("£35.00 less than last month");
    expect(within(table).getByRole("row", { name: /groceries/ })).toHaveTextContent(
      "£60.00 more than last month",
    );
    expect(within(table).getByRole("row", { name: /Rent/ })).toHaveTextContent(
      "Same as last month",
    );
  });

  it("shows income by source with the change", () => {
    render(<MoneyTrends trend={TREND} />);
    const table = screen.getByRole("table", {
      name: "Income by source, October against September",
    });
    expect(within(table).getByRole("row", { name: /Salary/ })).toHaveTextContent(
      "£200.00 more than last month",
    );
  });

  it("leaves out the change when last month has no data", () => {
    render(
      <MoneyTrends trend={[month("2026-09", 0, []), month("2026-10", 100, [["Rent", 50]])]} />,
    );
    const table = screen.getByRole("table", { name: "Spending by category, October" });
    expect(within(table).queryByText("Change")).toBeNull();
    expect(document.querySelector(".breakdown__change")).toBeNull();
  });

  it("switches range from the keyboard at once, with a note when the year is cut", () => {
    render(<MoneyTrends trend={ACROSS_YEARS} />);
    const six = screen.getByRole("tab", { name: "6 months" });
    expect(six).toHaveAttribute("aria-selected", "true");
    const flows = () => screen.getByRole("table", { name: "Income and spending by month" });
    expect(within(flows()).getAllByRole("row")).toHaveLength(7);

    fireEvent.keyDown(six, { key: "ArrowRight" });
    const year = screen.getByRole("tab", { name: "This year" });
    expect(year).toHaveAttribute("aria-selected", "true");
    expect(within(flows()).getAllByRole("row")).toHaveLength(5);
    expect(within(flows()).queryByRole("row", { name: /2025-12/ })).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-settled");
    // January to April: the window covers the whole year so far.
    expect(screen.queryByText(/earlier months of/)).toBeNull();
  });

  it("says so when this year has more months than the window covers", () => {
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This year" }));
    expect(screen.getByText(/Showing May to October only/)).toHaveClass("muted");
  });

  it("names an earlier year rather than calling it this year", () => {
    const old = ACROSS_YEARS.map((t) => ({
      ...t,
      month: `${String(Number(t.month.slice(0, 4)) - 2)}${t.month.slice(4)}`,
    }));
    render(<MoneyTrends trend={old} />);
    expect(screen.getByRole("tab", { name: "2024" })).toBeInTheDocument();
  });
});
