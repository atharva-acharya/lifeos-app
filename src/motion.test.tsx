import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { HealthTrends } from "./components/HealthTrends";
import { fromKeyboard, withTransition } from "./motion";
import { mockCommands } from "./test/tauri-mocks";

type Start = (cb: () => void) => unknown;

let start: ReturnType<typeof vi.fn<Start>>;

beforeEach(() => {
  start = vi.fn<Start>((cb) => {
    cb();
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: start,
  });
});

afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("withTransition", () => {
  it("animates by default", () => {
    const update = vi.fn();
    withTransition(update);
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("applies an instant change without a view transition (M4)", () => {
    const update = vi.fn();
    withTransition(update, { instant: true });
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("tells keyboard clicks from pointer clicks", () => {
    expect(fromKeyboard({ detail: 0 })).toBe(true);
    expect(fromKeyboard({ detail: 1 })).toBe(false);
  });
});

describe("page changes", () => {
  beforeEach(() => {
    mockCommands({ get_today: { status: "noVault" } });
  });

  it("animates a mouse click in the sidebar", async () => {
    render(<App />);
    const fitness = await screen.findByRole("button", { name: "Fitness" });
    start.mockClear();
    fireEvent.click(fitness, { detail: 1 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1, name: "Fitness" })).toBeInTheDocument();
  });

  it("does not animate Enter or Space on a sidebar item", async () => {
    render(<App />);
    const fitness = await screen.findByRole("button", { name: "Fitness" });
    start.mockClear();
    // A click from the keyboard reports no pointer presses.
    fireEvent.click(fitness, { detail: 0 });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Fitness" })).toBeInTheDocument();
  });

  it("does not animate Ctrl+K", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Today" });
    start.mockClear();
    act(() => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
  });
});

describe("tab changes", () => {
  it("animates a mouse click on a range tab", () => {
    render(<HealthTrends days={[]} sleepGoal={8} />);
    fireEvent.click(screen.getByRole("tab", { name: "Month" }), { detail: 1 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves instantly with the arrow keys", () => {
    render(<HealthTrends days={[]} sleepGoal={8} />);
    const week = screen.getByRole("tab", { name: "Week" });
    fireEvent.keyDown(week, { key: "ArrowRight" });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Month" })).toHaveFocus();
  });

  it("does not animate Enter or Space on a range tab", () => {
    render(<HealthTrends days={[]} sleepGoal={8} />);
    fireEvent.click(screen.getByRole("tab", { name: "Month" }), { detail: 0 });
    expect(start).not.toHaveBeenCalled();
  });
});
