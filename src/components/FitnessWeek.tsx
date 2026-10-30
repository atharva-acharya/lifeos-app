import { SESSIONS_GOAL, type WeekSummary } from "../fitnessStats";
import { Rings, type Ring } from "./Rings";

/** This week at a glance: steps, protein days and sessions against their goals. */
export function FitnessWeek({ summary }: { summary: WeekSummary }) {
  const rings: Ring[] = [
    {
      key: "steps",
      name: "Steps, 7-day average",
      value: summary.avgSteps ?? 0,
      goal: summary.stepsGoal,
      color: "var(--c-progress)",
    },
    {
      key: "protein",
      name: "Protein goal days",
      value: summary.proteinDays,
      goal: 7,
      color: "var(--c-done)",
    },
    {
      key: "sessions",
      name: "Sessions this week",
      value: summary.sessions,
      goal: SESSIONS_GOAL,
      color: "var(--c-read)",
    },
  ];
  return (
    <section className="card" aria-labelledby="fitness-week">
      <h2 id="fitness-week" className="kicker">
        This week
      </h2>
      <div className="fitness__week">
        <Rings rings={rings} />
        <p className="muted">
          Protein goal is {summary.proteinGoal} g. Steps use the days you logged in the last 7.
        </p>
      </div>
    </section>
  );
}
