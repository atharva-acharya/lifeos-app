import type { HealthGoals, HealthRingsDay } from "../api";
import { shortLabel } from "../fitnessStats";
import { sleepHours } from "../healthStats";
import { EmptyHint } from "./EmptyHint";
import { Rings, type Ring } from "./Rings";

/** Today's rings (or the latest day that has data) against the daily goals. */
export function HealthToday({ day, goals }: { day: HealthRingsDay | null; goals: HealthGoals }) {
  const rings: Ring[] = [
    {
      key: "steps",
      name: "Steps",
      value: day?.steps ?? 0,
      goal: goals.steps,
      color: "var(--ring-move)",
    },
    {
      key: "energy",
      name: "Active energy",
      value: day?.activeEnergy ?? 0,
      goal: goals.activeEnergy,
      color: "var(--ring-exercise)",
      unit: " kcal",
    },
    {
      key: "sleep",
      name: "Sleep",
      value: day?.sleep?.total ?? 0,
      goal: goals.sleepHours,
      color: "var(--ring-stand)",
      format: sleepHours,
    },
  ];
  return (
    <section className="card" aria-labelledby="health-today">
      <h2 id="health-today" className="kicker">
        {day === null || day.isToday ? "Today" : `Latest: ${shortLabel(day.date)}`}
      </h2>
      {day === null ? (
        <EmptyHint lead="No steps, energy or sleep in the exports yet.">
          Turn on Step Count, Active Energy and Sleep Analysis in Health Auto Export.
        </EmptyHint>
      ) : (
        <div className="fitness__week">
          <Rings rings={rings} />
          <p className="muted">
            {day.isToday
              ? "Goals come from your plan, with defaults where it sets none."
              : `Nothing recorded for today yet, so this shows ${day.date}.`}
          </p>
        </div>
      )}
    </section>
  );
}
