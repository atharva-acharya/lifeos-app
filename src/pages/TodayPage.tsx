import { useCallback, useEffect, useState } from "react";
import {
  getToday,
  localDate,
  onIndexUpdated,
  type FollowUp,
  type Today,
  type TodayResponse,
} from "../api";
import { EmptyHint } from "../components/EmptyHint";
import { NotConnected } from "../components/NotConnected";
import { Rings } from "../components/Rings";
import { SetupCard } from "../components/SetupCard";
import type { Navigate } from "../routes";

const HABITS = 5;
/** Home must fit the minimum window without scrolling, so the list is capped. */
const FOLLOW_UPS_SHOWN = 3;

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function dayMonth(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  tone?: "progress" | "done";
}) {
  return (
    <section className="card stat" aria-label={label}>
      <p className="kicker">{label}</p>
      <p className={`stat__value${tone ? ` stat__value--${tone}` : ""}`}>{value}</p>
      {detail && <div className="stat__detail">{detail}</div>}
    </section>
  );
}

function Habit({ label, done, value }: { label: string; done: boolean; value?: string }) {
  return (
    <li className={`habit${done ? " habit--done" : ""}`}>
      <span className="habit__tick" aria-hidden="true">
        {done ? "✓" : ""}
      </span>
      <span>{label}</span>
      {value && <span className="habit__value">{value}</span>}
      <span className="sr-only">{done ? "done" : "not yet"}</span>
    </li>
  );
}

function FollowUpRow({ item, today }: { item: FollowUp; today: string }) {
  const overdue = item.nextDate < today;
  return (
    <li className="row">
      <div className="row__main">
        <span className="row__title">{item.company ?? item.path}</span>
        <span className="row__sub">{[item.role, item.nextAction].filter(Boolean).join(" · ")}</span>
      </div>
      {item.stage && <span className="pill pill--read">{item.stage}</span>}
      <span className={`pill ${overdue ? "pill--danger" : "pill--progress"}`}>
        {overdue ? `Overdue · ${item.nextDate}` : "Due today"}
      </span>
    </li>
  );
}

function Dashboard({ today, onNavigate }: { today: Today; onNavigate: Navigate }) {
  const h = today.habits;
  const habitsDone = [
    h.weighIn,
    h.steps !== null,
    h.proteinG !== null,
    h.mealsTracked,
    h.mobility,
  ].filter(Boolean).length;
  const p = today.project;
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;

  const noNote = !today.hasDailyNote;

  return (
    <>
      {noNote && (
        <section className="card" aria-label="Daily note">
          <EmptyHint
            lead={`No daily note for ${dayMonth(today.date)}.`}
            guide="daily"
            onNavigate={onNavigate}
          >
            Add a note with <code>type: daily</code> and <code>date: {today.date}</code>.
          </EmptyHint>
        </section>
      )}
      <div className="today-top">
        <section className="card today-hero" aria-labelledby="habits-heading">
          <Rings
            size={96}
            rings={[
              {
                key: "habits",
                name: "Habits",
                value: habitsDone,
                goal: HABITS,
                color: habitsDone === HABITS ? "var(--ring-exercise)" : "var(--ring-move)",
              },
            ]}
          />
          <div className="today-hero__habits">
            <h2 id="habits-heading" className="kicker">
              Habits
            </h2>
            <ul className="habits">
              <Habit label="Weigh-in" done={h.weighIn} />
              <Habit
                label="Steps"
                done={h.steps !== null}
                value={h.steps !== null ? h.steps.toLocaleString("en-GB") : undefined}
              />
              <Habit
                label="Protein"
                done={h.proteinG !== null}
                value={h.proteinG !== null ? `${String(h.proteinG)} g` : undefined}
              />
              <Habit label="Meals tracked" done={h.mealsTracked} />
              <Habit label="Mobility" done={h.mobility} />
            </ul>
          </div>
        </section>

        <div className="stats">
          <Stat
            label="Follow-ups due"
            value={String(today.followUps.length)}
            tone={today.followUps.length > 0 ? "progress" : "done"}
          />
          <Stat
            label="Weight"
            value={today.weight !== null ? `${today.weight.toFixed(1)} kg` : "—"}
            detail={
              today.weightChange !== null ? (
                <span className="pill pill--read">{signed(today.weightChange)} kg since last</span>
              ) : (
                today.weight === null && "Not weighed in yet"
              )
            }
          />
          <Stat
            label="Applications today"
            value={today.applications !== null ? String(today.applications) : noNote ? "—" : "0"}
          />
          <Stat label="Gym session" value={today.gym ?? (noNote ? "—" : "Rest day")} />
        </div>
      </div>

      <div className="columns">
        <section className="card" aria-labelledby="followups-heading">
          <div className="section-head">
            <h2 id="followups-heading" className="kicker">
              Follow-ups
            </h2>
            {today.followUps.length > FOLLOW_UPS_SHOWN && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onNavigate("jobs");
                }}
              >
                {today.followUps.length - FOLLOW_UPS_SHOWN} more in Jobs
              </button>
            )}
          </div>
          {today.followUps.length === 0 ? (
            <EmptyHint lead="Nothing due. Nice.">
              Follow-ups come from <code>type: company</code> notes with a <code>next_date</code>.
            </EmptyHint>
          ) : (
            <ul className="rows">
              {today.followUps.slice(0, FOLLOW_UPS_SHOWN).map((f) => (
                <FollowUpRow key={f.path} item={f} today={today.date} />
              ))}
            </ul>
          )}
        </section>

        <section className={`card${p ? " breathing" : ""}`} aria-labelledby="resume-heading">
          <h2 id="resume-heading" className="kicker">
            Resume here
          </h2>
          {p ? (
            <div className="resume">
              <p className="resume__project">{p.project ?? p.path}</p>
              <div
                className="progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={p.total}
                aria-valuenow={p.done}
                aria-label={`${String(p.done)} of ${String(p.total)} steps done`}
              >
                <span style={{ width: `${String(pct)}%` }} />
              </div>
              <p className="muted">
                Step {Math.min(p.done + 1, p.total)} of {p.total}
              </p>
              {p.nextStep && (
                <p className="resume__next">
                  <span className="pill pill--progress">Next</span> {p.nextStep}
                </p>
              )}
              {p.lastLog && <p className="muted">Last: {p.lastLog}</p>}
            </div>
          ) : (
            <EmptyHint lead="No active project." guide="projects" onNavigate={onNavigate}>
              Add a <code>type: project</code> note with <code>status: active</code> and a{" "}
              <code>## Steps</code> checklist.
            </EmptyHint>
          )}
        </section>
      </div>

      {today.parseErrors > 0 && (
        <p className="notice" role="status">
          {today.parseErrors} note{today.parseErrors === 1 ? "" : "s"} could not be read. Check
          their fields.
        </p>
      )}
    </>
  );
}

export function TodayPage({ onNavigate }: { onNavigate: Navigate }) {
  const [response, setResponse] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = localDate();

  const load = useCallback(() => {
    getToday(date)
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load today.");
      });
  }, [date]);

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
        <p className="kicker">{longDate(date)}</p>
        <h1 className="page-title">{greeting(new Date().getHours())}</h1>
      </header>
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
      {response?.status === "noVault" && (
        <NotConnected onNavigate={onNavigate}>
          Choose your Life OS vault folder to see today's dashboard.
        </NotConnected>
      )}
      {response?.status === "ready" && (
        <>
          <SetupCard onNavigate={onNavigate} />
          <Dashboard today={response.today} onNavigate={onNavigate} />
        </>
      )}
    </>
  );
}
