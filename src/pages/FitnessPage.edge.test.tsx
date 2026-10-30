import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { localDate, type Fitness } from "../api";
import { invoke } from "../test/tauri-mocks";
import { FitnessPage } from "./FitnessPage";

const EMPTY: Fitness = { days: [], plan: null, workouts: [], lifts: [], parseErrors: 0 };

function ready(over: Partial<Fitness>) {
  invoke.mockResolvedValue({ status: "ready", fitness: { ...EMPTY, ...over } });
}

describe("FitnessPage edge states", () => {
  it("renders every section with a completely empty vault", async () => {
    ready({});
    const { container } = render(<FitnessPage onNavigate={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Weight trend" })).toBeInTheDocument();
    for (const name of ["This week", "Steps and protein", "Workout history", "Lift progress"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("uses singular wording for one unreadable note", async () => {
    ready({ parseErrors: 1 });
    render(<FitnessPage onNavigate={() => undefined} />);
    expect(await screen.findByRole("status")).toHaveTextContent("1 daily or fitness note could");
  });

  it("hides every chart plot from assistive tech and pairs it with a table", async () => {
    const today = localDate();
    ready({
      days: [{ date: today, weight: 80, steps: 5000, proteinG: 150 }],
      lifts: [{ name: "Squat", sessions: [{ date: today, kg: 100, reps: 5 }] }],
    });
    const { container } = render(<FitnessPage onNavigate={() => undefined} />);
    await screen.findByRole("heading", { name: "Weight trend" });
    const plots = container.querySelectorAll(".chart__plot");
    expect(plots).toHaveLength(3);
    for (const plot of plots) expect(plot).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("table.sr-only")).toHaveLength(3);
    // Nothing reachable by keyboard sits inside a hidden plot.
    expect(
      container.querySelectorAll(".chart__plot a, .chart__plot button, .chart__plot [tabindex]"),
    ).toHaveLength(0);
  });

  it("shows no content for a plan with only a name", async () => {
    ready({
      plan: {
        name: "Arc",
        start: null,
        end: null,
        startWeight: null,
        targetWeight: null,
        stepsGoal: 8000,
        proteinGoal: 170,
      },
    });
    render(<FitnessPage onNavigate={() => undefined} />);
    expect(await screen.findByText(/No target line yet/)).toBeInTheDocument();
  });

  it("shows a generic message for a non-string failure", async () => {
    invoke.mockRejectedValue(new Error("x"));
    render(<FitnessPage onNavigate={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load fitness.");
  });
});
