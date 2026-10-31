import { SESSIONS_GOAL, weekHints, type WeekSummary } from "../fitnessStats";
import { Rings, type Ring } from "./Rings";
import { Group } from "./Card";
import "../styles/contributors.css";

/**
 * This week at a glance: steps, protein days and sessions against their
 * goals, each with what to do next (ui-spec P3).
 */
export function FitnessWeek({
  summary,
  defaults,
}: {
  summary: WeekSummary;
  /** Which goals are the app's own defaults rather than set in the plan note. */
  defaults?: { steps: boolean; protein: boolean };
}) {
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
    <Group title="This week" cardClassName="card--stack">
      <div className="fitness__week">
        <Rings rings={rings} />
        <p className="muted">
          Protein goal is {summary.proteinGoal} g. Steps use the days you logged in the last 7.
        </p>
        {defaults && (defaults.steps || defaults.protein) && (
          <p className="muted">
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
      </div>
    </Group>
  );
}
