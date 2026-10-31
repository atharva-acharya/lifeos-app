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

describe("MoneyQuickActions", () => {
  it("focuses each action's target", async () => {
    await renderPage();
    fireEvent.click(action("Add a transaction"));
    expect(screen.getByLabelText("Description")).toHaveFocus();
    fireEvent.click(action("Split"));
    expect(screen.getByLabelText("What for")).toHaveFocus();
    fireEvent.click(action("Settle up"));
    expect(screen.getByRole("button", { name: "Settle up with Alex" })).toHaveFocus();
    fireEvent.click(action("Budget"));
    expect(screen.getByRole("heading", { name: "Budgets" })).toHaveFocus();
  });

  it("scrolls instantly from the keyboard and smoothly from the mouse", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await renderPage();
    fireEvent.click(action("Add a transaction"), { detail: 1 });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "smooth", block: "nearest" });
    fireEvent.keyDown(document.body, { key: "b" });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "instant", block: "nearest" });
    fireEvent.click(action("Add a transaction"), { detail: 0 });
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "instant", block: "nearest" });
  });

  it("exposes the shortcuts and shows each key", async () => {
    await renderPage();
    for (const [name, key] of [
      ["Add a transaction", "A"],
      ["Split", "S"],
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
    expect(screen.getByLabelText("Description")).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "S" });
    expect(screen.getByLabelText("What for")).toHaveFocus();
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
    const field = screen.getByLabelText("Category");
    field.focus();
    fireEvent.keyDown(field, { key: "s" });
    expect(field).toHaveFocus();
    const select = screen.getByLabelText("Who paid");
    select.focus();
    fireEvent.keyDown(select, { key: "a" });
    expect(select).toHaveFocus();
    select.blur();
    for (const mod of ["ctrlKey", "altKey", "metaKey"]) {
      fireEvent.keyDown(document.body, { key: "a", [mod]: true });
      expect(screen.getByLabelText("Description")).not.toHaveFocus();
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

  it("turns Add, Split and Settle up off in sample mode", async () => {
    setMode("sample");
    await renderPage();
    const reason = "Add, Split and Settle up are off while sample data is on.";
    for (const name of ["Add a transaction", "Split", "Settle up"]) {
      expect(action(name)).toBeDisabled();
      expect(action(name)).toHaveAccessibleDescription(reason);
    }
    expect(action("Budget")).toBeEnabled();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(screen.getByLabelText("Description")).not.toHaveFocus();
    fireEvent.keyDown(document.body, { key: "b" });
    expect(screen.getByRole("heading", { name: "Budgets" })).toHaveFocus();
  });
});
