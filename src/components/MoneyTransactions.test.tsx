import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MoneyRow } from "../api";
import { dayLabel, groupByDay, MoneyTransactions } from "./MoneyTransactions";

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
    expect(grocer).toHaveTextContent("Category Groceries · , account Card");
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
