import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getJobs,
  localDate,
  onIndexUpdated,
  type CompanyCard,
  type JobsResponse,
  type OutreachEntry,
} from "../api";
import type { RouteId } from "../routes";

type Tab = "applications" | "pipeline" | "outreach";

const TABS: { id: Tab; label: string }[] = [
  { id: "applications", label: "Applications" },
  { id: "pipeline", label: "Pipeline" },
  { id: "outreach", label: "Outreach" },
];

const STAGE_TONE: Record<string, string> = {
  applied: "pill--read",
  replied: "pill--pending",
  screen: "pill--progress",
  interview: "pill--progress",
  offer: "pill--done",
  rejected: "pill--danger",
};

const OUTREACH_TONE: Record<string, string> = {
  sent: "pill--read",
  accepted: "pill--pending",
  messaged: "pill--progress",
  replied: "pill--done",
  withdrawn: "pill--danger",
};

function title(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function DueBadge({ date, today }: { date: string | null; today: string }) {
  if (!date) return null;
  if (date < today) return <span className="pill pill--danger">Overdue · {shortDate(date)}</span>;
  if (date === today) return <span className="pill pill--progress">Due today</span>;
  return <span className="pill pill--read">{shortDate(date)}</span>;
}

function Card({ card, today }: { card: CompanyCard; today: string }) {
  return (
    <li className="kanban__card">
      <span className="row__title">{card.company ?? card.path}</span>
      {card.role && <span className="row__sub">{card.role}</span>}
      {card.nextAction && <span className="kanban__action">{card.nextAction}</span>}
      <DueBadge date={card.nextDate} today={today} />
    </li>
  );
}

function Pipeline({
  stages,
  today,
}: {
  stages: { stage: string; companies: CompanyCard[] }[];
  today: string;
}) {
  return (
    <div className="kanban" role="list" aria-label="Pipeline">
      {stages.map((s) => (
        <section
          key={s.stage}
          className="kanban__column"
          role="listitem"
          aria-label={title(s.stage)}
        >
          <header className="kanban__head">
            <span className={`pill ${STAGE_TONE[s.stage] ?? "pill--read"}`}>{title(s.stage)}</span>
            <span className="muted">{s.companies.length}</span>
          </header>
          {s.companies.length === 0 ? (
            <p className="muted kanban__empty">None</p>
          ) : (
            <ul className="kanban__cards">
              {s.companies.map((c) => (
                <Card key={c.path} card={c} today={today} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Outreach({ rows }: { rows: OutreachEntry[] }) {
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");
  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.status).filter((s): s is string => s !== null))],
    [rows],
  );
  const kinds = useMemo(
    () => [...new Set(rows.map((r) => r.contactType).filter((s): s is string => s !== null))],
    [rows],
  );
  const shown = rows.filter(
    (r) => (status === "all" || r.status === status) && (kind === "all" || r.contactType === kind),
  );
  const replied = rows.filter((r) => r.status === "replied").length;

  return (
    <section className="card" aria-label="Outreach log">
      <div className="toolbar">
        <label>
          <span className="kicker">Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
          >
            <option value="all">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {title(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="kicker">Type</span>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <option value="all">All</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <span className="muted toolbar__summary">
          {rows.length} contacted · {replied} replied
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="muted">No contacts match.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Sent</th>
              <th scope="col">Name</th>
              <th scope="col">Company / role</th>
              <th scope="col">Type</th>
              <th scope="col">Status</th>
              <th scope="col">Last update</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.name ?? ""}-${String(i)}`}>
                <td>{r.sent ?? "—"}</td>
                <td>{r.name ?? "—"}</td>
                <td>{r.companyRole ?? "—"}</td>
                <td>{r.contactType ?? "—"}</td>
                <td>
                  {r.status && (
                    <span className={`pill ${OUTREACH_TONE[r.status] ?? "pill--read"}`}>
                      {title(r.status)}
                    </span>
                  )}
                </td>
                <td>{r.lastUpdate ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function JobsPage({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [response, setResponse] = useState<JobsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = localDate();

  const load = useCallback(() => {
    getJobs()
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load jobs.");
      });
  }, []);

  useEffect(() => {
    load();
    let unsubscribe: (() => void) | undefined;
    let active = true;
    onIndexUpdated(load)
      .then((u) => {
        if (active) unsubscribe = u;
        else u();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [load]);

  return (
    <>
      <header className="page-header">
        <p className="kicker">Job search</p>
        <h1 className="page-title">Jobs</h1>
      </header>

      <div className="tabs" role="tablist" aria-label="Jobs views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className="tabs__tab"
            onClick={() => {
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "applications" ? (
          <section className="card placeholder">
            <span className="pill pill--pending">Not connected</span>
            <p>Connect your Google Sheet in Settings to see your applications here.</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                onNavigate("settings");
              }}
            >
              Open settings
            </button>
          </section>
        ) : response?.status === "noVault" ? (
          <section className="card placeholder">
            <span className="pill pill--pending">Not connected</span>
            <p>Choose your Life OS vault folder to see your pipeline and outreach.</p>
            <button
              type="button"
              className="button"
              onClick={() => {
                onNavigate("settings");
              }}
            >
              Open settings
            </button>
          </section>
        ) : response?.status === "ready" ? (
          tab === "pipeline" ? (
            <Pipeline stages={response.jobs.pipeline} today={today} />
          ) : (
            <Outreach rows={response.jobs.outreach} />
          )
        ) : null}
      </div>
    </>
  );
}
