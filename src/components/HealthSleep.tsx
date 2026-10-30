import { useMemo } from "react";
import type { HealthDay } from "../api";
import { shortLabel } from "../fitnessStats";
import { latestSleep, sleepHours } from "../healthStats";
import { BarChart, type Series } from "./BarChart";

interface Row {
  date: string;
  label: string;
  hours: number;
  total: number | null;
}

const SERIES: Series<Row>[] = [
  { key: "sleep", name: "Sleep", color: "var(--c-read)", value: (r) => r.hours },
];

/** Nightly sleep against the goal, and the stages of the latest night. */
export function HealthSleep({ days, goal }: { days: HealthDay[]; goal: number }) {
  const rows: Row[] = useMemo(
    () =>
      days.map((d) => ({
        date: d.date,
        label: shortLabel(d.date),
        hours: d.sleep?.total ?? 0,
        total: d.sleep?.total ?? null,
      })),
    [days],
  );
  const night = latestSleep(days);
  const stages = night?.sleep
    ? [
        { name: "Core", hours: night.sleep.core },
        { name: "Deep", hours: night.sleep.deep },
        { name: "REM", hours: night.sleep.rem },
        { name: "Awake", hours: night.sleep.awake },
      ]
    : [];

  return (
    <section className="card chart" aria-labelledby="health-sleep">
      <header className="chart__head">
        <h3 id="health-sleep" className="kicker">
          Sleep
        </h3>
        {night?.sleep && (
          <span className="muted">
            Latest night <strong>{sleepHours(night.sleep.total)}</strong>
          </span>
        )}
      </header>
      {night === null ? (
        <p className="muted">No sleep recorded in this range.</p>
      ) : (
        <>
          <div className="chart__plot" aria-hidden="true">
            <BarChart
              data={rows}
              label={(r) => r.label}
              series={SERIES}
              target={{ value: goal, label: `Goal ${sleepHours(goal)}` }}
              unit=" h"
            />
          </div>
          <table className="sr-only">
            <caption>Nightly sleep</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Sleep</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.total === null ? null : (
                  <tr key={r.date}>
                    <th scope="row">{r.date}</th>
                    <td>{sleepHours(r.total)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <h4 className="kicker">Stages on {shortLabel(night.date)}</h4>
          <ul className="pill-list" aria-label="Latest night stages">
            {stages.map((s) => (
              <li key={s.name}>
                <span className="pill">
                  {s.name} · {sleepHours(s.hours)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
