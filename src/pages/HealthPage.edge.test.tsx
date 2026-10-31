import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, type Health, type HealthDay, type HealthResponse } from "../api";
import { addDays } from "../fitnessStats";
import { invoke } from "../test/tauri-mocks";
import { HealthPage } from "./HealthPage";

const DATE = localDate();
const HOUR = 3_600_000;

function emptyDay(offset: number, over: Partial<HealthDay> = {}): HealthDay {
  return {
    date: addDays(DATE, -offset),
    steps: null,
    activeEnergy: null,
    restingHr: null,
    hrv: null,
    sleep: null,
    weight: null,
    weightSource: null,
    ...over,
  };
}

/** 90 empty days, oldest first; `over` maps an offset (0 = today) to readings. */
function days(over: Record<number, Partial<HealthDay>> = {}): HealthDay[] {
  const out: HealthDay[] = [];
  for (let offset = 89; offset >= 0; offset--) out.push(emptyDay(offset, over[offset]));
  return out;
}

function health(over: Partial<Health> = {}): Health {
  return {
    lastExport: Date.now() - 3 * HOUR,
    latestData: DATE,
    stale: false,
    days: days(),
    ringsDay: null,
    goals: { steps: 8000, activeEnergy: 500, sleepHours: 8 },
    workouts: [],
    badFiles: [],
    badFileCount: 0,
    skippedFiles: 0,
    fileCount: 1,
    ...over,
  };
}

