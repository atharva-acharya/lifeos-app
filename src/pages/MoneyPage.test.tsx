import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, type Money } from "../api";
import { SKELETON_DELAY_MS } from "../components/Skeleton";
import { setMode } from "../mode";
import { invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { pounds, toPence } from "../money";
import { MoneyPage } from "./MoneyPage";

const MONTH = localDate().slice(0, 7);

const MONEY: Money = {
  month: MONTH,
  months: [MONTH],
  income: 240_000,
  spent: 48_500,
  budgets: [
    { category: "Groceries", limit: 30_000, spent: 27_000, status: "near" },
    { category: "Transport", limit: 8_000, spent: 10_000, status: "over" },
    { category: "Fun", limit: 5_000, spent: 1_000, status: "under" },
  ],
  categories: [{ category: "Groceries", spent: 27_000 }],
  transactions: [
    {
      date: `${MONTH}-25`,
      description: "Example payroll",
      category: "Salary",
      amount: 240_000,
      account: null,
    },
    {
      date: `${MONTH}-02`,
      description: "Corner Grocer",
      category: "Groceries",
      amount: -12_000,
      account: "Card",
    },
  ],
  knownCategories: ["Groceries", "Transport", "Fun", "Salary"],
  hasLedger: true,
  hasBudgets: true,
  parseErrors: 0,
  trend: [],
  friends: [],
  splits: [],
};

afterEach(() => {
  setMode("real");
});

describe("money helpers", () => {
  it("formats and reads pounds", () => {
    expect(pounds(123_456)).toBe("£1,234.56");
    expect(pounds(-1250)).toBe("-£12.50");
    expect(toPence("12.5")).toBe(1250);
    expect(toPence("£1,200")).toBe(120_000);
    for (const bad of ["", "abc", "1.234", "-5", "1e3"]) expect(toPence(bad)).toBeNull();
  });
});

describe("MoneyPage", () => {
  it("asks to connect a vault", async () => {
    mockCommands({ get_money: { status: "noVault" } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_money", { month: MONTH });
  });

  it("shows the month's totals, budgets and transactions", async () => {
    mockCommands({ get_money: { status: "ready", money: MONEY } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    const spent = await screen.findByLabelText("Spent");
    expect(within(spent).getByText("£485.00")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Net")).getByText("£1,915.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Savings rate")).toHaveTextContent("80 %");
    expect(screen.getByText(/^£30\.00 left of/)).toHaveClass("budget__left--progress");
    expect(screen.getByText("£20.00 over")).toHaveClass("pill--danger");
    expect(screen.getByText(/^£40\.00 left of/)).toHaveClass("budget__left--done");
    expect(
      screen.getByRole("progressbar", { name: "Transport: £100.00 of £80.00" }),
    ).toHaveAttribute("aria-valuenow", "8000");
    const payroll = screen.getByText("Example payroll").closest("li");
    expect(payroll).toHaveTextContent("Salary");
    expect(payroll).toHaveTextContent("+£2,400.00");
    const grocer = screen.getByText("Corner Grocer").closest("li");
    expect(grocer).toHaveTextContent("Groceries");
    expect(grocer).toHaveTextContent("Card");
    expect(grocer).toHaveTextContent("-£120.00");
  });

  it("compares each metric with the previous month, in words", async () => {
    const [y, m] = MONTH.split("-").map(Number);
    const before = new Date(y, m - 2, 1);
    const prevKey = `${String(before.getFullYear())}-${String(before.getMonth() + 1).padStart(2, "0")}`;
    const prevName = before.toLocaleDateString("en-GB", { month: "long" });
    const totals = (month: string, income: number, spent: number) => ({
      month,
      income,
      spent,
      spending: [],
      incomeBySource: [],
    });
    mockCommands({
      get_money: {
        status: "ready",
        money: {
          ...MONEY,
          trend: [totals(prevKey, 240_000, 60_000), totals(MONTH, 240_000, 48_500)],
        },
      },
    });
    render(<MoneyPage onNavigate={vi.fn()} />);
    const spent = await screen.findByLabelText("Spent");
    expect(spent).toHaveTextContent(`£115.00 less than ${prevName}`);
    expect(within(spent).getByText("less")).toHaveClass("change__mark--good");
    expect(screen.getByLabelText("Income")).toHaveTextContent(`Same as ${prevName}`);
    expect(screen.getByLabelText("Net")).toHaveTextContent(`£115.00 more than ${prevName}`);
    expect(document.querySelector('.metric[aria-label="Savings rate"]')).toHaveTextContent(
      `5 pts more than ${prevName}`,
    );
  });

  it("shows no comparison without a previous month with data", async () => {
    mockCommands({ get_money: { status: "ready", money: MONEY } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    const spent = await screen.findByLabelText("Spent");
    expect(spent).not.toHaveTextContent(/than/);
  });

  it("moves between months", async () => {
    mockCommands({ get_money: { status: "ready", money: MONEY } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    await screen.findByLabelText("Spent");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const [y, m] = MONTH.split("-").map(Number);
    const prev = m === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(m - 1).padStart(2, "0")}`;
    expect(invoke).toHaveBeenCalledWith("get_money", { month: prev });
  });

  it("keeps the last month on screen, dimmed, while the next one loads", async () => {
    let finish: ((r: unknown) => void) | undefined;
    mockCommands({
      get_money: (args?: Record<string, unknown>) =>
        args?.month === MONTH
          ? { status: "ready", money: MONEY }
          : new Promise((r) => {
              finish = r;
            }),
    });
    render(<MoneyPage onNavigate={vi.fn()} />);
    const spent = await screen.findByLabelText("Spent");
    const view = spent.closest(".page-data");
    expect(view).toHaveAttribute("aria-busy", "false");

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    // Still last month's numbers, marked busy and dimmed; no skeleton.
    expect(screen.getByLabelText("Spent")).toHaveTextContent(pounds(MONEY.spent));
    expect(view).toHaveAttribute("aria-busy", "true");
    expect(view).toHaveClass("page-data--busy");
    await act(async () => {
      await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 20));
    });
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();

    await act(async () => {
      finish?.({ status: "ready", money: { ...MONEY, spent: 1_234 } });
      await Promise.resolve();
    });
    expect(await screen.findByText(pounds(1_234))).toBeInTheDocument();
    expect(screen.getByLabelText("Spent").closest(".page-data")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("shows only the error when the next month fails, and retries it", async () => {
    let failNext = true;
    mockCommands({
      get_money: (args?: Record<string, unknown>) => {
        if (args?.month === MONTH) return { status: "ready", money: MONEY };
        if (failNext) {
          failNext = false;
          return rejected("the ledger could not be read");
        }
        return { status: "ready", money: { ...MONEY, spent: 1_234 } };
      },
    });
    render(<MoneyPage onNavigate={vi.fn()} />);
    await screen.findByLabelText("Spent");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load money.");
    expect(alert).toHaveTextContent("the ledger could not be read");
    // The old month is not left on screen under the new month's name.
    expect(screen.queryByLabelText("Spent")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(pounds(1_234))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds money out as negative pence from the Add sheet, then reloads", async () => {
    mockCommands({ get_money: { status: "ready", money: MONEY }, add_transaction: undefined });
    render(<MoneyPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a transaction" }));
    fireEvent.change(screen.getByLabelText("Amount in pounds"), { target: { value: "3.20" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Another category"), {
      target: { value: " Eating out " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add £3.20 to Eating out" }));
    expect(await screen.findByText("Added −£3.20 · Eating out")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("add_transaction", {
      transaction: {
        date: localDate(),
        description: "Coffee",
        category: "Eating out",
        amount: -320,
        account: null,
      },
    });

    // Money in, with a category chip.
    fireEvent.click(screen.getByRole("button", { name: "Add a transaction" }));
    fireEvent.click(screen.getByRole("radio", { name: "Money in" }));
    fireEvent.change(screen.getByLabelText("Amount in pounds"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
    fireEvent.click(screen.getByRole("button", { name: "Add £5.00 to Groceries" }));
    await screen.findByText("Added +£5.00 · Groceries");
    const amounts = invoke.mock.calls
      .filter(([cmd]) => cmd === "add_transaction")
      .map(([, args]) => (args as { transaction: { amount: number } }).transaction.amount);
    expect(amounts).toEqual([-320, 500]);
  });

  it("refuses a bad amount and shows save errors", async () => {
    mockCommands({
      get_money: { status: "ready", money: MONEY },
      add_transaction: rejected("the note changed while saving; nothing was written, try again"),
    });
    render(<MoneyPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a transaction" }));
    // Only digits and one point can be typed.
    fireEvent.change(screen.getByLabelText("Amount in pounds"), { target: { value: "lots" } });
    expect(screen.getByRole("button", { name: "Enter an amount like 12.50." })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("add_transaction", expect.anything());

    fireEvent.change(screen.getByLabelText("Amount in pounds"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add £2.00" }));
    expect(await screen.findByText(/the note changed while saving/)).toBeInTheDocument();
  });

  it("turns Add off in sample mode, with the reason", async () => {
    setMode("sample");
    mockCommands({ get_money: { status: "ready", money: MONEY } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    const add = await screen.findByRole("button", { name: "Add a transaction" });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription(
      "Add, Split, Import and Settle up are off while sample data is on.",
    );
  });

  it("explains where money notes live when there are none", async () => {
    mockCommands({
      get_money: {
        status: "ready",
        money: { ...MONEY, hasLedger: false, hasBudgets: false, budgets: [], transactions: [] },
      },
    });
    render(<MoneyPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No money notes yet.")).toBeInTheDocument();
    expect(screen.getByText("No budgets yet.")).toBeInTheDocument();
    expect(screen.getByText(/Nothing recorded in/)).toBeInTheDocument();
  });
});
