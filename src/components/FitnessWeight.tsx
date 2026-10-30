import { useMemo } from "react";
import type { FitnessDay, FitnessPlan } from "../api";
import { averageChange, calendar, rollingAverage, shortLabel, targetLine } from "../fitnessStats";
import { LineChart, type Line } from "./LineChart";

const DAYS = 90;
/** Days read before the chart starts, so its first 7-day average is complete. */
const WARM_UP = 6;

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;
}

/** Weight over the last 90 days: readings, 7-day average and the plan's target line. */
export function FitnessWeight({
  days,
  plan,
  today,
}: {
  days: FitnessDay[];
  plan: FitnessPlan | null;
  today: string;
}) {
  const view = useMemo(() => {
    // Average over the warm-up days too, then plot only the last 90.
    const all = calendar(days, today, DAYS + WARM_UP);
    const average = rollingAverage(
      all.map((d) => d.weight),
      7,
    ).slice(WARM_UP);
    const cal = all.slice(WARM_UP);
    const weights = cal.map((d) => d.weight);
    const target = targetLine(
      cal.map((d) => d.date),
      plan,
    );
    return { cal, weights, average, target, change: averageChange(average) };
  }, [days, plan, today]);

  const readings = view.weights.filter((w): w is number => w !== null);
  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const hasTarget = view.target.some((t) => t !== null);

  const lines: Line[] = [
    {
      key: "weight",
      name: "Weight",
      color: "var(--c-read)",
      values: view.weights,
      dots: true,
    },
    { key: "avg", name: "7-day average", color: "var(--c-progress)", values: view.average },
  ];
  if (hasTarget) {
    lines.push({
      key: "target",
      name: "Target",
      color: "var(--c-pending)",
      values: view.target,
      dashed: true,
    });
  }

  return (
    <section className="card chart" aria-labelledby="fitness-weight">
      <header className="chart__head">
        <h2 id="fitness-weight" className="kicker">
          Weight trend
        </h2>
        {latest !== null && (
          <span className="muted">
            Latest <strong>{latest.toFixed(1)} kg</strong>
            {view.change !== null && (
              <>
                {" "}
                · 7-day change <strong>{signed(view.change)} kg</strong>
              </>
            )}
          </span>
        )}
      </header>
      {readings.length === 0 ? (
        <p className="muted">No weigh-ins in the last 90 days.</p>
      ) : (
        <>
          <div className="chart__plot" aria-hidden="true">
            <LineChart labels={view.cal.map((d) => shortLabel(d.date))} lines={lines} unit=" kg" />
          </div>
          <table className="sr-only">
            <caption>Weight over the last 90 days</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Weight (kg)</th>
                <th scope="col">7-day average (kg)</th>
                <th scope="col">Target (kg)</th>
              </tr>
            </thead>
            <tbody>
              {view.cal.map((d, i) =>
                d.weight === null ? null : (
                  <tr key={d.date}>
                    <th scope="row">{d.date}</th>
                    <td>{d.weight}</td>
                    <td>{view.average[i] ?? "—"}</td>
                    <td>{view.target[i] ?? "—"}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </>
      )}
      {!hasTarget && (
        <p className="muted">
          No target line yet. Add <code>target_weight</code> (with <code>start</code>,{" "}
          <code>end</code> and <code>start_weight</code>) to <code>Fitness/Plan.md</code> to draw
          one.
        </p>
      )}
    </section>
  );
}
