import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FitnessDay, FitnessPlan, FitnessWorkout, Lift } from "../api";
import { FitnessActivity } from "./FitnessActivity";
import { exerciseText, FitnessHistory } from "./FitnessHistory";
import { FitnessLifts } from "./FitnessLifts";
import { FitnessWeek } from "./FitnessWeek";
import { FitnessWeight } from "./FitnessWeight";

const TODAY = "2026-01-14";

function day(date: string, over: Partial<FitnessDay> = {}): FitnessDay {
  return { date, weight: null, steps: null, proteinG: null, ...over };
}

function plan(over: Partial<FitnessPlan> = {}): FitnessPlan {
  return {
    name: null,
    start: "2026-01-01",
    end: "2026-03-01",
    startWeight: 90,
    targetWeight: 80,
    stepsGoal: 8000,
    proteinGoal: 170,
    ...over,
  };
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exerciseText", () => {
  const set = { name: "Squat", sets: 3, reps: 5, kg: 100, raw: "Squat 3x5@100" };

  it("formats a parsed line and shows anything unparsed as written", () => {
    expect(exerciseText(set)).toBe("Squat 3 × 5 @ 100 kg");
    expect(exerciseText({ ...set, kg: null })).toBe("Squat 3x5@100");
    expect(exerciseText({ ...set, sets: null })).toBe("Squat 3x5@100");
    expect(exerciseText({ ...set, reps: null })).toBe("Squat 3x5@100");
  });

  it("falls back to the name for a blank raw line and keeps zeros", () => {
    expect(exerciseText({ name: "x", sets: null, reps: null, kg: null, raw: "  " })).toBe("x");
    expect(exerciseText({ ...set, sets: 0, reps: 0, kg: 0 })).toBe("Squat 0 × 0 @ 0 kg");
  });

  it("renders markup-looking text as plain text", () => {
    render(
      <FitnessHistory
        workouts={[
          workout({
            exercises: [
              {
                name: "<img src=x onerror=alert(1)>",
                sets: null,
                reps: null,
                kg: null,
                raw: "<img src=x onerror=alert(1)>",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("FitnessWeek", () => {
  it("shows zeros and the goals with no data", () => {
    render(
      <FitnessWeek
        summary={{ avgSteps: null, proteinDays: 0, sessions: 0, stepsGoal: 8000, proteinGoal: 170 }}
      />,
    );
    expect(screen.getByText("0 / 8,000")).toBeInTheDocument();
    expect(screen.getByText("0 / 7")).toBeInTheDocument();
    expect(screen.getByText("0 / 5")).toBeInTheDocument();
    expect(screen.getByText(/Protein goal is 170 g/)).toBeInTheDocument();
  });

  it("does not produce NaN or Infinity for a zero goal", () => {
    const { container } = render(
      <FitnessWeek
        summary={{ avgSteps: 5000, proteinDays: 3, sessions: 9, stepsGoal: 0, proteinGoal: 0 }}
      />,
    );
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(screen.getByText("5,000 / 0")).toBeInTheDocument();
    expect(screen.getByText("9 / 5")).toBeInTheDocument();
  });
});

describe("FitnessWeight", () => {
  it("shows the empty state, a hint and no chart when there are no weigh-ins", () => {
    const { container } = render(<FitnessWeight days={[]} plan={null} today={TODAY} />);
    expect(screen.getByText("No weigh-ins in the last 90 days.")).toBeInTheDocument();
    expect(screen.getByText(/No target line yet/)).toBeInTheDocument();
    expect(container.querySelector(".chart__plot")).toBeNull();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Latest/);
  });

  it("shows only the empty state when days have steps but no weight", () => {
    render(<FitnessWeight days={[day(TODAY, { steps: 5000 })]} plan={plan()} today={TODAY} />);
    expect(screen.getByText("No weigh-ins in the last 90 days.")).toBeInTheDocument();
    expect(screen.queryByText(/No target line yet/)).not.toBeInTheDocument();
  });

  it("hides the plot from assistive tech and offers a table instead", () => {
    const { container } = render(
      <FitnessWeight
        days={[day("2026-01-10", { weight: 84 }), day(TODAY, { weight: 83.2 })]}
        plan={plan()}
        today={TODAY}
      />,
    );
    const plot = container.querySelector(".chart__plot");
    expect(plot).toHaveAttribute("aria-hidden", "true");
    const table = screen.getByRole("table", { name: "Weight over the last 90 days" });
    expect(table).toHaveClass("sr-only");
    expect(plot?.contains(table)).toBe(false);
    // One row per weigh-in plus the header.
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("83.2", { selector: ".metric__value" })).toHaveTextContent(
      "Latest 83.2 kg",
    );
  });

  it("omits the target line and shows the hint when the plan has no target", () => {
    const { container } = render(
      <FitnessWeight
        days={[day(TODAY, { weight: 83 })]}
        plan={plan({ targetWeight: null })}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/No target line yet/)).toBeInTheDocument();
    expect(container.querySelector(".line-chart__line--dashed")).toBeNull();
  });

  it("hints when the plan ended before the window so no point falls in range", () => {
    render(
      <FitnessWeight
        days={[day(TODAY, { weight: 83 })]}
        plan={plan({ start: "2020-01-01", end: "2020-02-01" })}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/No target line yet/)).toBeInTheDocument();
  });

  it("draws a dashed target when the plan covers today, with dashes in the table", () => {
    const { container } = render(
      <FitnessWeight days={[day(TODAY, { weight: 83 })]} plan={plan()} today={TODAY} />,
    );
    expect(container.querySelector(".line-chart__line--dashed")).not.toBeNull();
    expect(screen.queryByText(/No target line yet/)).not.toBeInTheDocument();
  });

  it("shows the 7-day change only when there is a reading a week earlier", () => {
    const { rerender } = render(
      <FitnessWeight days={[day(TODAY, { weight: 83 })]} plan={null} today={TODAY} />,
    );
    expect(screen.queryByText(/7-day change/)).not.toBeInTheDocument();
    rerender(
      <FitnessWeight
        days={[day("2026-01-07", { weight: 84 }), day(TODAY, { weight: 83 })]}
        plan={null}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/7-day change/)).toHaveTextContent("−1.0 kg");
  });

  it("does not crash on a single reading or a weight of zero", () => {
    render(<FitnessWeight days={[day(TODAY, { weight: 0 })]} plan={null} today={TODAY} />);
    expect(screen.getByText("0.0", { selector: ".metric__value" })).toHaveTextContent(
      "Latest 0.0 kg",
    );
  });
});

describe("FitnessActivity", () => {
  it("renders 14 empty days with no data", () => {
    render(<FitnessActivity days={[]} proteinGoal={170} today={TODAY} />);
    const list = screen.getByRole("list", { name: "Protein by day" });
    expect(within(list).getAllByText(/No data/)).toHaveLength(14);
    expect(screen.getByText(/hit on/)).toHaveTextContent("0 of 14");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(15);
    expect(within(table).getAllByText("—")).toHaveLength(28);
  });

  it("hides the chart from assistive tech and keeps a captioned table", () => {
    const { container } = render(
      <FitnessActivity
        days={[day(TODAY, { steps: 9000, proteinG: 170 })]}
        proteinGoal={170}
        today={TODAY}
      />,
    );
    expect(container.querySelector(".chart__plot")).toHaveAttribute("aria-hidden", "true");
    const table = screen.getByRole("table");
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByText("Steps and protein, last 14 days")).toBeInTheDocument();
    expect(within(table).getByText("9000")).toBeInTheDocument();
  });

  it("separates missed, hit and zero-protein days", () => {
    render(
      <FitnessActivity
        days={[
          day(TODAY, { proteinG: 170 }),
          day("2026-01-13", { proteinG: 169 }),
          day("2026-01-12", { proteinG: 0 }),
        ]}
        proteinGoal={170}
        today={TODAY}
      />,
    );
    const list = screen.getByRole("list", { name: "Protein by day" });
    expect(within(list).getAllByText(/Hit/)).toHaveLength(1);
    expect(within(list).getAllByText(/Missed/)).toHaveLength(2);
    expect(within(list).getAllByText(/No data/)).toHaveLength(11);
  });

  it("ignores days older than 14 and shows zero steps as 0, not a dash", () => {
    render(
      <FitnessActivity
        days={[day("2025-12-01", { steps: 5, proteinG: 500 }), day(TODAY, { steps: 0 })]}
        proteinGoal={170}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/hit on/)).toHaveTextContent("0 of 14");
    expect(within(screen.getByRole("table")).getByText("0")).toBeInTheDocument();
  });

  it("works across a year boundary", () => {
    render(
      <FitnessActivity
        days={[day("2025-12-31", { proteinG: 200 }), day("2026-01-01", { proteinG: 200 })]}
        proteinGoal={170}
        today="2026-01-02"
      />,
    );
    expect(screen.getByText(/hit on/)).toHaveTextContent("2 of 14");
  });
});

describe("FitnessHistory", () => {
  it("shows the empty state with no tabs", () => {
    render(<FitnessHistory workouts={[]} />);
    expect(screen.getByText("No workouts logged yet.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("shows partial sessions without week, duration or exercises", () => {
    render(<FitnessHistory workouts={[workout()]} />);
    expect(screen.getByText("12 Jan")).toBeInTheDocument();
    expect(screen.queryByText(/^Week/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ min$/)).not.toBeInTheDocument();
    expect(screen.queryByText("Deload")).not.toBeInTheDocument();
  });

  it("shows a zero week and zero minutes (not hidden as falsy)", () => {
    render(<FitnessHistory workouts={[workout({ week: 0, durationMin: 0 })]} />);
    expect(screen.getByText("Week 0")).toBeInTheDocument();
    expect(screen.getByText("0 min")).toBeInTheDocument();
  });

  it("opens on Other when the newest workout has no day, and keeps tabs reachable", () => {
    render(
      <FitnessHistory
        workouts={[
          workout({ path: "n.md", day: null, date: null }),
          workout({ path: "l.md", day: "Legs" }),
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Other" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(6);
    fireEvent.click(screen.getByRole("tab", { name: "Legs" }));
    expect(screen.getByRole("tab", { name: "Legs" })).toHaveAttribute("aria-selected", "true");
  });

  it("lists no tab for a day outside the five standard ones", () => {
    render(<FitnessHistory workouts={[workout({ day: "Rest" })]} />);
    // The core only accepts the five days, so this cannot happen from a vault.
    expect(screen.getAllByRole("tab")).toHaveLength(5);
  });

  it("has a tabpanel labelled by the selected tab and tabs are real buttons", () => {
    render(<FitnessHistory workouts={[workout()]} />);
    const tab = screen.getByRole("tab", { name: "Legs" });
    expect(tab.tagName).toBe("BUTTON");
    expect(tab).toHaveAttribute("aria-controls", "workout-panel");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("gives a tab with a space an id without spaces and the panel its name", () => {
    render(<FitnessHistory workouts={[workout({ day: "Push A" })]} />);
    const tab = screen.getByRole("tab", { name: "Push A" });
    expect(tab.id).toBe("workout-tab-push-a");
    expect(tab.id).not.toMatch(/\s/);
    expect(screen.getByRole("tabpanel", { name: "Push A" })).toBeInTheDocument();
  });

  it("selects a tab by keyboard activation and moves focus with Tab", () => {
    render(<FitnessHistory workouts={[workout()]} />);
    const pull = screen.getByRole("tab", { name: "Pull A" });
    pull.focus();
    expect(pull).toHaveFocus();
    // A button fires click on Enter or Space; jsdom does not, so use click.
    fireEvent.click(pull);
    expect(pull).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("No Pull A sessions yet.")).toBeInTheDocument();
  });

  it("changes tabs immediately when the owner prefers reduced motion", () => {
    const startViewTransition = vi.fn();
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(document, "startViewTransition", {
      value: startViewTransition,
      configurable: true,
    });
    try {
      render(<FitnessHistory workouts={[workout()]} />);
      fireEvent.click(screen.getByRole("tab", { name: "Push A" }));
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(screen.getByRole("tab", { name: "Push A" })).toHaveAttribute("aria-selected", "true");
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
    }
  });

  it("uses a view transition for a mouse click when motion is allowed", () => {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
    });
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(document, "startViewTransition", {
      value: startViewTransition,
      configurable: true,
    });
    try {
      render(<FitnessHistory workouts={[workout()]} />);
      fireEvent.click(screen.getByRole("tab", { name: "Push A" }), { detail: 1 });
      expect(startViewTransition).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("tab", { name: "Push A" })).toHaveAttribute("aria-selected", "true");
    } finally {
      Reflect.deleteProperty(document, "startViewTransition");
    }
  });

  it("lists several sessions of one day newest first as given", () => {
    render(
      <FitnessHistory
        workouts={[
          workout({ path: "b.md", date: "2026-01-12" }),
          workout({ path: "a.md", date: "2026-01-05" }),
        ]}
      />,
    );
    const items = within(screen.getByRole("tabpanel")).getAllByText(/Jan$/);
    expect(items.map((e) => e.textContent)).toEqual(["12 Jan", "5 Jan"]);
  });
});

describe("FitnessLifts", () => {
  const lift = (name: string, kgs: number[]): Lift => ({
    name,
    sessions: kgs.map((kg, i) => ({
      date: `2026-01-0${String(i + 1)}`,
      kg,
      reps: i === 0 ? null : 5,
    })),
  });

  it("shows the empty state and still says deloads are left out", () => {
    const { container } = render(<FitnessLifts lifts={[]} />);
    expect(screen.getByText("No lifts with a weight logged yet.")).toBeInTheDocument();
    expect(screen.getByText(/Deload weeks are left out/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container.querySelector(".chart__plot")).toBeNull();
  });

  it("charts a single-session lift, singular label, and dashes for unknown reps", () => {
    const { container } = render(<FitnessLifts lifts={[lift("Squat", [100])]} />);
    expect(screen.getByText("1 session")).toBeInTheDocument();
    expect(container.querySelector(".chart__plot")).toHaveAttribute("aria-hidden", "true");
    const table = screen.getByRole("table", { name: "Squat: top set per session" });
    expect(table).toHaveClass("sr-only");
    expect(within(table).getByText("—")).toBeInTheDocument();
  });

  it("is keyboard operable: a labelled native select that switches the lift", () => {
    render(<FitnessLifts lifts={[lift("Squat", [100, 105]), lift("Bench", [60])]} />);
    const select = screen.getByRole("combobox", { name: "Exercise" });
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByText("2 sessions")).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "Bench" } });
    expect(select).toHaveValue("Bench");
    expect(screen.getByRole("table", { name: "Bench: top set per session" })).toBeInTheDocument();
  });

  it("falls back to the first lift when the chosen one disappears", () => {
    const { rerender } = render(
      <FitnessLifts lifts={[lift("Squat", [100]), lift("Bench", [60])]} />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Bench" } });
    rerender(<FitnessLifts lifts={[lift("Squat", [100])]} />);
    expect(screen.getByRole("combobox")).toHaveValue("Squat");
  });

  it("shows exercise names as text, not markup", () => {
    render(<FitnessLifts lifts={[lift("<b>Squat</b>", [100])]} />);
    expect(screen.getByRole("option", { name: "<b>Squat</b>" })).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });
});
