import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, Projects } from "../api";
import { invoke, listen } from "../test/tauri-mocks";
import { ProjectsPage } from "./ProjectsPage";

const ACTIVE: Project = {
  path: "Projects/home-lab.md",
  name: "home-lab",
  status: "active",
  active: true,
  updated: "2026-01-13",
  steps: [
    { text: "Install hypervisor", done: true },
    { text: "Set up log forwarding", done: false },
    { text: "Write detection rules", done: false },
  ],
  done: 1,
  total: 3,
  current: 1,
  nextStep: "Set up log forwarding",
  lastLog: { date: null, text: "Newest undated line" },
  log: [
    { date: null, text: "Newest undated line" },
    { date: "2026-01-13", text: "Hypervisor running." },
  ],
  logTotal: 2,
};

const PAUSED: Project = {
  path: "Projects/garden-planner.md",
  name: "garden-planner",
  status: "paused",
  active: false,
  updated: "2026-02-20",
  steps: [
    { text: "Measure the beds", done: true },
    { text: "Order seeds", done: false },
  ],
  done: 1,
  total: 2,
  current: 1,
  nextStep: "Order seeds",
  lastLog: null,
  log: [],
  logTotal: 0,
};

const DONE: Project = {
  path: "Projects/reading-list.md",
  name: "reading-list",
  status: "done",
  active: false,
  updated: "2025-12-01",
  steps: [{ text: "Read them", done: true }],
  done: 1,
  total: 1,
  current: null,
  nextStep: null,
  lastLog: { date: "2025-12-01", text: "Finished." },
  log: [{ date: "2025-12-01", text: "Finished." }],
  logTotal: 1,
};

function ready(over: Partial<Projects> = {}) {
  invoke.mockResolvedValue({
    status: "ready",
    projects: { projects: [ACTIVE, PAUSED, DONE], parseErrors: 0, ...over },
  });
}

function cardOf(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("section");
  if (!card) throw new Error("card");
  return card;
}

