import { useId, useRef, useState } from "react";
import { shortLabel } from "../fitnessStats";
import { count, decimal, seriesContributors } from "../healthStats";
import { MetricHead } from "./Card";
import { Contributors } from "./Contributors";
import { EmptyHint } from "./EmptyHint";
import { LineChart } from "./LineChart";
import { Sheet } from "./Sheet";
import "../styles/contributors.css";

/** A chevron after a value that opens its detail sheet. */
export function ValueChevron() {
  return (
    <svg
      className="metric__value-chevron"
      viewBox="0 0 8 13"
      width="8"
      height="13"
      aria-hidden="true"
    >
      <path
        d="M1.5 1.5 6.5 6.5 1.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface TrendCardProps {
  title: string;
  /** Series name, e.g. "Resting heart rate". */
  name: string;
  /** Unit written after values, with a leading space, e.g. " bpm". */
  unit: string;
  color: string;
  dates: string[];
  values: (number | null)[];
  average: (number | null)[];
  /** An extra text column in the screen-reader table (e.g. the weight source). */
  noteHeader?: string;
  notes?: (string | null)[];
  decimals?: number;
  /**
   * The whole daily series (oldest first), not just the shown range, so the
   * detail sheet can compare with the 30-day average. Defaults to `values`.
   */
  history?: (number | null)[];
}

/** A line chart card: daily readings as dots and a 7-day average line. */
export function TrendCard({
  title,
  name,
  unit,
  color,
  dates,
  values,
  average,
  noteHeader,
  notes,
  decimals = 1,
  history,
}: TrendCardProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const u = unit.trim();
  const format = decimals === 0 ? count(u) : decimal(u);
  const at = values.reduce<number>((last, v, i) => (v === null ? last : i), -1);
  const latest = at >= 0 ? values[at] : null;
  return (
    <section className="card chart-card" aria-labelledby={id}>
      <MetricHead
        as="h3"
        id={id}
        label={title}
        color={color}
        aside={latest !== null ? shortLabel(dates[at]) : undefined}
      />
      {latest !== null && (
        <>
          <button
            ref={button}
            type="button"
            className="metric__value metric__value--button"
            aria-haspopup="dialog"
            aria-label={`Latest ${latest.toFixed(decimals)}${u ? ` ${u}` : ""}, ${title} in detail`}
            onClick={() => {
              setOpen(true);
            }}
          >
            <span className="sr-only">Latest </span>
            {latest.toFixed(decimals)}
            {u && <span className="metric__unit"> {u}</span>}
            <ValueChevron />
          </button>
          <Sheet
            open={open}
            onClose={() => {
              setOpen(false);
            }}
            title={`${title} in detail`}
            trigger={button}
          >
            <Contributors
              lead={`Latest reading on ${shortLabel(dates[at])}, against your own average over the 30 days before.`}
              items={seriesContributors(name, history ?? values, format)}
            />
          </Sheet>
        </>
      )}
      {latest === null ? (
        <EmptyHint lead="No readings in this range.">
          Pick a longer range, or check this metric is on in Health Auto Export.
        </EmptyHint>
      ) : (
        <>
          <div className="chart__plot" aria-hidden="true">
            <LineChart
              labels={dates.map(shortLabel)}
              lines={[
                { key: "daily", name, color, values, dots: true },
                { key: "avg", name: "7-day average", color: "var(--c-progress)", values: average },
              ]}
              unit={unit}
            />
          </div>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">{name}</th>
                <th scope="col">7-day average</th>
                {noteHeader && <th scope="col">{noteHeader}</th>}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) =>
                values[i] === null ? null : (
                  <tr key={date}>
                    <th scope="row">{date}</th>
                    <td>{values[i]}</td>
                    <td>{average[i] ?? "—"}</td>
                    {noteHeader && <td>{notes?.[i] ?? "—"}</td>}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
