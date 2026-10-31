import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HealthWorkout } from "../api";
import { HealthWorkouts, WORKOUTS_SHOWN } from "./HealthWorkouts";

function workouts(n: number): HealthWorkout[] {
  return Array.from({ length: n }, (_, i) => ({
    source: i % 2 === 0 ? "health" : "vault",
    date: `2026-09-${String(30 - i).padStart(2, "0")}`,
    name: `Workout ${String(i + 1)}`,
    durationMin: 30,
    activeEnergy: null,
    distanceKm: null,
    path: null,
  }));
}

function rows(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Workouts, newest first" })).getAllByRole(
    "listitem",
  );
}

describe("HealthWorkouts", () => {
  it("shows the eight newest and expands in place", () => {
    render(<HealthWorkouts workouts={workouts(40)} />);
    expect(rows()).toHaveLength(WORKOUTS_SHOWN);
    expect(rows()[0]).toHaveTextContent("Workout 1");
    expect(screen.queryByText("Workout 9")).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "Show all (40)" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    button.focus();
    fireEvent.click(button);
    expect(rows()).toHaveLength(40);
    expect(button).toHaveTextContent("Show fewer");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(rows()).toHaveLength(WORKOUTS_SHOWN);
    expect(button).toHaveTextContent("Show all (40)");
    expect(button).toHaveFocus();
  });

  it("has no button when every workout already fits", () => {
    render(<HealthWorkouts workouts={workouts(WORKOUTS_SHOWN)} />);
    expect(rows()).toHaveLength(WORKOUTS_SHOWN);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
