import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyRow, MonthTotals } from "../api";
import { invoke } from "../test/tauri-mocks";
import { ChangeLine, MoneyTrends } from "./MoneyTrends";

function tx(date: string, amount: number, category: string | null = "Groceries"): MoneyRow {
  return { date, description: "Synthetic", category, amount, account: "Card" };
}

/**
 * Answers `get_money` with `rows` for every month, as a careless core might:
 * the week view must keep each answer to the month it asked for. Months in
 * `failing` reject.
 */
function serveLedger(rows: MoneyRow[], failing: string[] = []) {
  invoke.mockImplementation((cmd: string, args?: { month?: string }) => {
    if (cmd !== "get_money") return Promise.reject(new Error(`unexpected ${cmd}`));
    const month = args?.month ?? "";
    if (failing.includes(month)) return Promise.reject(new Error("vault offline"));
    return Promise.resolve({
      status: "ready",
      money: { month, transactions: rows },
    });
  });
}

function askedMonths(): string[] {
  return invoke.mock.calls
    .filter(([cmd]) => cmd === "get_money")
    .map(([, args]) => (args as { month: string }).month);
}

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
  it("says how to start when there is no money in the window", () => {
    render(<MoneyTrends trend={[month("2026-10", 0, [])]} />);
    expect(screen.getByText(/No income or spending yet/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("shows the flows chart with its accessible table", () => {
    render(<MoneyTrends trend={TREND} />);
    expect(screen.getByRole("heading", { name: "Income and spending" })).toBeInTheDocument();

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
    // One breakdown at a time: spending first, income one click away.
    fireEvent.click(screen.getByRole("button", { name: "Show income by source" }));
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

describe("MoneyTrends week range", () => {
  // Today is Saturday 31 October 2026: this week is 26 Oct – 1 Nov.
  const LEDGER = [
    tx("2026-11-01", -300, "Transport"),
    tx("2026-10-31", -1_499, "Fun"),
    tx("2026-10-27", -2_900, "Health"),
    tx("2026-10-26", -4_830, "Groceries"),
    tx("2026-10-21", -7_210, "groceries"),
    tx("2026-10-20", -92_500, "Rent"),
    tx("2026-10-19", 235_000, "Salary"),
    tx("2026-10-05", -1_099, "Subscriptions"),
  ];

  it("comes first, and fetches the months both weeks touch only when chosen", async () => {
    serveLedger(LEDGER);
    render(<MoneyTrends trend={TREND} />);
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["This week", "6 months", "This year"]);
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading the week");
    expect(await screen.findByRole("heading", { name: "Spending by day" })).toBeInTheDocument();
    expect(askedMonths()).toEqual(["2026-10", "2026-11"]);
    expect(screen.queryByRole("table", { name: "Income and spending by month" })).toBeNull();
  });

  it("shows spending per day, Monday to Sunday, with a screen-reader table", async () => {
    serveLedger(LEDGER);
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    const table = await screen.findByRole("table", { name: "Spending by day, 26 Oct – 1 Nov" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveTextContent(/Monday,? 26 October 2026/);
    expect(rows[0]).toHaveTextContent("£48.30");
    // Sunday is in November, and counted once though both answers hold it.
    expect(rows[6]).toHaveTextContent(/Sunday,? 1 November 2026£3.00£0.00/);
    expect(rows[3]).toHaveTextContent("£0.00£0.00");
    expect(document.querySelectorAll(".bar-chart__bar").length).toBeGreaterThan(0);
  });

  it("compares Spent and Income with last week in the metric row's words", async () => {
    serveLedger(LEDGER);
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    const spent = await screen.findByRole("region", { name: "Spent this week" });
    expect(spent).toHaveTextContent("£95.29");
    expect(spent).toHaveTextContent("↓ £901.81 less than last week");
    expect(within(spent).getByText("less")).toHaveClass("change__mark--good");

    const income = screen.getByRole("region", { name: "Income this week" });
    expect(income).toHaveTextContent("£0.00");
    expect(income).toHaveTextContent("↓ £2,350.00 less than last week");
    expect(within(income).getByText("less")).toHaveClass("change__mark--bad");
  });

  it("ranks the week's categories with the shared breakdown", async () => {
    serveLedger(LEDGER);
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    const table = await screen.findByRole("table", {
      name: "Spending by category, 26 Oct – 1 Nov against 19–25 Oct",
    });
    const card = table.closest("section");
    if (!card) throw new Error("no card");
    expect(card).toHaveTextContent("26 Oct – 1 Nov vs last week");
    const names = [...card.querySelectorAll(".breakdown__name")].map((n) => n.textContent);
    expect(names).toEqual(["Groceries", "Health", "Fun", "Transport", "Rent"]);
    expect(within(table).getByRole("row", { name: /Groceries/ })).toHaveTextContent(
      "£23.80 less than last week",
    );
    expect(within(table).getByRole("row", { name: /Rent/ })).toHaveTextContent(
      "£925.00 less than last week",
    );
    expect(within(table).queryByRole("row", { name: /Subscriptions/ })).toBeNull();
  });

  it("switches to the week from the keyboard at once", async () => {
    serveLedger(LEDGER);
    render(<MoneyTrends trend={TREND} />);
    const six = screen.getByRole("tab", { name: "6 months" });
    fireEvent.keyDown(six, { key: "ArrowLeft" });
    const week = screen.getByRole("tab", { name: "This week" });
    expect(week).toHaveAttribute("aria-selected", "true");
    expect(week).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("data-settled");
    expect(await screen.findByRole("heading", { name: "Spending by day" })).toBeInTheDocument();
  });

  it("says so quietly when last week cannot be loaded", async () => {
    // Tuesday 3 November: last week is 26 Oct – 1 Nov, partly in October.
    vi.setSystemTime(new Date(2026, 10, 3, 12));
    serveLedger([tx("2026-11-02", -1_000), tx("2026-10-27", -2_000)], ["2026-10"]);
    render(
      <MoneyTrends trend={[...TREND.slice(1), month("2026-11", 0, [["Groceries", 1_000]])]} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    const spent = await screen.findByRole("region", { name: "Spent this week" });
    expect(spent).toHaveTextContent("£10.00");
    expect(within(spent).getByText("Could not load last week")).toHaveClass("muted");
    expect(
      screen.getByRole("table", { name: "Spending by category, 2–8 Nov" }),
    ).toBeInTheDocument();
    expect(document.querySelector(".breakdown__change")).toBeNull();
  });

  it("says so quietly when this week cannot be loaded", async () => {
    serveLedger(LEDGER, ["2026-11"]);
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    expect(await screen.findByText("Could not load this week.")).toHaveClass("muted");
    expect(screen.queryByRole("heading", { name: "Spending by day" })).toBeNull();
  });

  it("shows an earlier month's last whole week against the week before", async () => {
    serveLedger([tx("2026-09-22", -1_500), tx("2026-09-15", -1_000)]);
    render(<MoneyTrends trend={TREND.slice(0, 5)} />);
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    const spent = await screen.findByRole("region", { name: "Spent that week" });
    expect(spent).toHaveTextContent("21–27 Sep");
    expect(spent).toHaveTextContent("↑ £5.00 more than the week before");
    expect(askedMonths()).toEqual(["2026-09"]);
  });

  it("handles an empty week", async () => {
    serveLedger([]);
    render(<MoneyTrends trend={TREND} />);
    fireEvent.click(screen.getByRole("tab", { name: "This week" }));
    expect(await screen.findAllByText("No spending this week.")).toHaveLength(2);
    const spent = screen.getByRole("region", { name: "Spent this week" });
    expect(spent).toHaveTextContent("£0.00");
    expect(spent.querySelector(".change")).toBeNull();
  });
});
