import { useId } from "react";
import { shortLabel } from "../fitnessStats";
import { EmptyHint } from "./EmptyHint";
import { LineChart } from "./LineChart";

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
}: TrendCardProps) {
  const id = useId();
  const latest = values.reduce<number | null>((last, v) => v ?? last, null);
  return (
    <section className="card chart" aria-labelledby={id}>
      <header className="chart__head">
        <h3 id={id} className="kicker">
          {title}
        </h3>
        {latest !== null && (
          <span className="muted">
            Latest{" "}
            <strong>
              {latest.toFixed(decimals)}
              {unit}
            </strong>
          </span>
        )}
      </header>
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
