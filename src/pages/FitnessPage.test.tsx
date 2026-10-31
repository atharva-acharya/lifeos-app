import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localDate, type Fitness, type FitnessDay } from "../api";
import { addDays } from "../fitnessStats";
import { invoke, listen } from "../test/tauri-mocks";
import { FitnessPage } from "./FitnessPage";

const DATE = localDate();

function recent(offset: number, over: Partial<FitnessDay>): FitnessDay {
  return { date: addDays(DATE, -offset), weight: null, steps: null, proteinG: null, ...over };
}

const FITNESS: Fitness = {
  days: [
    recent(8, { weight: 84.0, steps: 6000, proteinG: 150 }),
    recent(3, { weight: 83.4, steps: 9000, proteinG: 175 }),
    recent(1, { weight: 83.0, steps: 10_000, proteinG: 160 }),
    recent(0, { weight: 82.8, steps: 11_000, proteinG: 171 }),
  ],
  plan: {
    name: "Synthetic Arc",
    start: addDays(DATE, -30),
    end: addDays(DATE, 30),
    startWeight: 86,
    targetWeight: 80,
    stepsGoal: 9000,
    proteinGoal: 170,
  },
  workouts: [
    {
      path: "Fitness/Log/b.md",
      date: addDays(DATE, -1),
      day: "Pull A",
      week: 3,
      deload: true,
      durationMin: 40,
      exercises: [
        { name: "Deadlift", sets: 2, reps: 5, kg: 80, raw: "Deadlift 2 x 5 @ 80" },
        {
          name: "Plank until failure",
          sets: null,
          reps: null,
          kg: null,
          raw: "Plank until failure",
        },
      ],
    },
    {
      path: "Fitness/Log/a.md",
      date: addDays(DATE, -8),
      day: "Pull A",
      week: 2,
      deload: false,
      durationMin: 58,
      exercises: [{ name: "Deadlift", sets: 3, reps: 5, kg: 120, raw: "Deadlift 3 x 5 @ 120" }],
    },
    {
      path: "Fitness/Log/c.md",
      date: addDays(DATE, -9),
      day: "Legs",
      week: 2,
      deload: false,
      durationMin: null,
      exercises: [],
    },
  ],
  lifts: [
    {
      name: "Deadlift",
      sessions: [
        { date: addDays(DATE, -15), kg: 110, reps: 8 },
        { date: addDays(DATE, -8), kg: 120, reps: 5 },
      ],
    },
    { name: "Bench press", sessions: [{ date: addDays(DATE, -8), kg: 62.5, reps: 8 }] },
  ],
  parseErrors: 0,
};

function ready(over: Partial<Fitness> = {}) {
  invoke.mockResolvedValue({ status: "ready", fitness: { ...FITNESS, ...over } });
}

describe("FitnessPage", () => {
  it("asks to connect a vault and links to settings", async () => {
    invoke.mockResolvedValue({ status: "noVault" });
    const onNavigate = vi.fn();
    render(<FitnessPage onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(invoke).toHaveBeenCalledWith("get_fitness", { date: DATE });
    expect(listen).toHaveBeenCalledWith("index-updated", expect.any(Function));
  });

  it("shows the week, weight trend and activity", async () => {
    ready();
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Weight trend" })).toBeInTheDocument();
    expect(screen.getByText("82.8", { selector: ".metric__value" })).toHaveTextContent(
      "Latest 82.8 kg",
    );
    expect(screen.getByRole("heading", { name: "This week" })).toBeInTheDocument();
    expect(screen.getByText("Steps, 7-day average")).toBeInTheDocument();
    // Plan has a target, so no hint.
    expect(screen.queryByText(/No target line yet/)).not.toBeInTheDocument();
    const weights = screen.getByRole("table", { name: "Weight over the last 90 days" });
    expect(within(weights).getAllByRole("row")).toHaveLength(5);
    const protein = screen.getByRole("list", { name: "Protein by day" });
    expect(within(protein).getAllByText(/Hit/)).toHaveLength(2);
    expect(within(protein).getAllByText(/Missed/)).toHaveLength(2);
    expect(within(protein).getAllByText(/No data/)).toHaveLength(10);
  });

  it("lists sessions per day tab with deloads marked", async () => {
    ready();
    render(<FitnessPage onNavigate={vi.fn()} />);
    await screen.findByRole("tablist", { name: "Workout days" });
    // Opens on the newest session's day.
    expect(screen.getByRole("tab", { name: "Pull A" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Deload")).toBeInTheDocument();
    expect(screen.getByText("Deadlift 3 × 5 @ 120 kg")).toBeInTheDocument();
    // A line that did not parse is shown as written.
    expect(screen.getByText("Plank until failure")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Legs" }));
    expect(screen.getByText("Week 2")).toBeInTheDocument();
    expect(screen.queryByText("Deload")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Push B" }));
    expect(screen.getByText("No Push B sessions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Other" })).not.toBeInTheDocument();
  });

  it("adds an Other tab for workouts with no day", async () => {
    ready({
      workouts: [{ ...FITNESS.workouts[1], path: "x.md", day: null, date: null, week: null }],
    });
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("tab", { name: "Other" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("No date")).toBeInTheDocument();
  });

  it("charts lift progress and switches exercise", async () => {
    ready();
    render(<FitnessPage onNavigate={vi.fn()} />);
    const select = await screen.findByRole("combobox", { name: "Exercise" });
    expect(select).toHaveValue("Deadlift");
    expect(screen.getByText(/Deload weeks are left out/)).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Deadlift: top set per session" }),
    ).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "Bench press" } });
    const table = screen.getByRole("table", { name: "Bench press: top set per session" });
    expect(within(table).getByText("62.5")).toBeInTheDocument();
  });

  it("averages the first plotted days over the warm-up days before them", async () => {
    ready({
      days: [recent(93, { weight: 90 }), recent(89, { weight: 88 }), recent(97, { weight: 99 })],
    });
    render(<FitnessPage onNavigate={vi.fn()} />);
    const table = await screen.findByRole("table", { name: "Weight over the last 90 days" });
    // Only the last 90 days are listed; 93 and 97 days back are not.
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(2);
    // The oldest plotted day averages 88 with the 90 from 93 days back.
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent("89");
  });

  it("explains empty data and a missing target", async () => {
    ready({ days: [], workouts: [], lifts: [], plan: null });
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No weigh-ins in the last 90 days.")).toBeInTheDocument();
    expect(screen.getByText("No workouts logged yet.")).toBeInTheDocument();
    expect(screen.getByText("No lifts with a weight logged yet.")).toBeInTheDocument();
    expect(screen.getByText(/No target line yet/)).toHaveTextContent("target_weight");
    expect(screen.getByText(/No target line yet/)).toHaveTextContent("Fitness/Plan.md");
  });

  it("hints at the target when the plan has none", async () => {
    ready({ plan: FITNESS.plan ? { ...FITNESS.plan, targetWeight: null } : null });
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No target line yet/)).toBeInTheDocument();
  });

  it("warns when notes could not be read", async () => {
    ready({ parseErrors: 2 });
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("2 daily or fitness notes");
  });

  it("shows an error from the core", async () => {
    invoke.mockRejectedValue("date must look like 2026-10-29");
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("date must look like");
  });
});
