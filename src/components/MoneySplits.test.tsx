import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localDate, type FriendBalance } from "../api";
import { invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { MoneySplits, balanceText, parseNames } from "./MoneySplits";

const FRIENDS: FriendBalance[] = [
  { friend: "Sam", balance: 1200, lastDate: "2026-10-30" },
  { friend: "Alex", balance: -500, lastDate: "2026-10-29" },
  { friend: "Kim", balance: 0, lastDate: "2026-10-01" },
];

function renderSplits(onChanged = vi.fn()) {
  render(<MoneySplits friends={FRIENDS} recent={[]} readOnly={false} onChanged={onChanged} />);
  return onChanged;
}

describe("split helpers", () => {
  it("words each balance", () => {
    expect(FRIENDS.map(balanceText)).toEqual([
      "Sam owes you £12.00",
      "You owe Alex £5.00",
      "Settled up with Kim",
    ]);
  });

  it("parses unique friend names", () => {
    expect(parseNames(" Sam, alex ,, SAM,Alex ")).toEqual(["Sam", "alex"]);
  });
});

describe("MoneySplits", () => {
  it("settles up by writing the opposite of the balance", async () => {
    mockCommands({ settle_up: undefined });
    const onChanged = renderSplits();
    expect(screen.queryByRole("button", { name: "Settle up with Kim" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settle up with Alex" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalledWith("settle_up", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Settle up with Sam" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm £12.00 paid by Sam" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recorded a settle-up with Sam");
    expect(invoke).toHaveBeenCalledWith("settle_up", {
      friend: "Sam",
      amount: -1200,
      date: localDate(),
    });
    expect(onChanged).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Settle-up undone")).toBeInTheDocument();
    expect(invoke).toHaveBeenLastCalledWith("settle_up", {
      friend: "Sam",
      amount: 1200,
      date: localDate(),
    });
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("shows the error when the undo cannot be written", async () => {
    let calls = 0;
    mockCommands({
      settle_up: () => {
        calls += 1;
        return calls === 1 ? undefined : rejected("Could not write Money/Splits.md.");
      },
    });
    const onChanged = renderSplits();
    fireEvent.click(screen.getByRole("button", { name: "Settle up with Alex" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm £5.00 paid to Alex" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not write Money/Splits.md.");
    expect(invoke).toHaveBeenLastCalledWith("settle_up", {
      friend: "Alex",
      amount: -500,
      date: localDate(),
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("sums what you owe, are owed and the net, in words", () => {
    renderSplits();
    const totals = within(screen.getByLabelText("Split totals"));
    expect(totals.getByText("You owe").nextSibling).toHaveTextContent("£5.00");
    expect(totals.getByText("You are owed").nextSibling).toHaveTextContent("£12.00");
    expect(totals.getByText("Net").nextSibling).toHaveTextContent("£7.00 owed to you");
  });

  it("saves an equal split the owner paid", async () => {
    mockCommands({ add_split: undefined });
    renderSplits();
    fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Dinner" } });
    fireEvent.change(screen.getByLabelText("Total (£)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Friends (comma-separated)"), {
      target: { value: "Sam, Alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(await screen.findByText("Split saved to Money/Splits.md.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: {
        date: localDate(),
        description: "Dinner",
        total: 9000,
        paidBy: null,
        method: "equal",
        people: [
          { name: null, value: 0 },
          { name: "Sam", value: 0 },
          { name: "Alex", value: 0 },
        ],
      },
    });
  });

  it("keeps Save disabled with the reason until the amounts add up", async () => {
    mockCommands({ add_split: rejected("Could not write Money/Splits.md.") });
    renderSplits();
    const save = screen.getByRole("button", { name: "Save split" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("Add what it was for.");
    fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Taxi" } });
    expect(save).toHaveAccessibleDescription("Enter a total like 45.00.");
    fireEvent.change(screen.getByLabelText("Total (£)"), { target: { value: "50" } });
    expect(save).toHaveAccessibleDescription("Add at least one friend.");
    fireEvent.change(screen.getByLabelText("Friends (comma-separated)"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByLabelText("Who paid"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "amounts" } });
    expect(save).toHaveAccessibleDescription("Enter an amount for everyone.");
    expect(screen.getByText("£50.00 left to assign")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Me (£)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Sam (£)"), { target: { value: "20" } });
    expect(screen.getByText("£10.00 left to assign")).toBeInTheDocument();
    expect(save).toHaveAccessibleDescription("Amounts must add up to the total.");
    fireEvent.change(screen.getByLabelText("Sam (£)"), { target: { value: "40" } });
    expect(screen.getByText("£10.00 over")).toBeInTheDocument();
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Sam (£)"), { target: { value: "30" } });
    expect(screen.getByText("Adds up to £50.00")).toBeInTheDocument();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not write");
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: expect.objectContaining({
        paidBy: "Sam",
        method: "amounts",
        people: [
          { name: null, value: 2000 },
          { name: "Sam", value: 3000 },
        ],
      }) as unknown,
    });
  });

  it("saves percentages as exact amounts that add up to the total", async () => {
    mockCommands({ add_split: undefined });
    renderSplits();
    fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Groceries" } });
    fireEvent.change(screen.getByLabelText("Total (£)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Friends (comma-separated)"), {
      target: { value: "Sam, Alex" },
    });
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText("Me (%)"), { target: { value: "33.33" } });
    fireEvent.change(screen.getByLabelText("Sam (%)"), { target: { value: "33.33" } });
    expect(screen.getByText("33.34% left")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save split" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Alex (%)"), { target: { value: "33.34" } });
    expect(screen.getByText("Adds up to 100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(await screen.findByText("Split saved to Money/Splits.md.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: expect.objectContaining({
        total: 1000,
        method: "amounts",
        people: [
          { name: null, value: 333 },
          { name: "Sam", value: 333 },
          { name: "Alex", value: 334 },
        ],
      }) as unknown,
    });
  });

  it("splits by shares and shows the share count", async () => {
    mockCommands({ add_split: undefined });
    renderSplits();
    fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Cabin" } });
    fireEvent.change(screen.getByLabelText("Total (£)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Friends (comma-separated)"), {
      target: { value: "Sam" },
    });
    fireEvent.click(screen.getByLabelText("Include me in the split"));
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "shares" } });
    expect(screen.getByText("Shares: 0 total")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Sam (share)"), { target: { value: "2" } });
    expect(screen.getByText("Shares: 2 total")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(await screen.findByText("Split saved to Money/Splits.md.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: expect.objectContaining({
        method: "shares",
        people: [{ name: "Sam", value: 2 }],
      }) as unknown,
    });
  });

  it("only shows balances in sample mode", () => {
    render(<MoneySplits friends={FRIENDS} recent={[]} readOnly onChanged={vi.fn()} />);
    expect(screen.getByText("Sam owes you £12.00")).toBeInTheDocument();
    expect(screen.getByText("You are owed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
