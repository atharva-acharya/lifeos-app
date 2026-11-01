import { useId } from "react";
import { SESSIONS_GOAL, weekHints, type WeekSummary } from "../fitnessStats";
import { Rings, type Ring } from "./Rings";
import { CardHead } from "./Card";
import "../styles/contributors.css";

/**
 * This week at a glance: steps, protein days and sessions against their
 * goals, each with what to do next (ui-spec P3), as large rings in a lit
 * card like Today's.
 */
export function FitnessWeek({
  summary,
  defaults,
}: {
  summary: WeekSummary;
  /** Which goals are the app's own defaults rather than set in the plan note. */
  defaults?: { steps: boolean; protein: boolean };
}) {
  const id = useId();
  const hints = weekHints(summary);
  const rings: Ring[] = [
    {
      key: "steps",
      name: "Steps, 7-day average",
      value: summary.avgSteps ?? 0,
      goal: summary.stepsGoal,
      color: "var(--ring-move)",
      hint: hints.steps,
    },
    {
      key: "protein",
      name: "Protein goal days",
      value: summary.proteinDays,
      goal: 7,
      color: "var(--ring-exercise)",
      hint: hints.protein,
    },
    {
      key: "sessions",
      name: "Sessions this week",
      value: summary.sessions,
      goal: SESSIONS_GOAL,
      color: "var(--ring-stand)",
      hint: hints.sessions,
    },
  ];
  return (
    <section className="card rings-card fitness-week" aria-labelledby={id}>
      <CardHead
        id={id}
        title="This week"
        action={
          <span className="card__aside">
            {summary.sessions} of {SESSIONS_GOAL} sessions
          </span>
        }
      />
      <Rings size={200} variant="hero" rings={rings} />
      <p className="muted rings-card__note">
        Protein goal is {summary.proteinGoal} g. Steps use the days you logged in the last 7.
      </p>
      {defaults && (defaults.steps || defaults.protein) && (
        <p className="muted rings-card__note">
          {defaults.steps && (
            <>
              Steps goal {summary.stepsGoal.toLocaleString("en-GB")} (default; set{" "}
              <code>steps_goal</code> in <code>Fitness/Plan.md</code>).{" "}
            </>
          )}
          {defaults.protein && (
            <>
              Protein goal {summary.proteinGoal} g (default; set <code>protein_goal</code> in{" "}
              <code>Fitness/Plan.md</code>).
            </>
          )}
        </p>
      )}
    </section>
  );
}
