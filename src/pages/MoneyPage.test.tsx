import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, type Money } from "../api";
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
    expect(within(screen.getByLabelText("Savings rate")).getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("£30.00 left")).toHaveClass("pill--progress");
    expect(screen.getByText("£20.00 over")).toHaveClass("pill--danger");
    expect(screen.getByText("£40.00 left")).toHaveClass("pill--done");
    expect(
      screen.getByRole("progressbar", { name: "Transport: £100.00 of £80.00" }),
    ).toHaveAttribute("aria-valuenow", "8000");
    expect(screen.getByText("+£2,400.00")).toBeInTheDocument();
    expect(screen.getByText("-£120.00")).toBeInTheDocument();
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

  it("quick add sends money out as negative pence and reloads", async () => {
    mockCommands({ get_money: { status: "ready", money: MONEY }, add_transaction: undefined });
    render(<MoneyPage onNavigate={vi.fn()} />);
    await screen.findByLabelText("Spent");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Amount (£)"), { target: { value: "3.20" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: " Eating out " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/Saved to Money\/Ledger\//)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("add_transaction", {
      transaction: {
        date: localDate(),
        description: "Coffee",
        category: "Eating out",
        amount: -320,
        account: null,
      },
    });
    expect(screen.getByLabelText("Description")).toHaveValue("");

    const out = screen.getByRole("radio", { name: "Money out" });
    expect(out).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Money in" })).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(out, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Money in" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Refund" } });
    fireEvent.change(screen.getByLabelText("Amount (£)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText(/Saved to/);
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
    await screen.findByLabelText("Spent");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText("Amount (£)"), { target: { value: "lots" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Enter an amount like 12.50.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("add_transaction", expect.anything());

    fireEvent.change(screen.getByLabelText("Amount (£)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText(/the note changed while saving/)).toBeInTheDocument();
  });

  it("turns quick add off in sample mode", async () => {
    setMode("sample");
    mockCommands({ get_money: { status: "ready", money: MONEY } });
    render(<MoneyPage onNavigate={vi.fn()} />);
    expect(
      await screen.findByText("Quick add is off while sample data is on."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
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
