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
