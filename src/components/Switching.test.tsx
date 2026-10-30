import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { invoke, mockCommands } from "../test/tauri-mocks";
import { NotConnected } from "./NotConnected";
import { SampleBanner } from "./SampleBanner";

describe("one switch at a time", () => {
  it("disables every sample button while entering is pending", async () => {
    let finish: (mode: string) => void = () => undefined;
    mockCommands({
      enter_sample_mode: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    render(
      <>
        <NotConnected onNavigate={vi.fn()}>First card.</NotConnected>
        <NotConnected onNavigate={vi.fn()}>Second card.</NotConnected>
        <SampleBanner onLeft={vi.fn()} />
      </>,
    );
    const [first, second] = screen.getAllByRole("button", { name: "Try with sample data" });
    fireEvent.click(first);
    await vi.waitFor(() => {
      expect(second).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Leave sample data" })).toBeDisabled();
    fireEvent.click(second);
    expect(invoke.mock.calls.filter((c) => c[0] === "enter_sample_mode")).toHaveLength(1);
    finish("real");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Leave sample data" })).toBeEnabled();
    });
  });
});