describe("ProjectsPage", () => {
  it("asks to connect a vault and links to settings", async () => {
    invoke.mockResolvedValue({ status: "noVault" });
    const onNavigate = vi.fn();
    render(<ProjectsPage onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings", "data");
    expect(invoke).toHaveBeenCalledWith("get_projects");
    expect(listen).toHaveBeenCalledWith("index-updated", expect.any(Function));
  });

  it("explains how to add project notes when there are none", async () => {
    ready({ projects: [] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No project notes yet/)).toBeInTheDocument();
    expect(screen.getByText("type: project")).toBeInTheDocument();
    expect(screen.getByText("Projects/")).toBeInTheDocument();
  });

  it("summarises and splits projects into Active and Other", async () => {
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("1 active of 3 projects")).toBeInTheDocument();
    const active = screen.getByRole("region", { name: "Active" });
    const other = screen.getByRole("region", { name: "Other" });
    expect(within(active).getByRole("heading", { name: "home-lab" })).toBeInTheDocument();
    expect(within(other).getByRole("heading", { name: "garden-planner" })).toBeInTheDocument();
    expect(within(other).getByRole("heading", { name: "reading-list" })).toBeInTheDocument();
  });

  it("omits Other when every project is active", async () => {
    ready({ projects: [ACTIVE] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "home-lab" });
    expect(screen.queryByRole("region", { name: "Other" })).not.toBeInTheDocument();
    expect(screen.getByText("1 active of 1 project")).toBeInTheDocument();
  });

  it("shows progress, the current step and where to resume", async () => {
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "home-lab" });
    const card = within(cardOf("home-lab"));
    const bar = card.getByRole("progressbar", { name: "1 of 3 steps done" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(card.getByText("Step 2 of 3")).toBeInTheDocument();
    expect(card.getByText("Updated 2026-01-13")).toBeInTheDocument();
    const resume = card.getByRole("group", { name: "Resume home-lab" });
    expect(resume).toHaveTextContent("Set up log forwarding");
    expect(resume).toHaveTextContent("Last log: Newest undated line");
  });

  it("marks only the active project's current step", async () => {
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "home-lab" });
    const steps = screen.getByRole("list", { name: "Steps for home-lab" });
    const items = within(steps).getAllByRole("listitem");
    expect(items[0]).not.toHaveClass("breathing");
    expect(items[1]).toHaveClass("breathing");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveClass("breathing");
    expect(items[0]).toHaveTextContent("(done)");
    expect(items[1]).toHaveTextContent("(open)");
    const paused = within(screen.getByRole("list", { name: "Steps for garden-planner" }));
    for (const li of paused.getAllByRole("listitem")) {
      expect(li).not.toHaveClass("breathing");
      expect(li).not.toHaveAttribute("aria-current");
    }
    expect(document.querySelectorAll(".breathing")).toHaveLength(1);
  });

  it("lists the log newest first, closed by default", async () => {
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "home-lab" });
    const details = within(cardOf("home-lab")).getByText("Log (2)").closest("details");
    if (!details) throw new Error("details");
    expect(details).not.toHaveAttribute("open");
    const lines = within(details)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(lines).toEqual(["Newest undated line", "2026-01-13 Hypervisor running."]);
  });

  it("shows a done project as complete and a paused one without a log", async () => {
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("All 1 steps done")).toBeInTheDocument();
    expect(within(cardOf("garden-planner")).getByText("No log entries yet")).toBeInTheDocument();
    expect(screen.getByText("done")).not.toHaveClass("pill--progress");
    expect(screen.getByText("paused")).not.toHaveClass("pill--progress");
    expect(screen.getByText("active")).toHaveClass("pill--progress");
  });

  it("shows a notice when project notes could not be read", async () => {
    ready({ parseErrors: 2 });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 project notes could not be read",
    );
  });

  it("shows an error when loading fails", async () => {
    invoke.mockRejectedValue("boom");
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

describe("ProjectsPage edge states", () => {
  it("shows the parse-error notice with the singular form", async () => {
    ready({ parseErrors: 1 });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("status")).toHaveTextContent("1 project note could not");
  });

  it("shows the notice alongside the empty state, and no notice at zero", async () => {
    ready({ projects: [], parseErrors: 3 });
    const { unmount } = render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/No project notes yet/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 project notes");
    unmount();
    ready();
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "home-lab" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show a summary or project UI when there is no vault", async () => {
    invoke.mockResolvedValue({ status: "noVault" });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("button", { name: "Open settings" });
    expect(screen.queryByText(/active of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Active" })).not.toBeInTheDocument();
    expect(document.querySelector(".breathing")).toBeNull();
  });

  it("says there are no active projects when every project is paused", async () => {
    ready({ projects: [PAUSED, DONE] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect(await screen.findByText("No active projects.")).toBeInTheDocument();
    expect(screen.getByText("0 active of 2 projects")).toBeInTheDocument();
    expect(document.querySelector(".breathing")).toBeNull();
  });

  it("breathes once per active project and never on paused or done ones", async () => {
    const second: Project = { ...ACTIVE, path: "Projects/second.md", name: "second" };
    ready({ projects: [ACTIVE, second, PAUSED, DONE] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByRole("heading", { name: "second" });
    expect(document.querySelectorAll(".breathing")).toHaveLength(2);
    for (const name of ["garden-planner", "reading-list"]) {
      expect(cardOf(name).querySelector(".breathing")).toBeNull();
    }
  });

  it("renders markup-looking project data as text", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    ready({
      projects: [
        { ...ACTIVE, name: evil, nextStep: evil, log: [{ date: null, text: evil }], logTotal: 1 },
      ],
    });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    expect((await screen.findAllByText(evil, { exact: false })).length).toBeGreaterThan(0);
    expect(document.querySelector("img")).toBeNull();
  });

  it("has a focusable log summary that toggles", async () => {
    ready({ projects: [ACTIVE] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    const summary = await screen.findByText("Log (2)");
    expect(summary.tagName).toBe("SUMMARY");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
  });

  it("keeps the Open settings button a real focusable button", async () => {
    invoke.mockResolvedValue({ status: "noVault" });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    const btn = await screen.findByRole("button", { name: "Open settings" });
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it("reloads when the index updates", async () => {
    ready({ projects: [] });
    render(<ProjectsPage onNavigate={vi.fn()} />);
    await screen.findByText(/No project notes yet/);
    const call = (listen.mock.calls as unknown[][]).find((c) => c[0] === "index-updated");
    const handler = call?.[1] as (() => void) | undefined;
    expect(handler).toBeDefined();
    ready();
    handler?.();
    expect(await screen.findByRole("heading", { name: "home-lab" })).toBeInTheDocument();
  });
});
