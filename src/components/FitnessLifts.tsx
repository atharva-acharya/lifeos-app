import { useState } from "react";
import type { Lift } from "../api";
import { shortLabel } from "../fitnessStats";
import { EmptyHint } from "./EmptyHint";
import { LineChart } from "./LineChart";

/** Top set per session for one exercise at a time. */
export function FitnessLifts({ lifts }: { lifts: Lift[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const lift = lifts.find((l) => l.name === chosen) ?? (lifts.length > 0 ? lifts[0] : undefined);

  return (
    <section className="card chart" aria-labelledby="fitness-lifts">
      <header className="chart__head">
        <h2 id="fitness-lifts" className="kicker">
          Lift progress
        </h2>
        <span className="muted">Heaviest set of each session. Deload weeks are left out.</span>
      </header>
      {!lift ? (
        <EmptyHint lead="No lifts with a weight logged yet." guide="workout">
          Lift progress needs <code>type: workout</code> notes whose <code>exercises</code> lines
          end in a weight, like <code>- Bench 3 x 8 @ 60</code>.
        </EmptyHint>
      ) : (
        <>
          <div className="toolbar">
            <label>
              <span className="kicker">Exercise</span>
              <select
                value={lift.name}
                onChange={(e) => {
                  setChosen(e.target.value);
                }}
              >
                {lifts.map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted toolbar__summary">
              {lift.sessions.length} session{lift.sessions.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="chart__plot" aria-hidden="true">
            <LineChart
              labels={lift.sessions.map((s) => shortLabel(s.date))}
              lines={[
                {
                  key: "kg",
                  name: lift.name,
                  color: "var(--c-done)",
                  values: lift.sessions.map((s) => s.kg),
                  dots: true,
                },
              ]}
              unit=" kg"
            />
          </div>
          <table className="sr-only">
            <caption>{lift.name}: top set per session</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Weight (kg)</th>
                <th scope="col">Reps</th>
              </tr>
            </thead>
            <tbody>
              {lift.sessions.map((s, i) => (
                <tr key={`${s.date}-${String(i)}`}>
                  <th scope="row">{s.date}</th>
                  <td>{s.kg}</td>
                  <td>{s.reps ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