function ready(over: Partial<Health> = {}) {
  invoke.mockResolvedValue({ status: "ready", health: health(over) });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("HealthPage edge cases", () => {
  it("renders a day full of nulls without NaN or crashes", async () => {
    ready();
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Trends" })).toBeInTheDocument();
    expect(screen.getAllByText("No readings in this range.")).toHaveLength(3);
    expect(screen.getByText("No sleep recorded in this range.")).toBeInTheDocument();
    expect(screen.getByText(/No steps, energy or sleep in the exports yet/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
    for (const name of ["Month", "3 months", "Week"]) {
      fireEvent.click(screen.getByRole("tab", { name }));
    }
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("draws a line chart from a single data point", async () => {
    ready({ days: days({ 2: { restingHr: 55 } }) });
    render(<HealthPage onNavigate={vi.fn()} />);
    const card = (await screen.findByRole("heading", { name: "Resting heart rate" })).closest(
      "section",
    );
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("Latest 55 bpm");
    expect(card?.querySelectorAll("circle.line-chart__dot")).toHaveLength(1);
    const rows = within(screen.getByRole("table", { name: "Resting heart rate" })).getAllByRole(
      "row",
    );
    expect(rows).toHaveLength(2);
    expect(card?.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("handles a zero goal without dividing by it", async () => {
    ready({
      goals: { steps: 0, activeEnergy: 0, sleepHours: 0 },
      ringsDay: {
        ...emptyDay(0),
        isToday: true,
        steps: 9120,
        activeEnergy: 410,
        sleep: { total: 7.2, core: 4, deep: 1, rem: 2, awake: 0.2 },
      },
      days: days({ 0: { sleep: { total: 7.2, core: 4, deep: 1, rem: 2, awake: 0.2 } } }),
    });
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    const legend = (await screen.findByText("Active energy")).closest("ul");
    expect(legend?.textContent).toContain("9,120 / 0");
    expect(legend?.textContent).toContain("410 kcal / 0 kcal");
    expect(legend?.textContent).toContain("7 h 12 min / 0 min");
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("shows a ring that is far past its goal as full, not overflowing", async () => {
    ready({
      ringsDay: { ...emptyDay(0), isToday: true, steps: 400_000 },
    });
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByText("Active energy");
    const fills = [...container.querySelectorAll<SVGCircleElement>("circle.rings__fill")];
    expect(fills).toHaveLength(3);
    expect(fills[0].style.strokeDashoffset).toBe("0");
    expect(fills[1].getAttribute("opacity")).toBe("0");
  });

  it("shows a night with only awake time as 0 min asleep", async () => {
    ready({
      days: days({ 1: { sleep: { total: 0, core: 0, deep: 0, rem: 0, awake: 0.5 } } }),
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    const stages = await screen.findByRole("list", { name: "Latest night stages" });
    expect(within(stages).getByText("Awake · 30 min")).toBeInTheDocument();
    expect(within(stages).getByText("Core · 0 min")).toBeInTheDocument();
  });

  it("lists very long workout names in full as text and keeps the list intact", async () => {
    const long = "Marathon ".repeat(200);
    ready({
      workouts: [
        {
          source: "health",
          date: DATE,
          name: long.trim(),
          durationMin: null,
          activeEnergy: null,
          distanceKm: null,
          path: null,
        },
        {
          source: "vault",
          date: DATE,
          name: "Workout",
          durationMin: 0,
          activeEnergy: 0,
          distanceKm: 0,
          path: "Fitness/Log/x.md",
        },
      ],
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    const items = within(
      await screen.findByRole("list", { name: "Workouts, newest first" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(long.trim());
    // Zero is a real value and is shown, unlike a missing one.
    expect(items[1]).toHaveTextContent("0 min");
    expect(items[1]).toHaveTextContent("0 kcal");
    expect(items[1]).toHaveTextContent("0 km");
    expect(items[0]).not.toHaveTextContent("min");
  });

  it("renders workout names that look like markup as plain text", async () => {
    // Tag name built at runtime so static scanners don't read the payload as real markup.
    const tag = ["scr", "ipt"].join("");
    const evil = `<img src=x onerror="window.__pwned=1"><${tag}>window.__pwned=1</${tag}>`;
    ready({
      workouts: [
        {
          source: "health",
          date: DATE,
          name: evil,
          durationMin: 5,
          activeEnergy: null,
          distanceKm: null,
          path: null,
        },
      ],
    });
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("renders a bad file name that contains markup as text", async () => {
    const evil = "<b onmouseover=alert(1)>x</b>&amp;<img src=x>.json";
    ready({
      badFiles: [{ name: evil, reason: "not valid JSON" }],
      badFileCount: 1,
    });
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    const notice = await screen.findByText(/1 export file could not be read and was skipped/);
    expect(notice.textContent).toContain(evil);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("lists at most five bad files and counts the rest, including ones not listed", async () => {
    const names = Array.from({ length: 8 }, (_, i) => `bad${String(i)}.json`);
    ready({
      badFiles: names.map((name) => ({ name, reason: "not valid JSON" })),
      // The backend lists at most 50 but counts them all.
      badFileCount: 120,
    });
    render(<HealthPage onNavigate={vi.fn()} />);
    const notice = await screen.findByText(/120 export files could not be read/);
    expect(notice).toHaveTextContent("bad0.json, bad1.json, bad2.json, bad3.json, bad4.json");
    expect(notice).not.toHaveTextContent("bad5.json");
    expect(notice).toHaveTextContent("and 115 more");
    expect(notice).toHaveTextContent("were skipped");
  });

  it("counts whole days in the stale notice just past the 48 hour edge", async () => {
    ready({ stale: true, lastExport: Date.now() - 48 * HOUR - 60_000 });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No new export for 2 days/)).toBeInTheDocument();
  });

  it("does not warn about staleness when the flag is false, however old the time looks", async () => {
    ready({ stale: false, lastExport: Date.now() - 10 * 24 * HOUR });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/Last export arrived 10 days ago/)).toBeInTheDocument();
    expect(screen.queryByText(/No new export/)).not.toBeInTheDocument();
  });

  it("clears an error when a later fetch succeeds", async () => {
    invoke.mockRejectedValueOnce("the Health folder could not be read: NotFound");
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    ready();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("heading", { name: "Trends" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a slow response that arrives after a newer one", async () => {
    let releaseFirst: (r: HealthResponse) => void = () => undefined;
    invoke.mockReturnValueOnce(
      new Promise<HealthResponse>((resolve) => {
        releaseFirst = resolve;
      }),
    );
    render(<HealthPage onNavigate={vi.fn()} />);
    invoke.mockResolvedValueOnce({
      status: "ready",
      health: health({ workouts: [], skippedFiles: 7 }),
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText(/7 of the oldest were left out/)).toBeInTheDocument();
    await act(async () => {
      releaseFirst({ status: "ready", health: health({ skippedFiles: 0 }) });
      await Promise.resolve();
    });
    expect(screen.getByText(/7 of the oldest were left out/)).toBeInTheDocument();
  });

  it("copes with a response that has fewer than 90 days", async () => {
    ready({ days: days().slice(-3) });
    const { container } = render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "Trends" });
    fireEvent.click(screen.getByRole("tab", { name: "3 months" }));
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("shows the empty-folder card, not the dashboard, with no files and a bad file", async () => {
    ready({ fileCount: 0, badFileCount: 1, badFiles: [{ name: "x.json", reason: "r" }] });
    render(<HealthPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No files yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Workouts" })).not.toBeInTheDocument();
  });
});

describe("HealthPage motion and keyboard", () => {
  function stubMotion(reduce: boolean) {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
    });
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: reduce && q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(document, "startViewTransition", {
      value: startViewTransition,
      configurable: true,
    });
    return startViewTransition;
  }

  it("switches the range at once, with no view transition, under reduced motion", async () => {
    const start = stubMotion(true);
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    const month = await screen.findByRole("tab", { name: "Month" });
    month.focus();
    fireEvent.keyDown(month, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    expect(screen.getByRole("tab", { name: "Week" })).toHaveAttribute("aria-selected", "true");
    expect(start).not.toHaveBeenCalled();
  });

  it("moves instantly with the arrow keys even when motion is allowed (M4)", async () => {
    const start = stubMotion(false);
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    const week = await screen.findByRole("tab", { name: "Week" });
    week.focus();
    fireEvent.keyDown(week, { key: "ArrowRight" });
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Month" })).toHaveFocus();
  });

  it("keeps the tab panel labelled by the selected tab", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByRole("tab", { name: "Week" });
    expect(screen.getByRole("tabpanel", { name: "Week" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "3 months" }));
    expect(screen.getByRole("tabpanel", { name: "3 months" })).toBeInTheDocument();
  });

  it("only the selected tab is in the tab order", async () => {
    ready();
    render(<HealthPage onNavigate={vi.fn()} />);
    await screen.findByRole("tab", { name: "Week" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });
});
