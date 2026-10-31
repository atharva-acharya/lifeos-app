import { useId, useState } from "react";
import type { HealthWorkout } from "../api";
import { shortLabel } from "../fitnessStats";
import { Group } from "./Card";
import { EmptyHint } from "./EmptyHint";

/** The newest workouts shown before "Show all". */
export const WORKOUTS_SHOWN = 8;

const SOURCE = { health: "Apple Health", vault: "Vault" } as const;

function details(w: HealthWorkout): string[] {
  const out: string[] = [];
  if (w.durationMin !== null) out.push(`${String(w.durationMin)} min`);
  if (w.activeEnergy !== null) out.push(`${w.activeEnergy.toLocaleString("en-GB")} kcal`);
  if (w.distanceKm !== null) out.push(`${String(w.distanceKm)} km`);
  return out;
}

/**
 * Apple Health and vault workouts in one list, newest first. Only the newest
 * eight show until the list is expanded in place.
 */
export function HealthWorkouts({ workouts }: { workouts: HealthWorkout[] }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const long = workouts.length > WORKOUTS_SHOWN;
  const shown = all || !long ? workouts : workouts.slice(0, WORKOUTS_SHOWN);
  return (
    <Group
      title="Workouts"
      cardClassName="card--stack"
      action={
        long && (
          <button
            type="button"
            className="link-button"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => {
              setAll((a) => !a);
            }}
          >
            {all ? "Show fewer" : `Show all (${String(workouts.length)})`}
          </button>
        )
      }
    >
      {workouts.length === 0 ? (
        <EmptyHint lead="No workouts yet.">
          Workouts come from Health Auto Export, and from workout notes in your vault.
        </EmptyHint>
      ) : (
        <ul id={listId} className="list" aria-label="Workouts, newest first">
          {shown.map((w, i) => (
            <li key={`${w.source}-${String(i)}`} className="list__row">
              <div className="list__main">
                <span className="list__title">{w.name}</span>
                <span className="list__sub">{details(w).join(" · ")}</span>
              </div>
              <span className={`pill ${w.source === "health" ? "pill--read" : "pill--done"}`}>
                {SOURCE[w.source]}
              </span>
              <span className="list__value">{shortLabel(w.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Group>
  );
}
