import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getApplications, type Application, type ApplicationsView } from "../api";
import { perWeek, replyRates } from "../jobStats";
import type { RouteId } from "../routes";

const AXIS = { fill: "var(--text-muted)", fontSize: 12 };
const TOOLTIP = {
  contentStyle: {
    background: "var(--bg-sidebar)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
  },
  cursor: { fill: "var(--bg-hover)" },
};

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function PerWeek({ rows, animate }: { rows: Application[]; animate: boolean }) {
  const weeks = useMemo(() => perWeek(rows, new Date()), [rows]);
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
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP} />
            <Bar
              dataKey="count"
              name="Applications"
              fill="var(--c-read)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={animate}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Applications per week, week starting</caption>
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

function ReplyRate({ rows, animate }: { rows: Application[]; animate: boolean }) {
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
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={sources} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="source" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis
              unit="%"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip {...TOOLTIP} formatter={(v) => `${String(v)}%`} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
            <Bar
              dataKey="positivePct"
              name="Moved on"
              stackId="r"
              fill="var(--c-done)"
              isAnimationActive={animate}
            />
            <Bar
              dataKey="rejectedPct"
              name="Rejected"
              stackId="r"
              fill="var(--c-danger)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={animate}
            />
          </BarChart>
        </ResponsiveContainer>
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
  const animate = !reducedMotion();
  if (rows.length === 0) {
    return <p className="muted">No applications in the saved copy yet.</p>;
  }
  return (
    <div className="charts">
      <PerWeek rows={rows} animate={animate} />
      <ReplyRate rows={rows} animate={animate} />
    </div>
  );
}

/** Charts tab: reads the saved copy of the Sheet; the Applications tab refreshes it. */
export function ChartsTab({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const [view, setView] = useState<ApplicationsView | null>(null);

  useEffect(() => {
    getApplications()
      .then(setView)
      .catch(() => undefined);
  }, []);

  if (!view) return null;

  if (!view.cache) {
    return (
      <section className="card placeholder">
        <span className="pill pill--pending">No data yet</span>
        <p>
          {view.connected
            ? "Open the Applications tab to load your Sheet."
            : "Connect your Google Sheet in Settings to see your charts."}
        </p>
        {!view.connected && (
          <button
            type="button"
            className="button"
            onClick={() => {
              onNavigate("settings");
            }}
          >
            Open settings
          </button>
        )}
      </section>
    );
  }

  return <JobCharts rows={view.cache.rows} />;
}
