import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getApplications,
  refreshApplications,
  type Application,
  type ApplicationsView,
} from "../api";
import type { Navigate } from "../routes";
import { NotConnected } from "./NotConnected";

const STALE_MS = 15 * 60 * 1000;

type SortKey = "applied" | "company" | "status";

function ago(ms: number, now: number): string {
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${String(mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} d ago`;
}

function statusTone(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("reject") || s.includes("closed")) return "pill--danger";
  if (s.includes("offer")) return "pill--done";
  if (s.includes("interview") || s.includes("screen")) return "pill--progress";
  if (s.includes("repl")) return "pill--pending";
  return "pill--read";
}

function unique(rows: Application[], key: "status" | "source"): string[] {
  return [...new Set(rows.map((r) => r[key]).filter((v): v is string => v !== null))].sort();
}

export function ApplicationsTab({ onNavigate }: { onNavigate: Navigate }) {
  const [view, setView] = useState<ApplicationsView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("applied");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(id);
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    refreshApplications()
      .then((v) => {
        setView(v);
        setNow(Date.now());
      })
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    getApplications()
      .then((v) => {
        setView(v);
        const stale = !v.cache || Date.now() - v.cache.fetchedAt > STALE_MS;
        if (v.connected && stale) refresh();
      })
      .catch(() => undefined);
  }, [refresh]);

  const rows = useMemo(() => view?.cache?.rows ?? [], [view]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => source === "all" || r.source === source)
      .filter(
        (r) =>
          q === "" ||
          [r.company, r.role, r.notes].some((v) => v?.toLowerCase().includes(q) ?? false),
      )
      .sort((a, b) =>
        sort === "applied"
          ? (b.applied ?? "").localeCompare(a.applied ?? "")
          : (a[sort] ?? "").localeCompare(b[sort] ?? ""),
      );
  }, [rows, status, source, query, sort]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = r.status ?? "No status";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (!view) return null;

  if (!view.cache && !view.connected) {
    return (
      <NotConnected onNavigate={onNavigate}>
        Connect your Google Sheet in Settings to see your applications here.
      </NotConnected>
    );
  }

  return (
    <section className="card" aria-label="Applications">
      <div className="toolbar">
        <label>
          <span className="kicker">Search</span>
          <input
            className="toolbar__search"
            value={query}
            placeholder="Company, role or notes"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="kicker">Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <option value="all">All</option>
            {unique(rows, "status").map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="kicker">Source</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
            }}
          >
            <option value="all">All</option>
            {unique(rows, "source").map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="kicker">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
            }}
          >
            <option value="applied">Newest first</option>
            <option value="company">Company</option>
            <option value="status">Status</option>
          </select>
        </label>
        <div className="toolbar__summary">
          <span className="muted">
            {view.cache ? `Updated ${ago(view.cache.fetchedAt, now)}` : "Not loaded yet"}
          </span>
          {view.connected && (
            <button type="button" className="button" disabled={refreshing} onClick={refresh}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {view.error && (
        <p className="notice" role="status">
          {view.error}
        </p>
      )}
      {view.cache && view.cache.missingColumns.length > 0 && (
        <p className="notice" role="status">
          The Sheet is missing: {view.cache.missingColumns.join(", ")}.
        </p>
      )}

      <ul className="counts" aria-label="Applications by status">
        <li>
          <strong>{rows.length}</strong> total
        </li>
        {counts.map(([s, n]) => (
          <li key={s}>
            <span className={`pill ${statusTone(s)}`}>{s}</span> {n}
          </li>
        ))}
      </ul>

      {shown.length === 0 ? (
        <p className="muted">No applications match.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Applied</th>
              <th scope="col">Company</th>
              <th scope="col">Role</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Follow up</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.company ?? ""}-${r.applied ?? ""}-${String(i)}`}>
                <td>{r.applied ?? "—"}</td>
                <td>{r.company ?? "—"}</td>
                <td>{r.role ?? "—"}</td>
                <td>{r.source ?? "—"}</td>
                <td>
                  {r.status && <span className={`pill ${statusTone(r.status)}`}>{r.status}</span>}
                </td>
                <td>{r.followUp ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
