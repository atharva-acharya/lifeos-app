import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localDate } from "../api";
import { invoke, mockCommands, rejected } from "../test/tauri-mocks";
import { MoneySplitFlow } from "./MoneySplitFlow";

function renderFlow(onSaved = vi.fn()) {
  render(
    <MoneySplitFlow
      open
      onClose={vi.fn()}
      trigger={{ current: null }}
      known={["Sam", "Alex"]}
      onSaved={onSaved}
    />,
  );
  return onSaved;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

/** Step 1: the total and what it was for, then on to Who. */
function amount(total: string, what: string) {
  fireEvent.change(screen.getByLabelText("Bill total in pounds"), { target: { value: total } });
  fireEvent.change(screen.getByLabelText("What it was for"), { target: { value: what } });
  fireEvent.click(button("Next: who was there"));
}

describe("MoneySplitFlow", () => {
  it("saves an equal split the owner paid, showing each share live", async () => {
    mockCommands({ add_split: undefined });
    const onSaved = renderFlow();
    expect(button("Enter the bill total.")).toBeDisabled();
    amount("90", "Dinner");
    expect(button("Pick at least one friend.")).toBeDisabled();
    fireEvent.click(button("Sam"));
    fireEvent.click(button("Alex"));
    fireEvent.click(button("Next: split between 3"));
    // Equally: £30.00 each, shown beside every name before saving.
    expect(screen.getAllByText("£30.00")).toHaveLength(3);
    fireEvent.click(button("Split £90.00 with 2"));
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith("Split £90.00 with Sam, Alex");
    });
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

  it("keeps Save off until exact amounts add up, then shows save errors", async () => {
    mockCommands({ add_split: rejected("Could not write Money/Splits.md.") });
    renderFlow();
    amount("50", "Taxi");
    fireEvent.click(button("Sam"));
    fireEvent.click(screen.getByRole("radio", { name: "Sam paid" }));
    fireEvent.click(button("Next: split between 2"));
    fireEvent.click(screen.getByRole("radio", { name: "Exact amounts" }));
    expect(button("Enter an amount for everyone.")).toBeDisabled();
    expect(screen.getByText("£50.00 left to assign")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Your £"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Sam's £"), { target: { value: "40" } });
    expect(screen.getByText("£10.00 over")).toBeInTheDocument();
    expect(button("Amounts must add up to the total.")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Sam's £"), { target: { value: "30" } });
    expect(screen.getByText("Adds up to £50.00")).toBeInTheDocument();
    fireEvent.click(button("Split £50.00 with 1"));
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
    const onSaved = renderFlow();
    amount("10", "Groceries");
    fireEvent.click(button("Sam"));
    fireEvent.click(button("Alex"));
    fireEvent.click(button("Next: split between 3"));
    fireEvent.click(screen.getByRole("radio", { name: "Percent" }));
    fireEvent.change(screen.getByLabelText("Your %"), { target: { value: "33.33" } });
    fireEvent.change(screen.getByLabelText("Sam's %"), { target: { value: "33.33" } });
    expect(screen.getByText("33.34% left")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Alex's %"), { target: { value: "33.34" } });
    expect(screen.getByText("Adds up to 100%")).toBeInTheDocument();
    fireEvent.click(button("Split £10.00 with 2"));
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
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

  it("splits by shares without the owner, and adds someone new", async () => {
    mockCommands({ add_split: undefined });
    const onSaved = renderFlow();
    amount("300", "Cabin");
    fireEvent.click(button("You"));
    fireEvent.change(screen.getByLabelText("Add someone new"), { target: { value: "Robin" } });
    fireEvent.click(button("Add"));
    fireEvent.click(button("Next: split between 1"));
    fireEvent.click(screen.getByRole("radio", { name: "Shares" }));
    expect(screen.getByText("Shares: 0 total")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Robin's shares"), { target: { value: "2" } });
    expect(screen.getByText("Shares: 2 total")).toBeInTheDocument();
    fireEvent.click(button("Split £300.00 with 1"));
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(invoke).toHaveBeenCalledWith("add_split", {
      split: expect.objectContaining({
        method: "shares",
        people: [{ name: "Robin", value: 2 }],
      }) as unknown,
    });
  });
});
