import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Project } from "../api";
import { ProjectCard } from "./ProjectCard";

const BASE: Project = {
  path: "Projects/x.md",
  name: "x",
  status: null,
  active: true,
  updated: null,
  steps: [],
  done: 0,
  total: 0,
  current: null,
  nextStep: null,
  lastLog: null,
  log: [],
};

describe("ProjectCard", () => {
  it("handles a project with no steps and no log", () => {
    render(<ProjectCard project={BASE} />);
    expect(screen.getByText("No steps yet")).toBeInTheDocument();
    expect(screen.getByText("No log entries yet")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Log \(/)).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
  });

  it("reads the front matter count when there is no checklist", () => {
    render(
      <ProjectCard
        project={{ ...BASE, done: 1, total: 4, nextStep: "Draft the outline", status: "active" }}
      />,
    );
    expect(screen.getByText("1 of 4 steps done")).toBeInTheDocument();
    expect(screen.getByText("Draft the outline")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  });

  it("shows an undated last log without a separator", () => {
    render(<ProjectCard project={{ ...BASE, lastLog: { date: null, text: "Just a note" } }} />);
    expect(screen.getByText("Last log: Just a note")).toBeInTheDocument();
  });

  it("renders note text as text, not markup", () => {
    render(<ProjectCard project={{ ...BASE, name: "<b>bold</b>", nextStep: "<img src=x>" }} />);
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(document.querySelector("img, b")).toBeNull();
  });
});

describe("ProjectCard edge cases", () => {
  const STEPS = [
    { text: "One", done: true },
    { text: "Two", done: false },
    { text: "Three", done: false },
  ];
  const WITH_STEPS: Project = {
    ...BASE,
    steps: STEPS,
    done: 1,
    total: 3,
    current: 1,
    nextStep: "Two",
    status: "active",
  };

  it("breathes only on the current step of an active project", () => {
    const { container } = render(<ProjectCard project={WITH_STEPS} />);
    const items = container.querySelectorAll("li.project__step");
    expect(items[1]).toHaveClass("breathing");
    expect(container.querySelectorAll(".breathing")).toHaveLength(1);
    expect(container.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  it.each(["paused", "done", "blocked"])("never breathes when %s", (status) => {
    const { container } = render(
      <ProjectCard project={{ ...WITH_STEPS, status, active: false }} />,
    );
    expect(container.querySelector(".breathing")).toBeNull();
    expect(container.querySelector("[aria-current]")).toBeNull();
  });

  it("does not breathe when an active project has every step done", () => {
    const { container } = render(
      <ProjectCard
        project={{
          ...WITH_STEPS,
          steps: STEPS.map((s) => ({ ...s, done: true })),
          done: 3,
          current: null,
          nextStep: null,
        }}
      />,
    );
    expect(container.querySelector(".breathing")).toBeNull();
    expect(screen.getByText("All 3 steps done")).toBeInTheDocument();
  });

  it("does not breathe without a checklist even when active", () => {
    const { container } = render(
      <ProjectCard project={{ ...BASE, done: 1, total: 4, current: null }} />,
    );
    expect(container.querySelector(".breathing")).toBeNull();
  });

  it("shows front matter completion without a checklist", () => {
    render(<ProjectCard project={{ ...BASE, done: 4, total: 4 }} />);
    expect(screen.getByText("All 4 steps done")).toBeInTheDocument();
  });

  it("clamps the bar width for odd counts", () => {
    const { container } = render(<ProjectCard project={{ ...BASE, done: 9, total: 4 }} />);
    expect(container.querySelector(".progress > span")).toHaveStyle({ width: "100%" });
    const empty = render(<ProjectCard project={BASE} />);
    expect(empty.container.querySelector(".progress > span")).toHaveStyle({ width: "0%" });
  });

  it("shows the status text, defaulting to active, as a pill", () => {
    render(<ProjectCard project={{ ...BASE, status: null }} />);
    expect(screen.getByText("active")).toHaveClass("pill--progress");
  });

  it("renders every field as text, never as markup", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <ProjectCard
        project={{
          ...WITH_STEPS,
          name: evil,
          status: evil,
          updated: evil,
          nextStep: evil,
          steps: [{ text: evil, done: false }],
          total: 1,
          current: 0,
          lastLog: { date: null, text: evil },
          log: [
            { date: null, text: evil },
            { date: "2026-01-01", text: evil },
          ],
        }}
      />,
    );
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(3);
  });

  it("lists log entries with time elements for dates, closed by default", () => {
    const { container } = render(
      <ProjectCard
        project={{
          ...BASE,
          lastLog: { date: "2026-02-01", text: "b" },
          log: [
            { date: "2026-02-01", text: "b" },
            { date: null, text: "a" },
          ],
        }}
      />,
    );
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-02-01");
    expect(screen.getByText("Log (2)")).toBeInTheDocument();
    expect(container.querySelectorAll("time")).toHaveLength(1);
  });

  it("gives a card with spaces in its path a valid accessible name", () => {
    render(
      <ProjectCard project={{ ...BASE, path: "Projects/My Big Plan.md", name: "My Big Plan" }} />,
    );
    // aria-labelledby is a space-separated id list, so the id must hold no whitespace.
    expect(screen.getByRole("region", { name: "My Big Plan" })).toBeInTheDocument();
  });

  it("gives two cards distinct ids without whitespace", () => {
    const { container } = render(
      <>
        <ProjectCard project={{ ...BASE, path: "Projects/a b.md", name: "A" }} />
        <ProjectCard project={{ ...BASE, path: "Projects/a-b.md", name: "B" }} />
      </>,
    );
    const ids = [...container.querySelectorAll("h3")].map((h) => h.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toMatch(/\s/);
  });
});
