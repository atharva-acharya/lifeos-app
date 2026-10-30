import { useEffect, useMemo, useState } from "react";
import { getApplications, localDate, type Application, type ApplicationsView } from "../api";
import { parseApplied, perWeek, replyRates, type SourceRate, type WeekCount } from "../jobStats";
import type { Navigate } from "../routes";
import { NotConnected } from "./NotConnected";
import { BarChart, type Series } from "./BarChart";

const WEEKLY: Series<WeekCount>[] = [
  { key: "count", name: "Applications", color: "var(--c-read)", value: (w) => w.count },
];

const REPLIES: Series<SourceRate>[] = [
  { key: "positive", name: "Moved on", color: "var(--c-done)", value: (s) => s.positivePct },
  { key: "rejected", name: "Rejected", color: "var(--c-danger)", value: (s) => s.rejectedPct },
];

function PerWeek({ rows }: { rows: Application[] }) {
  // Keyed on today's date so the window moves on if the app stays open overnight.
  const today = localDate();
  const weeks = useMemo(() => perWeek(rows, parseApplied(today) ?? new Date()), [rows, today]);
  const total = weeks.reduce((n, w) => n + w.count, 0);
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0;
  const average = Math.round((total / weeks.length) * 10) / 10;

  return (
    <section className="card chart" aria-labelledby="chart-weekly">
      <header className="chart__head">
        <h2 id="chart-weekly" className="kicker">
          Applications per week
        </h2>
        <span className="muted">
          This week <strong>{thisWeek}</strong> · 12-week average <strong>{average}</strong>
        </span>
      </header>
      <div className="chart__plot" aria-hidden="true">
        <BarChart data={weeks} label={(w) => w.label} series={WEEKLY} />
      </div>
      <table className="sr-only">
        <caption>Applications per week</caption>
        <thead>
          <tr>
            <th scope="col">Week starting</th>
            <th scope="col">Applications</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.week}>
              <th scope="row">{w.label}</th>
              <td>{w.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ReplyRate({ rows }: { rows: Application[] }) {
  const { sources, unmatched } = useMemo(() => replyRates(rows), [rows]);

  return (
    <section className="card chart" aria-labelledby="chart-replies">
      <header className="chart__head">
        <h2 id="chart-replies" className="kicker">
          Reply rate by source
        </h2>
        <span className="muted">Share of applications that got any reply</span>
      </header>
      <div className="chart__plot" aria-hidden="true">
        <BarChart data={sources} label={(r) => r.source} series={REPLIES} max={100} unit="%" />
      </div>
      <table className="table chart__table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Applied</th>
            <th scope="col">Moved on</th>
            <th scope="col">Rejected</th>
            <th scope="col">Reply rate</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.source}>
              <th scope="row">{s.source}</th>
              <td>{s.applied}</td>
              <td>{s.positive}</td>
              <td>{s.rejected}</td>
              <td>{s.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unmatched > 0 && (
        <p className="muted">
          {unmatched} {unmatched === 1 ? "reply" : "replies"} not matched to an application (Reply
          only) are left out.
        </p>
      )}
    </section>
  );
}

export function JobCharts({ rows }: { rows: Application[] }) {
  // "Reply only" rows alone give nothing to chart.
  if (replyRates(rows).sources.length === 0) {
    return <p className="muted">No applications in the saved copy yet.</p>;
  }
  return (
    <div className="charts">
      <PerWeek rows={rows} />
      <ReplyRate rows={rows} />
    </div>
  );
}

/** Charts tab: reads the saved copy of the Sheet; the Applications tab refreshes it. */
export function ChartsTab({ onNavigate }: { onNavigate: Navigate }) {
  const [view, setView] = useState<ApplicationsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApplications()
      .then(setView)
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load applications.");
      });
  }, []);

  if (error) {
    return (
      <p className="setting__error" role="alert">
        {error}
      </p>
    );
  }

  if (!view) return null;

  if (!view.cache) {
    return view.connected ? (
      <section className="card placeholder">
        <span className="pill pill--pending">No data yet</span>
        <p>Open the Applications tab to load your Sheet.</p>
      </section>
    ) : (
      <NotConnected onNavigate={onNavigate} pill="No data yet">
        Connect your Google Sheet in Settings to see your charts.
      </NotConnected>
    );
  }

  return (
    <>
      {view.error && (
        <p className="notice" role="status">
          {view.error}
        </p>
      )}
      <JobCharts rows={view.cache.rows} />
    </>
  );
}
