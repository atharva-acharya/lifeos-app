import { useMemo } from "react";
import type { FitnessDay } from "../api";
import { calendar, shortLabel } from "../fitnessStats";
import { BarChart, type Series } from "./BarChart";
import { EmptyHint } from "./EmptyHint";
import { Group } from "./Card";

const DAYS = 14;

interface Row {
  date: string;
  label: string;
  steps: number;
  loggedSteps: number | null;
  proteinG: number | null;
  hit: Hit;
}

type Hit = "hit" | "missed" | "none";

const STEPS: Series<Row>[] = [
  { key: "steps", name: "Steps", color: "var(--c-progress)", value: (d) => d.steps },
];

const PILL: Record<Hit, { cls: string; text: string }> = {
  hit: { cls: "pill--done", text: "Hit" },
  missed: { cls: "pill--danger", text: "Missed" },
  none: { cls: "pill--pending", text: "No data" },
};

function hitOf(proteinG: number | null, goal: number): Hit {
  if (proteinG === null) return "none";
  return proteinG >= goal ? "hit" : "missed";
}

/** Steps for the last 14 days and whether each day met the protein goal. */
export function FitnessActivity({
  days,
  proteinGoal,
  today,
}: {
  days: FitnessDay[];
  proteinGoal: number;
  today: string;
}) {
  const rows: Row[] = useMemo(
    () =>
      calendar(days, today, DAYS).map((d) => ({
        date: d.date,
        label: shortLabel(d.date),
        steps: d.steps ?? 0,
        loggedSteps: d.steps,
        proteinG: d.proteinG,
        hit: hitOf(d.proteinG, proteinGoal),
      })),
    [days, proteinGoal, today],
  );
  const hits = rows.filter((r) => r.hit === "hit").length;
  const nothingLogged = rows.every((r) => r.loggedSteps === null && r.proteinG === null);

  return (
    <Group title="Steps and protein" cardClassName="card--stack chart-card">
      <span className="muted">
        Protein goal {proteinGoal} g, hit on{" "}
        <strong>
          {hits} of {DAYS}
        </strong>{" "}
        days
      </span>
      {nothingLogged && (
        <EmptyHint lead="No steps or protein logged in the last 14 days.">
          Add <code>steps</code> and <code>protein_g</code> to your <code>type: daily</code> notes.
        </EmptyHint>
      )}
      <div className="chart__plot" aria-hidden="true">
        <BarChart data={rows} label={(r) => r.label} series={STEPS} />
      </div>
      <ul className="pill-list" aria-label="Protein by day">
        {rows.map((r) => (
          <li key={r.date}>
            <span className={`pill ${PILL[r.hit].cls}`}>
              {r.label} · {PILL[r.hit].text}
            </span>
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>Steps and protein, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Steps</th>
            <th scope="col">Protein (g)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row">{r.date}</th>
              <td>{r.loggedSteps ?? "—"}</td>
              <td>{r.proteinG ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Group>
  );
}
