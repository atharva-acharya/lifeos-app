import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Fitness, Jobs, Today } from "../api";
import { localDate } from "../api";
import { mockCommands } from "../test/tauri-mocks";
import { FitnessPage } from "./FitnessPage";
import { JobsPage } from "./JobsPage";
import { ProjectsPage } from "./ProjectsPage";
import { TodayPage } from "./TodayPage";

const DATE = localDate();

const BLANK_TODAY: Today = {
  date: DATE,
  hasDailyNote: false,
  weight: null,
  weightChange: null,
  applications: null,
  gym: null,
  habits: { weighIn: false, steps: null, proteinG: null, mealsTracked: false, mobility: false },
  stepsGoal: 8000,
  proteinGoal: 170,
  followUps: [],
  project: null,
  parseErrors: 0,
};

describe("Today with nothing in the vault", () => {
  it("names the missing daily note and shows dashes, not zeros", async () => {
    mockCommands({ get_today: { status: "ready", today: BLANK_TODAY } });
    const onNavigate = vi.fn();
    render(<TodayPage onNavigate={onNavigate} />);
    expect(await screen.findByText(/No daily note for/)).toBeInTheDocument();
    expect(screen.getByText(`date: ${DATE}`)).toBeInTheDocument();
    expect(screen.getByLabelText("Applied today")).toHaveTextContent("—");
    expect(screen.getByLabelText("Gym session")).toHaveTextContent("—");
    expect(screen.queryByText("Rest day")).not.toBeInTheDocument();
    expect(screen.getByText(/Follow-ups come from/)).toHaveTextContent("type: company");
    expect(screen.getByText("No active project.").parentElement).toHaveTextContent("type: project");
    fireEvent.click(screen.getAllByRole("button", { name: "How to set this up" })[0]);
    expect(onNavigate).toHaveBeenCalledWith("settings", "daily");
  });

  it("keeps Rest day when a note exists without a session", async () => {
    mockCommands({
      get_today: { status: "ready", today: { ...BLANK_TODAY, hasDailyNote: true } },
    });
    render(<TodayPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("Rest day")).toBeInTheDocument();
    expect(screen.queryByText(/No daily note for/)).not.toBeInTheDocument();
  });

  it("offers sample data when not connected", async () => {
    mockCommands({ get_today: { status: "noVault" } });
    render(<TodayPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Try with sample data" })).toBeInTheDocument();
  });
});

describe("Jobs with nothing in the vault", () => {
  const EMPTY: Jobs = {
    pipeline: ["applied", "replied", "screen", "interview", "offer", "rejected"].map((stage) => ({
      stage,
      companies: [],
    })),
    outreach: [],
  };

  it("explains the pipeline note", async () => {
    mockCommands({ get_jobs: { status: "ready", jobs: EMPTY } });
    render(<JobsPage onNavigate={vi.fn()} />);
    const hint = await screen.findByLabelText("Pipeline setup");
    expect(hint).toHaveTextContent("type: company");
    expect(hint).toHaveTextContent("next_date");
  });

  it("explains the outreach log", async () => {
    mockCommands({ get_jobs: { status: "ready", jobs: EMPTY } });
    render(<JobsPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Outreach" }));
    expect(await screen.findByText(/type: outreach-log/)).toBeInTheDocument();
  });

  it("offers sample data on the Applications tab when not connected", async () => {
    mockCommands({
      get_jobs: { status: "ready", jobs: EMPTY },
      get_applications: { configured: false, connected: false, cache: null, error: null },
    });
    render(<JobsPage onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Applications" }));
    expect(await screen.findByRole("button", { name: "Try with sample data" })).toBeInTheDocument();
  });
});

describe("Fitness with nothing in the vault", () => {
  const EMPTY: Fitness = { days: [], plan: null, workouts: [], lifts: [], parseErrors: 0 };

  it("explains each section and labels the default goals", async () => {
    mockCommands({ get_fitness: { status: "ready", fitness: EMPTY } });
    render(<FitnessPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No weigh-ins in the last 90 days.")).toBeInTheDocument();
    expect(screen.getByText(/Weight comes from/)).toHaveTextContent("protein_g");
    expect(screen.getByText(/Add one/)).toHaveTextContent("type: workout");
    expect(screen.getByText(/Steps goal 8,000 \(default/)).toHaveTextContent("steps_goal");
    expect(screen.getByText(/Steps goal 8,000 \(default/)).toHaveTextContent("Protein goal 170 g");
  });

  it("labels only the goals the plan leaves out", async () => {
    mockCommands({
      get_fitness: {
        status: "ready",
        fitness: {
          ...EMPTY,
          plan: {
            name: null,
            start: null,
            end: null,
            startWeight: null,
            targetWeight: null,
            stepsGoal: 9000,
            proteinGoal: 170,
            stepsGoalDefault: false,
            proteinGoalDefault: true,
          },
        },
      },
    });
    render(<FitnessPage onNavigate={vi.fn()} />);
    const note = await screen.findByText(/Protein goal 170 g \(default/);
    expect(note).not.toHaveTextContent("Steps goal");
  });
});

describe("Projects with nothing in the vault", () => {
  it("names the fields and the steps checklist", async () => {
    mockCommands({ get_projects: { status: "ready", projects: { projects: [], parseErrors: 0 } } });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    const lead = await screen.findByText("No project notes yet.");
    const hint = lead.parentElement;
    expect(hint).toHaveTextContent("type: project");
    expect(hint).toHaveTextContent("## Steps");
    expect(hint).toHaveTextContent("next_step");
  });
});
