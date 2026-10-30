import type { HealthWorkout } from "../api";
import { shortLabel } from "../fitnessStats";

const SOURCE = { health: "Apple Health", vault: "Vault" } as const;

function details(w: HealthWorkout): string[] {
  const out: string[] = [];
  if (w.durationMin !== null) out.push(`${String(w.durationMin)} min`);
  if (w.activeEnergy !== null) out.push(`${w.activeEnergy.toLocaleString("en-GB")} kcal`);
  if (w.distanceKm !== null) out.push(`${String(w.distanceKm)} km`);
  return out;
}

/** Apple Health and vault workouts in one list, newest first. */
export function HealthWorkouts({ workouts }: { workouts: HealthWorkout[] }) {
  return (
    <section className="card" aria-labelledby="health-workouts">
      <h2 id="health-workouts" className="kicker">
        Workouts
      </h2>
      {workouts.length === 0 ? (
        <p className="muted">No workouts yet.</p>
      ) : (
        <ul className="sessions" aria-label="Workouts, newest first">
          {workouts.map((w, i) => (
            <li key={`${w.source}-${String(i)}`} className="session">
              <div className="session__head">
                <span className={`pill ${w.source === "health" ? "pill--read" : "pill--done"}`}>
                  {SOURCE[w.source]}
                </span>
                <strong>{w.name}</strong>
                <span className="muted">{shortLabel(w.date)}</span>
                {details(w).map((d) => (
                  <span key={d} className="muted">
                    {d}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
