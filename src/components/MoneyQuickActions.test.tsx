import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, type Money } from "../api";
import { setMode } from "../mode";
import { MoneyPage } from "../pages/MoneyPage";
import { mockCommands } from "../test/tauri-mocks";

const MONTH = localDate().slice(0, 7);

function money(friends: Money["friends"]): Money {
  return {
    month: MONTH,
    months: [MONTH],
    income: 100_000,
    spent: 20_000,
    budgets: [{ category: "Groceries", limit: 30_000, spent: 10_000, status: "under" }],
    categories: [],
    transactions: [],
    knownCategories: [],
    hasLedger: true,
    hasBudgets: true,
    parseErrors: 0,
    trend: [],
    friends,
    splits: [],
  };
}

const OWED = [
  { friend: "Sam", balance: 0, lastDate: `${MONTH}-01` },
  { friend: "Alex", balance: 1_200, lastDate: `${MONTH}-02` },
];

async function renderPage(friends: Money["friends"] = OWED) {
  mockCommands({ get_money: { status: "ready", money: money(friends) } });
  render(<MoneyPage onNavigate={vi.fn()} />);
  const group = await screen.findByRole("group", { name: "Quick actions" });
  // Let the page finish settling (the index listener, late effects) before
  // keys are pressed; on a slow runner a late re-render could otherwise move
  // focus back to the page after a shortcut had set it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return group;
}

const action = (name: string) =>
  within(screen.getByRole("group", { name: "Quick actions" })).getByRole("button", { name });

afterEach(() => {
  setMode("real");
  vi.restoreAllMocks();
});

/** The flow sheet that is open, by its title. */
const sheet = (name: string) => screen.queryByRole("dialog", { name });

describe("MoneyQuickActions", () => {
  it("opens each flow, and moves to settle-ups and budgets", async () => {
    await renderPage();
    fireEvent.click(action("Add a transaction"));
    expect(sheet("Add a transaction")).toBeInTheDocument();
    fireEvent.click(action("Split a bill"));
    expect(sheet("Split a bill")).toBeInTheDocument();
    fireEvent.click(action("Import a bank statement"));
    expect(sheet("Import a bank statement")).toBeInTheDocument();
    fireEvent.click(action("Settle up"));
    expect(screen.getByRole("button", { name: "Settle up with Alex" })).toHaveFocus();
    fireEvent.click(action("Budget"));
    expect(screen.getByRole("heading", { name: "Budgets" })).toHaveFocus();
  });

  it("scrolls instantly from the keyboard and smoothly from the mouse", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await renderPage();
    fireEvent.click(action("Budget"), { detail: 1 });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "smooth", block: "nearest" });
    fireEvent.keyDown(document.body, { key: "b" });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "instant", block: "nearest" });
    fireEvent.click(action("Budget"), { detail: 0 });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "instant", block: "nearest" });
  });

  it("exposes the shortcuts and shows each key", async () => {
    await renderPage();
    for (const [name, key] of [
      ["Add a transaction", "A"],
      ["Split a bill", "S"],
      ["Import a bank statement", "I"],
      ["Settle up", "U"],
      ["Budget", "B"],
    ]) {
      expect(action(name)).toHaveAttribute("aria-keyshortcuts", key);
      expect(action(name).querySelector("kbd")).toHaveTextContent(key);
    }
  });

  it("runs the shortcuts", async () => {
    await renderPage();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(sheet("Add a transaction")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "S" });
    expect(sheet("Split a bill")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "i" });
    expect(sheet("Import a bank statement")).toBeInTheDocument();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "u" });
    const settle = screen.getByRole("button", { name: "Settle up with Alex" });
    expect(settle).toHaveFocus();
    // A focused button is not a text field, so shortcuts still work.
    fireEvent.keyDown(settle, { key: "b" });
    expect(screen.getByRole("heading", { name: "Budgets" })).toHaveFocus();
  });

  it("ignores shortcuts while typing or with a modifier held", async () => {
    await renderPage();
    fireEvent.keyDown(document.body, { key: "a" });
    const field = screen.getByLabelText("Description");
    field.focus();
    fireEvent.keyDown(field, { key: "s" });
    expect(field).toHaveFocus();
    expect(sheet("Split a bill")).toBeNull();
    field.blur();
    for (const mod of ["ctrlKey", "altKey", "metaKey"]) {
      fireEvent.keyDown(document.body, { key: "i", [mod]: true });
      expect(sheet("Import a bank statement")).toBeNull();
    }
  });

  it("turns Settle up off with a reason when nobody owes anything", async () => {
    await renderPage([{ friend: "Sam", balance: 0, lastDate: `${MONTH}-01` }]);
    const settle = action("Settle up");
    expect(settle).toBeDisabled();
    expect(settle).toHaveAccessibleDescription(
      "Settle up is off: nobody owes you and you owe nobody.",
    );
    expect(action("Add a transaction")).toBeEnabled();
    fireEvent.keyDown(document.body, { key: "u" });
    expect(document.body).toHaveFocus();
  });

  it("turns Add, Split, Import and Settle up off in sample mode", async () => {
    setMode("sample");
    await renderPage();
    const reason = "Add, Split, Import and Settle up are off while sample data is on.";
    for (const name of [
      "Add a transaction",
      "Split a bill",
      "Import a bank statement",
      "Settle up",
    ]) {
      expect(action(name)).toBeDisabled();
      expect(action(name)).toHaveAccessibleDescription(reason);
    }
    expect(action("Budget")).toBeEnabled();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(sheet("Add a transaction")).toBeNull();
    fireEvent.keyDown(document.body, { key: "b" });
    expect(screen.getByRole("heading", { name: "Budgets" })).toHaveFocus();
  });
});
