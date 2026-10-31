import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Metric } from "./components/Card";
import { COUNT_UP_MS, useCountUp } from "./useCountUp";

/** A hand-driven requestAnimationFrame: `tick(ms)` runs one frame at that time. */
let frames: Map<number, FrameRequestCallback>;
let nextId: number;

function tick(time: number): void {
  const due = [...frames.values()];
  frames.clear();
  act(() => {
    for (const cb of due) cb(time);
  });
}

function reduceMotion(on: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: on && query.includes("reduce"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => {
      frames.delete(id);
    }),
  );
  reduceMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCountUp", () => {
  it("shows the first value at once", () => {
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
    expect(frames.size).toBe(0);
  });

  it("counts to a new value over 400 ms, ease-out", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 100 });
    expect(result.current).toBe(0);

    tick(1000); // first frame starts the clock
    expect(result.current).toBe(0);
    tick(1000 + COUNT_UP_MS / 2);
    // Ease-out: past the halfway number at half the time.
    expect(result.current).toBeGreaterThan(50);
    expect(result.current).toBeLessThan(100);
    tick(1000 + COUNT_UP_MS);
    expect(result.current).toBe(100);
    expect(frames.size).toBe(0);
  });

  it("counts down as well as up", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 10 },
    });
    rerender({ v: 4 });
    tick(0);
    tick(COUNT_UP_MS / 2);
    expect(result.current).toBeLessThan(10);
    expect(result.current).toBeGreaterThan(4);
    tick(COUNT_UP_MS);
    expect(result.current).toBe(4);
  });

  it("starts an interrupted count from the number on screen", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 100 });
    tick(0);
    tick(COUNT_UP_MS / 2);
    const midway = result.current;
    rerender({ v: 0 });
    tick(500);
    expect(result.current).toBe(midway);
    tick(500 + COUNT_UP_MS);
    expect(result.current).toBe(0);
  });

  it("jumps straight to the value under reduce motion", () => {
    reduceMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 1 },
    });
    rerender({ v: 9 });
    expect(result.current).toBe(9);
    expect(frames.size).toBe(0);
  });

  it("does not animate values that are not finite numbers", () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 5 },
    });
    rerender({ v: Number.NaN });
    expect(result.current).toBeNaN();
    expect(frames.size).toBe(0);
    rerender({ v: 7 });
    expect(result.current).toBe(7);
    expect(frames.size).toBe(0);
  });

  it("stops its frames on unmount", () => {
    const { rerender, unmount } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 0 },
    });
    rerender({ v: 3 });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe("Metric count", () => {
  it("formats the counted number and keeps the unit", () => {
    const { rerender } = render(
      <Metric label="Weight" color="red" count={80} format={(n) => n.toFixed(1)} unit="kg" />,
    );
    expect(screen.getByText("80.0")).toBeInTheDocument();
    rerender(
      <Metric label="Weight" color="red" count={81} format={(n) => n.toFixed(1)} unit="kg" />,
    );
    tick(0);
    tick(COUNT_UP_MS);
    expect(screen.getByText("81.0")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("rounds to whole numbers by default while counting", () => {
    const { rerender } = render(<Metric label="Due" color="red" count={0} />);
    rerender(<Metric label="Due" color="red" count={3} />);
    tick(0);
    tick(COUNT_UP_MS / 3);
    expect(screen.getByLabelText("Due").querySelector(".metric__value")?.textContent).toMatch(
      /^\d+$/,
    );
  });

  it("still shows a plain value when no count is given", () => {
    render(<Metric label="Gym session" color="red" value="Rest day" />);
    expect(screen.getByText("Rest day")).toBeInTheDocument();
  });
});
