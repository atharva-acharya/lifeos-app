import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { localDate, type Today } from "../api";
import { invoke, listen, mockCommands } from "../test/tauri-mocks";
import { TodayPage } from "./TodayPage";

const DATE = localDate();

const TODAY: Today = {
  date: DATE,
  hasDailyNote: true,
  weight: 83.9,
  weightChange: -0.2,
  applications: 4,
  gym: "Pull A",
  habits: { weighIn: true, steps: 10450, proteinG: 165, mealsTracked: true, mobility: false },
  followUps: [
    {
      path: "Jobs/Companies/Example Security Ltd.md",
      company: "Example Security Ltd",
      role: "SOC Analyst",
      stage: "screen",
      nextAction: "Prepare for phone screen",
      nextDate: "2000-01-01",
    },
  ],
  project: {
    path: "Projects/home-lab.md",
    project: "home-lab",
    done: 1,
    total: 3,
    nextStep: "Set up log forwarding",
    lastLog: "2026-01-13: Hypervisor running.",
  },
  parseErrors: 1,
};

describe("TodayPage", () => {
  it("asks to connect a vault and links to settings", async () => {
    mockCommands({ get_today: { status: "noVault" } });
    const onNavigate = vi.fn();
    render(<TodayPage onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(invoke).toHaveBeenCalledWith("get_today", { date: DATE });
  });

  it("shows the day's numbers", async () => {
    mockCommands({ get_today: { status: "ready", today: TODAY } });
    render(<TodayPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("83.9 kg")).toBeInTheDocument();
    expect(screen.getByText("−0.2 kg since last")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Applications today")).getByText("4")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Gym session")).getByText("Pull A")).toBeInTheDocument();
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
  });

  it("lists overdue follow-ups and where to resume", async () => {
    mockCommands({ get_today: { status: "ready", today: TODAY } });
    render(<TodayPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("Example Security Ltd")).toBeInTheDocument();
    expect(screen.getByText("Overdue · 2000-01-01")).toBeInTheDocument();
    expect(screen.getByText("Set up log forwarding")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByRole("status")).toHaveTextContent("1 note could not be read");
  });

  it("refreshes when the index changes", async () => {
    mockCommands({ get_today: { status: "noVault" } });
    render(<TodayPage onNavigate={vi.fn()} />);
    await screen.findByText("Not connected");
    expect(listen).toHaveBeenCalledWith("index-updated", expect.any(Function));
  });
});
