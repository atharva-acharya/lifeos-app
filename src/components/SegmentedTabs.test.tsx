import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FitnessWorkout } from "../api";
import { JobsPage } from "../pages/JobsPage";
import { invoke } from "../test/tauri-mocks";
import { FitnessHistory } from "./FitnessHistory";
import { SegmentedTabs } from "./SegmentedTabs";

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

const ITEMS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
] as const;
type Id = (typeof ITEMS)[number]["id"];

function Harness({ onChange }: { onChange: (id: Id, instant: boolean) => void }) {
  const [value, setValue] = useState<Id>("a");
  return (
    <SegmentedTabs
      items={ITEMS}
      value={value}
      label="Letters"
      tabId={(id) => `t-${id}`}
      panelId={(id) => `p-${id}`}
      onChange={(next, instant) => {
        onChange(next, instant);
        setValue(next);
      }}
    />
  );
}

function workout(over: Partial<FitnessWorkout> = {}): FitnessWorkout {
  return {
    path: "a.md",
    date: "2026-01-12",
    day: "Legs",
    week: null,
    deload: false,
    durationMin: null,
    exercises: [],
    ...over,
  };
}

describe("SegmentedTabs", () => {
  it("is a tablist with a roving tab stop on the selected segment", () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Letters" })).toHaveClass("segmented");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-controls", "p-b");
  });

  it("moves with the arrow keys, Home and End, wrapping, and reports it as instant", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    fireEvent.keyDown(alpha, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c", true);
    expect(screen.getByRole("tab", { name: "Gamma" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Gamma" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a", true);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c", true);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Gamma" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a", true);
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveFocus();
  });

  it("ignores other keys", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Alpha" }), { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tells a mouse click (animated) from Enter or Space (instant)", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }), { detail: 1 });
    expect(onChange).toHaveBeenLastCalledWith("b", false);
    fireEvent.click(screen.getByRole("tab", { name: "Gamma" }), { detail: 0 });
    expect(onChange).toHaveBeenLastCalledWith("c", true);
  });

  it("slides the indicator for a click and places it instantly for a key", () => {
    // jsdom has no layout; give the segments a size so the indicator is placed.
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
    try {
      render(<Harness onChange={vi.fn()} />);
      const list = screen.getByRole("tablist");
      const bar = list.querySelector<HTMLElement>(".segmented__indicator");
      // The first paint never animates.
      expect(list).toHaveAttribute("data-ready");
      expect(list).toHaveAttribute("data-instant");
      expect(bar?.style.transform).toContain("scaleX(0.8)");
      expect(bar?.style.height).toBe("32px");
      fireEvent.click(screen.getByRole("tab", { name: "Beta" }), { detail: 1 });
      expect(list).not.toHaveAttribute("data-instant");
      fireEvent.keyDown(screen.getByRole("tab", { name: "Beta" }), { key: "ArrowRight" });
      expect(list).toHaveAttribute("data-instant");
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });

  it("keeps the plain selected background until it can measure", () => {
    render(<Harness onChange={vi.fn()} />);
    expect(screen.getByRole("tablist")).not.toHaveAttribute("data-ready");
  });
});

describe("Jobs view tabs (C5)", () => {
  it("move with the arrow keys instantly, without a view transition", async () => {
    invoke.mockResolvedValue({ status: "notConfigured" });
    render(<JobsPage onNavigate={vi.fn()} />);
    const pipeline = await screen.findByRole("tab", { name: "Pipeline" });
    fireEvent.keyDown(pipeline, { key: "ArrowRight" });
    expect(start).not.toHaveBeenCalled();
    const outreach = screen.getByRole("tab", { name: "Outreach" });
    expect(outreach).toHaveAttribute("aria-selected", "true");
    expect(outreach).toHaveFocus();
    fireEvent.keyDown(outreach, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Applications" })).toHaveFocus();
    expect(start).not.toHaveBeenCalled();
  });

  it("animate a mouse click", async () => {
    invoke.mockResolvedValue({ status: "notConfigured" });
    render(<JobsPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Charts" }), { detail: 1 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("tab", { name: "Charts" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Workout day tabs (C5)", () => {
  it("move with the arrow keys and End instantly", () => {
    render(<FitnessHistory workouts={[workout()]} />);
    const legs = screen.getByRole("tab", { name: "Legs" });
    expect(legs).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(legs, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Push B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Push B" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Push B" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "Pull B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No Pull B sessions yet.")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });
});
