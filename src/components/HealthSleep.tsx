import { useMemo, useRef, useState } from "react";
import type { HealthDay } from "../api";
import { shortLabel } from "../fitnessStats";
import { latestSleep, sleepContributors, sleepHours } from "../healthStats";
import { BarChart, type Series } from "./BarChart";
import { MetricHead } from "./Card";
import { Contributors } from "./Contributors";
import { EmptyHint } from "./EmptyHint";
import { ValueChevron } from "./HealthTrendCard";
import { Sheet } from "./Sheet";
import "../styles/contributors.css";

interface Row {
  date: string;
  label: string;
  hours: number;
  total: number | null;
}

const SERIES: Series<Row>[] = [
  { key: "sleep", name: "Sleep", color: "var(--cat-sleep)", value: (r) => r.hours },
];

/**
 * Nightly sleep against the goal, and the stages of the latest night. The
 * value opens the latest night's stages against the 30-day average (P4).
 */
export function HealthSleep({
  days,
  goal,
  history,
}: {
  days: HealthDay[];
  goal: number;
  /** Every day (oldest first), not just the shown range, for the 30-day average. */
  history?: HealthDay[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
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
    <section className="card chart-card" aria-labelledby="health-sleep">
      <MetricHead
        as="h3"
        id="health-sleep"
        label="Sleep"
        color="var(--cat-sleep)"
        aside={night ? shortLabel(night.date) : undefined}
      />
      {night?.sleep && (
        <>
          <button
            ref={button}
            type="button"
            className="metric__value metric__value--button"
            aria-haspopup="dialog"
            aria-label={`Latest night ${sleepHours(night.sleep.total)}, sleep in detail`}
            onClick={() => {
              setOpen(true);
            }}
          >
            <span className="sr-only">Latest night </span>
            {sleepHours(night.sleep.total)}
            <ValueChevron />
          </button>
          <Sheet
            open={open}
            onClose={() => {
              setOpen(false);
            }}
            title="Sleep in detail"
            trigger={button}
          >
            <Contributors
              lead={`The night of ${shortLabel(night.date)}, against your own average over the 30 nights before.`}
              items={sleepContributors(history ?? days)}
            />
          </Sheet>
        </>
      )}
      {night === null ? (
        <EmptyHint lead="No sleep recorded in this range.">
          Turn on Sleep Analysis in Health Auto Export, or pick a longer range.
        </EmptyHint>
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
          <h4 className="card__title">Stages on {shortLabel(night.date)}</h4>
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
