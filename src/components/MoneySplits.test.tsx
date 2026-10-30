import { fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: "Settle up with Sam" }));
    expect(await screen.findByText("Recorded a settle-up with Sam.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("settle_up", {
      friend: "Sam",
      amount: -1200,
      date: localDate(),
    });
    expect(onChanged).toHaveBeenCalled();
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

  it("splits by amount when a friend paid, and shows core errors", async () => {
    mockCommands({ add_split: rejected("The amounts add up to 40.00, not the total of 50.00.") });
    renderSplits();
    fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Taxi" } });
    fireEvent.change(screen.getByLabelText("Total (£)"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Friends (comma-separated)"), {
      target: { value: "Sam" },
    });
    fireEvent.change(screen.getByLabelText("Who paid"), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText("Split"), { target: { value: "amounts" } });

    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an amount for everyone.");

    fireEvent.change(screen.getByLabelText("Me (£)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Sam (£)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save split" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("add up to 40.00");
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: expect.objectContaining({
        paidBy: "Sam",
        method: "amounts",
        people: [
          { name: null, value: 2000 },
          { name: "Sam", value: 2000 },
        ],
      }) as unknown,
    });
  });

  it("only shows balances in sample mode", () => {
    render(<MoneySplits friends={FRIENDS} recent={[]} readOnly onChanged={vi.fn()} />);
    expect(screen.getByText("Sam owes you £12.00")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
