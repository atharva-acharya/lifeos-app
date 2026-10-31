import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, Toast } from "./Toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("shows nothing without a message", () => {
    render(<Toast toast={null} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces the message, offers Undo and closes after five seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    render(<Toast toast={{ id: 1, text: "Saved", onUndo }} onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(TOAST_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays open while hovered and shows errors as alerts", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast toast={{ id: 2, text: "Could not undo", error: true }} onDismiss={onDismiss} />);
    const toast = screen.getByRole("alert");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("disables Undo while it runs", () => {
    render(<Toast toast={{ id: 3, text: "Saved", onUndo: vi.fn() }} onDismiss={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
});
