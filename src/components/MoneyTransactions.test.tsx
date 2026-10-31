import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CategoryChange, MoneyRow } from "../api";
import { setMode } from "../mode";
import { invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { dayLabel, groupByDay, MoneyTransactions, rowRefs } from "./MoneyTransactions";

const TODAY = "2026-10-29";

const ROWS: MoneyRow[] = [
  {
    date: "2026-10-27",
    description: "Example payroll",
    category: "Salary",
    amount: 240_000,
    account: "Current",
  },
  {
    date: "2026-10-29",
    description: "Corner Grocer",
    category: "Groceries",
    amount: -1_250,
    account: "Card",
  },
  {
    date: "2026-10-28",
    description: "Sample Cafe",
    category: null,
    amount: -320,
    account: null,
  },
  {
    date: "2026-10-29",
    description: "Refund from Example Shop",
    category: "Shopping",
    amount: 500,
    account: "Card",
  },
];

function renderList(rows = ROWS) {
  return render(<MoneyTransactions transactions={rows} monthLabel="October 2026" today={TODAY} />);
}

describe("dayLabel", () => {
  it("names today and yesterday, otherwise the short date", () => {
    expect(dayLabel("2026-10-29", TODAY)).toBe("Today");
    expect(dayLabel("2026-10-28", TODAY)).toBe("Yesterday");
    expect(dayLabel("2026-10-27", TODAY)).toBe("Tue 27 Oct");
    // Yesterday across a month boundary.
    expect(dayLabel("2026-10-31", "2026-11-01")).toBe("Yesterday");
  });
});

describe("groupByDay", () => {
  it("groups by date, newest first, keeping row order within a day", () => {
    const days = groupByDay(ROWS);
    expect(days.map((d) => d.date)).toEqual(["2026-10-29", "2026-10-28", "2026-10-27"]);
    expect(days[0].rows.map((r) => r.description)).toEqual([
      "Corner Grocer",
      "Refund from Example Shop",
    ]);
    expect(days.map((d) => d.net)).toEqual([-750, -320, 240_000]);
  });
});

describe("MoneyTransactions", () => {
  it("shows one labelled group per day under its date heading", () => {
    renderList();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Today", "Yesterday", "Tue 27 Oct"]);
    expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument();
    const today = screen.getByRole("list", { name: "Transactions on Today" });
    expect(within(today).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(screen.getByRole("list", { name: "Transactions on Tue 27 Oct" })).getByText(
        "Example payroll",
      ),
    ).toBeInTheDocument();
  });

  it("shows each day's signed net", () => {
    renderList();
    const net = (name: string) =>
      screen.getByRole("region", { name }).querySelector(".money-tx__net");
    expect(net("Today")).toHaveTextContent("Net for the day -£7.50");
    expect(net("Yesterday")).toHaveTextContent("-£3.20");
    expect(net("Tue 27 Oct")).toHaveTextContent("+£2,400.00");
  });

  it("marks income green with a plus and leaves spend in the text colour", () => {
    renderList();
    const amount = (description: string) => {
      const row = screen.getByText(description).closest("li");
      if (!row) throw new Error("no row");
      return row.querySelector(".money-tx__amount");
    };
    expect(amount("Refund from Example Shop")).toHaveTextContent("+£5.00");
    expect(amount("Refund from Example Shop")).toHaveClass("money-tx__amount--in");
    expect(amount("Corner Grocer")).toHaveTextContent("-£12.50");
    expect(amount("Corner Grocer")).not.toHaveClass("money-tx__amount--in");
  });

  it("reads category and account, with dashes for missing ones", () => {
    renderList();
    const grocer = screen.getByText("Corner Grocer").closest("li");
    expect(grocer).toHaveTextContent("Category Groceries▾ · , account Card");
    const cafe = screen.getByText("Sample Cafe").closest("li");
    if (!cafe) throw new Error("no row");
    expect(within(cafe).getAllByText("—")).toHaveLength(2);
    expect(within(cafe).getAllByText("none")).toHaveLength(2);
  });

  it("says when nothing was recorded", () => {
    renderList([]);
    expect(screen.getByText("Nothing recorded in October 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

const CATEGORIES = ["Groceries", "Eating out", "Salary", "Shopping"];

const CAFE: MoneyRow = {
  date: "2026-10-28",
  description: "Sample Cafe",
  category: null,
  amount: -320,
  account: null,
};

afterEach(() => {
  setMode("real");
});

function renderEditable(rows = ROWS, onChanged = vi.fn()) {
  render(
    <MoneyTransactions
      transactions={rows}
      monthLabel="October 2026"
      today={TODAY}
      categories={CATEGORIES}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

/** The change sent with the last `set_transaction_category` call. */
function sentChange(): CategoryChange | undefined {
  const calls = invoke.mock.calls as [string, { change: CategoryChange }?][];
  const sent = calls.filter(([cmd]) => cmd === "set_transaction_category");
  return sent[sent.length - 1]?.[1]?.change;
}

/** A mouse click (a keyboard click has `detail` 0). */
function click(el: HTMLElement) {
  fireEvent.click(el, { detail: 1 });
}

describe("rowRefs", () => {
  it("numbers identical rows in page order and counts them", () => {
    const copy = { ...CAFE };
    const other = { ...CAFE, amount: -330 };
    const refs = rowRefs([CAFE, other, copy]);
    expect(refs.get(CAFE)).toEqual({ occurrence: 0, duplicates: 2 });
    expect(refs.get(copy)).toEqual({ occurrence: 1, duplicates: 2 });
    expect(refs.get(other)).toEqual({ occurrence: 0, duplicates: 1 });
  });
});

describe("changing a category", () => {
  const trigger = (description: string, now: string) =>
    screen.getByRole("button", { name: `Change category for ${description}, now ${now}` });

  it("labels each row's category button with the row and its category", () => {
    renderEditable();
    expect(trigger("Corner Grocer", "Groceries")).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger("Sample Cafe", "none")).toHaveAttribute("aria-expanded", "false");
  });

  it("saves a known category in two clicks and reloads the page", async () => {
    mockCommands({ set_transaction_category: undefined });
    const onChanged = renderEditable();
    const button = trigger("Corner Grocer", "Groceries");
    click(button);
    const dialog = screen.getByRole("dialog", { name: "Category for Corner Grocer" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", dialog.id);
    const options = within(dialog).getAllByRole("button").slice(0, CATEGORIES.length);
    expect(options.map((o) => o.textContent)).toEqual(["Groceries✓", ...CATEGORIES.slice(1)]);
    expect(within(dialog).getByRole("button", { name: "Groceries" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    click(within(dialog).getByRole("button", { name: "Eating out" }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(invoke).toHaveBeenCalledWith("set_transaction_category", {
      change: {
        date: "2026-10-29",
        description: "Corner Grocer",
        amount: -1250,
        account: "Card",
        category: "Groceries",
        occurrence: 0,
        duplicates: 1,
        newCategory: "Eating out",
      },
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  it("tells the core which of two identical rows was chosen", async () => {
    mockCommands({ set_transaction_category: undefined });
    renderEditable([CAFE, { ...CAFE }]);
    const second = screen.getAllByRole("button", {
      name: "Change category for Sample Cafe, now none",
    })[1];
    click(second);
    click(screen.getByRole("button", { name: "Salary" }));
    await waitFor(() => {
      expect(sentChange()).toMatchObject({ occurrence: 1, duplicates: 2, category: null });
    });
  });

  it("saves a new category typed in the field", async () => {
    mockCommands({ set_transaction_category: undefined });
    const onChanged = renderEditable();
    fireEvent.click(trigger("Sample Cafe", "none"));
    const field = screen.getByLabelText("New category");
    expect(field).toHaveAttribute("maxLength", "60");
    fireEvent.change(field, { target: { value: "  Coffee  " } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(sentChange()).toMatchObject({ description: "Sample Cafe", newCategory: "Coffee" });
  });

  it("asks for a name instead of saving a blank one", () => {
    mockCommands({ set_transaction_category: undefined });
    renderEditable();
    fireEvent.click(trigger("Sample Cafe", "none"));
    fireEvent.submit(screen.getByLabelText("New category").closest("form") as HTMLFormElement);
    expect(screen.getByRole("alert")).toHaveTextContent("Type a category name.");
    expect(invoke).not.toHaveBeenCalledWith("set_transaction_category", expect.anything());
  });

  it("shows the core's refusal inline and keeps the popover open", async () => {
    const reason = "The ledger note changed since this page loaded.";
    mockCommands({ set_transaction_category: rejected(reason) });
    const onChanged = renderEditable();
    click(trigger("Corner Grocer", "Groceries"));
    click(screen.getByRole("button", { name: "Shopping" }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(reason);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("closes on Escape and puts focus back on its button", () => {
    renderEditable();
    const button = trigger("Corner Grocer", "Groceries");
    fireEvent.click(button);
    const current = screen.getByRole("button", { name: "Groceries" });
    expect(current).toHaveFocus();
    fireEvent.keyDown(current, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Eating out" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("opens from the keyboard without animation and with the mouse with it", () => {
    renderEditable();
    fireEvent.click(trigger("Corner Grocer", "Groceries"));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-instant");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    click(trigger("Corner Grocer", "Groceries"));
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-instant");
  });

  it("closes when pressing outside", async () => {
    renderEditable();
    click(trigger("Corner Grocer", "Groceries"));
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-closing");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("is off in sample mode and says why", () => {
    setMode("sample");
    renderEditable();
    const reason = screen.getByText("Categories cannot be changed while sample data is on.");
    const button = trigger("Corner Grocer", "Groceries");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-describedby", reason.id);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
