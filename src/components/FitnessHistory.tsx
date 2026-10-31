import { useState } from "react";
import type { ExerciseSet, FitnessWorkout } from "../api";
import { shortLabel } from "../fitnessStats";
import { withTransition } from "../motion";
import type { Navigate } from "../routes";
import { EmptyHint } from "./EmptyHint";
import { Group } from "./Card";
import { SegmentedTabs } from "./SegmentedTabs";

const DAYS = ["Push A", "Pull A", "Legs", "Push B", "Pull B"];
const OTHER = "Other";

const slug = (t: string) => t.toLowerCase().replace(/\s+/g, "-");

/** `Deadlift 3 × 5 @ 120 kg` when the line parsed, otherwise the text as written. */
export function exerciseText(e: ExerciseSet): string {
  if (e.sets === null || e.reps === null || e.kg === null) return e.raw?.trim() || e.name;
  return `${e.name} ${String(e.sets)} × ${String(e.reps)} @ ${String(e.kg)} kg`;
}

function Session({ w }: { w: FitnessWorkout }) {
  return (
    <li className="session">
      <div className="session__head">
        <strong>{w.date ? shortLabel(w.date) : "No date"}</strong>
        {w.date && <span className="muted">{w.date}</span>}
        {w.week !== null && <span className="muted">Week {w.week}</span>}
        {w.durationMin !== null && <span className="muted">{w.durationMin} min</span>}
        {w.deload && <span className="pill pill--pending">Deload</span>}
      </div>
      {w.exercises.length > 0 && (
        <ul className="session__lines">
          {w.exercises.map((e, i) => (
            <li key={i}>{exerciseText(e)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Past sessions, one tab per training day. */
export function FitnessHistory({
  workouts,
  onNavigate,
}: {
  workouts: FitnessWorkout[];
  onNavigate?: Navigate;
}) {
  const tabs = workouts.some((w) => w.day === null) ? [...DAYS, OTHER] : DAYS;
  const dayOf = (w: FitnessWorkout) => w.day ?? OTHER;
  const [chosen, setChosen] = useState<string | null>(null);
  // Before a choice, open the day of the newest session.
  const newest = workouts.length > 0 ? dayOf(workouts[0]) : tabs[0];
  const tab = chosen !== null && tabs.includes(chosen) ? chosen : newest;
  const shown = workouts.filter((w) => dayOf(w) === tab);

  return (
    <Group title="Workout history" cardClassName="card--stack">
      {workouts.length === 0 ? (
        <EmptyHint lead="No workouts logged yet." guide="workout" onNavigate={onNavigate}>
          Add one <code>type: workout</code> note per session (suggested <code>Fitness/Log/</code>)
          with <code>date</code>, <code>day</code> and an <code>exercises</code> list such as{" "}
          <code>- Bench 3 x 8 @ 60</code>.
        </EmptyHint>
      ) : (
        <>
          <SegmentedTabs
            items={tabs.map((t) => ({ id: t, label: t }))}
            value={tab}
            label="Workout days"
            tabId={(t) => `workout-tab-${slug(t)}`}
            panelId={() => "workout-panel"}
            onChange={(t, instant) => {
              // Keyboard changes are instant (M4); a mouse click animates.
              withTransition(
                () => {
                  setChosen(t);
                },
                { instant },
              );
            }}
          />
          <div role="tabpanel" id="workout-panel" aria-labelledby={`workout-tab-${slug(tab)}`}>
            {shown.length === 0 ? (
              <p className="muted">No {tab} sessions yet.</p>
            ) : (
              <ul className="sessions">
                {shown.map((w) => (
                  <Session key={w.path} w={w} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Group>
  );
}
