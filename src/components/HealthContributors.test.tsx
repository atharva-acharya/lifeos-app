import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HealthDay, HealthRingsDay } from "../api";
import { FitnessWeek } from "./FitnessWeek";
import { TrendCard } from "./HealthTrendCard";
import { HealthSleep } from "./HealthSleep";
import { HealthToday } from "./HealthToday";

const GOALS = { steps: 10000, activeEnergy: 500, sleepHours: 8 };

/** 31 synthetic days ending 2026-10-31; the last one is "today". */
const DAYS: HealthDay[] = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`,
  steps: i === 30 ? 7600 : 8000,
  activeEnergy: i === 30 ? null : 450,
  restingHr: i === 30 ? 55 : 58,
  hrv: 50,
  sleep: { total: i === 30 ? 6.5 : 7, core: 4, deep: 1, rem: 1.5, awake: 0.5 },
  weight: 72,
  weightSource: "health",
}));

const TODAY: HealthRingsDay = { ...DAYS[30], isToday: true };

describe("HealthToday", () => {
  it("says what to do next under each ring (P3)", () => {
    render(<HealthToday day={TODAY} goals={GOALS} days={DAYS} />);
    expect(screen.getByText("2,400 steps to go")).toBeInTheDocument();
    expect(screen.getByText("Nothing recorded yet")).toBeInTheDocument();
    expect(screen.getByText("1 h 30 min short of your sleep goal")).toBeInTheDocument();
  });

  it("opens what is behind today from its button, each input against the 30-day average", async () => {
    render(<HealthToday day={TODAY} goals={GOALS} days={DAYS} />);
    const button = screen.getByRole("button", { name: "What’s behind today" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    const sheet = screen.getByRole("dialog", { name: "What’s behind today" });
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Steps");
    expect(rows[0]).toHaveTextContent("400 steps below your 30-day average");
    expect(rows[0]).toHaveTextContent("7,600 steps");
    expect(rows[0]).toHaveTextContent("Down");
    // Missing today: a dash, never blank (T8).
    expect(rows[1]).toHaveTextContent("Active energy");
    expect(rows[1]).toHaveTextContent("—");
    expect(rows[1]).toHaveTextContent("No reading");
    expect(rows[3]).toHaveTextContent("3 bpm below your 30-day average");
    expect(rows[4]).toHaveTextContent("Level with your 30-day average");
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  it("opens the sheet when the card itself is clicked", () => {
    render(<HealthToday day={TODAY} goals={GOALS} days={DAYS} />);
    fireEvent.click(screen.getByText("2,400 steps to go"));
    expect(screen.getByRole("dialog", { name: "What’s behind today" })).toBeInTheDocument();
  });

  it("names a past day when today has no data", () => {
    render(<HealthToday day={{ ...DAYS[29], isToday: false }} goals={GOALS} days={DAYS} />);
    expect(screen.getByText("Ended 2,000 steps short")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What’s behind 30 Oct" }));
    expect(screen.getByRole("dialog", { name: "What’s behind 30 Oct" })).toBeInTheDocument();
  });

  it("has no sheet with no data", () => {
    render(<HealthToday day={null} goals={GOALS} />);
    expect(screen.queryByRole("button", { name: /What’s behind/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Today" })).toHaveClass("card", "rings-card");
  });

  it("draws the large rings in a lit card titled inside it, like Today's", () => {
    render(<HealthToday day={TODAY} goals={GOALS} days={DAYS} />);
    const card = screen.getByRole("region", { name: "Today" });
    expect(card).toHaveClass("card", "rings-card");
    expect(within(card).getByRole("heading", { name: "Today" })).toHaveClass("card__title");
    expect(card.querySelector(".rings--hero")).not.toBeNull();
    expect(card.querySelector(".rings--hero svg")).toHaveAttribute("width", "200");
    // The big number with its goal in grey after it.
    expect(bigNumbers(card)).toEqual(["7,600 of 10,000", "0 of 500 kcal", "6 h 30 min of 8 h"]);
  });
});

/** Each large ring's number with its goal, e.g. "4 of 7". */
function bigNumbers(card: HTMLElement): string[] {
  return [...card.querySelectorAll(".rings__big")].map((e) => e.textContent);
}

describe("FitnessWeek", () => {
  const SUMMARY = {
    avgSteps: 9120,
    proteinDays: 4,
    sessions: 3,
    stepsGoal: 8000,
    proteinGoal: 170,
  };

  it("draws the large rings in a lit card titled inside it, like Today's", () => {
    render(<FitnessWeek summary={SUMMARY} />);
    const card = screen.getByRole("region", { name: "This week" });
    expect(card).toHaveClass("card", "rings-card");
    expect(within(card).getByRole("heading", { name: "This week" })).toHaveClass("card__title");
    expect(card.querySelector(".rings--hero")).not.toBeNull();
    expect(within(card).getByText("3 of 5 sessions")).toHaveClass("card__aside");
    expect(bigNumbers(card)).toEqual(["9,120 of 8,000", "4 of 7", "3 of 5"]);
  });

  it("says which goals are the app's defaults", () => {
    render(<FitnessWeek summary={SUMMARY} defaults={{ steps: true, protein: false }} />);
    expect(screen.getByText(/Steps goal 8,000 \(default; set/)).toBeInTheDocument();
    expect(screen.queryByText(/Protein goal 170 g \(default/)).not.toBeInTheDocument();
  });
});

describe("Trend card detail", () => {
  it("opens the metric in detail from its value", () => {
    const hr = DAYS.map((d) => d.restingHr);
    render(
      <TrendCard
        title="Resting heart rate"
        name="Resting heart rate"
        unit=" bpm"
        color="var(--cat-heart)"
        dates={DAYS.slice(-7).map((d) => d.date)}
        values={hr.slice(-7)}
        average={hr.slice(-7)}
        decimals={0}
        history={hr}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Latest 55 bpm/ }));
    const sheet = screen.getByRole("dialog", { name: "Resting heart rate in detail" });
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Resting heart rate");
    expect(rows[0]).toHaveTextContent("3 bpm below your 30-day average");
    expect(rows[1]).toHaveTextContent("7-day average");
  });

  it("has no detail button without readings", () => {
    render(
      <TrendCard
        title="Weight"
        name="Weight"
        unit=" kg"
        color="var(--cat-body)"
        dates={["2026-10-31"]}
        values={[null]}
        average={[null]}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Sleep detail", () => {
  it("opens the latest night's stages against the 30-day average", () => {
    render(<HealthSleep days={DAYS.slice(-7)} goal={8} history={DAYS} />);
    fireEvent.click(screen.getByRole("button", { name: /Latest night 6 h 30 min/ }));
    const sheet = screen.getByRole("dialog", { name: "Sleep in detail" });
    const rows = within(sheet).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".row__title")?.textContent)).toEqual([
      "Total sleep",
      "Core",
      "Deep",
      "REM",
      "Awake",
    ]);
    expect(rows[0]).toHaveTextContent("30 min below your 30-day average");
    expect(rows[1]).toHaveTextContent("Level with your 30-day average");
  });
});

describe("FitnessWeek", () => {
  it("says what to do next under each ring (P3)", () => {
    render(
      <FitnessWeek
        summary={{
          avgSteps: 5600,
          proteinDays: 7,
          sessions: 4,
          stepsGoal: 8000,
          proteinGoal: 170,
        }}
      />,
    );
    expect(screen.getByText("2,400 steps a day below your goal")).toBeInTheDocument();
    expect(screen.getByText("Goal reached")).toBeInTheDocument();
    expect(screen.getByText("1 session left this week")).toBeInTheDocument();
  });
});
