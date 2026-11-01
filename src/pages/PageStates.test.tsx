import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKELETON_DELAY_MS } from "../components/Skeleton";
import { mockCommands, rejected } from "../test/tauri-mocks";
import { FitnessPage } from "./FitnessPage";
import { HealthPage } from "./HealthPage";
import { JobsPage } from "./JobsPage";
import { MoneyPage } from "./MoneyPage";
import { ProjectsPage } from "./ProjectsPage";
import { TodayPage } from "./TodayPage";

const nav = vi.fn();

/** Each page, its load command, what it calls itself, and its "no data" answer. */
const PAGES: {
  name: string;
  command: string;
  page: () => ReactElement;
  label: string;
  empty: unknown;
  emptyText: RegExp;
}[] = [
  {
    name: "Today",
    command: "get_today",
    page: () => <TodayPage onNavigate={nav} />,
    label: "today",
    empty: { status: "noVault" },
    emptyText: /Not connected/,
  },
  {
    name: "Jobs",
    command: "get_jobs",
    page: () => <JobsPage onNavigate={nav} />,
    label: "jobs",
    empty: { status: "noVault" },
    emptyText: /Not connected/,
  },
  {
    name: "Fitness",
    command: "get_fitness",
    page: () => <FitnessPage onNavigate={nav} />,
    label: "fitness",
    empty: { status: "noVault" },
    emptyText: /Not connected/,
  },
  {
    name: "Health",
    command: "get_health",
    page: () => <HealthPage onNavigate={nav} />,
    label: "health",
    empty: { status: "notConfigured" },
    emptyText: /Not set up/,
  },
  {
    name: "Money",
    command: "get_money",
    page: () => <MoneyPage onNavigate={nav} />,
    label: "money",
    empty: { status: "noVault" },
    emptyText: /Not connected/,
  },
  {
    name: "Projects",
    command: "get_projects",
    page: () => <ProjectsPage onNavigate={nav} />,
    label: "projects",
    empty: { status: "noVault" },
    emptyText: /Not connected/,
  },
];

afterEach(() => {
  vi.useRealTimers();
});

describe.each(PAGES)("$name page states", ({ command, page, label, empty, emptyText }) => {
  it("shows a skeleton only once loading takes longer than 150 ms", () => {
    vi.useFakeTimers();
    mockCommands({ [command]: () => new Promise(() => undefined) });
    render(page());
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveTextContent(`Loading ${label}…`);
  });

  it("never shows the skeleton when the data arrives quickly", async () => {
    mockCommands({ [command]: empty });
    render(page());
    expect(await screen.findByText(emptyText)).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 20));
    });
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    let calls = 0;
    mockCommands({
      [command]: () => {
        calls += 1;
        return calls === 1 ? rejected("the vault folder could not be read") : empty;
      },
    });
    render(page());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`Could not load ${label}.`);
    expect(alert).toHaveTextContent("the vault folder could not be read");
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(emptyText)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
