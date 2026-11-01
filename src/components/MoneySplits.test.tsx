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

  it("only shows balances in sample mode", () => {
    render(<MoneySplits friends={FRIENDS} recent={[]} readOnly onChanged={vi.fn()} />);
    expect(screen.getByText("Sam owes you £12.00")).toBeInTheDocument();
    expect(screen.getByText("You are owed")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
