import { useCallback, useEffect, useState } from "react";
import {
  getToday,
  localDate,
  onIndexUpdated,
  type FollowUp,
  type Today,
  type TodayResponse,
} from "../api";
import { Group, Metric } from "../components/Card";
import { EmptyHint } from "../components/EmptyHint";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { NotConnected } from "../components/NotConnected";
import { Rings } from "../components/Rings";
import { SetupCard } from "../components/SetupCard";
import type { Navigate } from "../routes";

const HABITS = 5;

/** Habits beside four summary cards, then follow-ups beside the project. */
const SKELETON: SkeletonGroup[][] = [
  [{ height: 236 }, { cards: 4, columns: 2, height: 110 }],
  [
    { height: 180, weight: 3 },
    { height: 180, weight: 2 },
  ],
];
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
    <li className="list__row">
      <div className="list__main">
        <span className="list__title">{item.company ?? item.path}</span>
        <span className="list__sub">
          {[item.role, item.nextAction].filter(Boolean).join(" · ")}
        </span>
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

  const more = today.followUps.length - FOLLOW_UPS_SHOWN;

  return (
    <div className="page">
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
      <div className="grid grid--2">
        <Group title="Habits" cardClassName="today-hero">
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
        </Group>

        <Group title="Summary" bare>
          <div className="grid grid--2 today-metrics">
            <Metric
              label="Follow-ups due"
              color="var(--cat-jobs)"
              count={today.followUps.length}
              onOpen={() => {
                onNavigate("jobs");
              }}
              openLabel="Open Jobs"
            />
            <Metric
              label="Weight"
              color="var(--cat-body)"
              value="—"
              count={today.weight ?? undefined}
              format={(n) => n.toFixed(1)}
              unit={today.weight !== null ? "kg" : undefined}
              aside={
                today.weightChange !== null ? (
                  <span title="Since the last weigh-in">{signed(today.weightChange)} kg</span>
                ) : undefined
              }
              onOpen={() => {
                onNavigate("fitness");
              }}
              openLabel="Open Fitness"
            />
            <Metric
              label="Applied today"
              color="var(--cat-jobs)"
              value={noNote ? "—" : "0"}
              count={today.applications ?? undefined}
              onOpen={() => {
                onNavigate("jobs");
              }}
              openLabel="Open Jobs"
            />
            <Metric
              label="Gym session"
              color="var(--cat-fitness)"
              value={today.gym ?? (noNote ? "—" : "Rest day")}
              onOpen={() => {
                onNavigate("fitness");
              }}
              openLabel="Open Fitness"
            />
          </div>
        </Group>
      </div>

      <div className="grid grid--wide-left">
        <Group
          title="Follow-ups"
          action={
            more > 0 && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  onNavigate("jobs");
                }}
              >
                {more} more in Jobs
              </button>
            )
          }
        >
          {today.followUps.length === 0 ? (
            <EmptyHint lead="Nothing due. Nice.">
              Follow-ups come from <code>type: company</code> notes with a <code>next_date</code>.
            </EmptyHint>
          ) : (
            <ul className="list">
              {today.followUps.slice(0, FOLLOW_UPS_SHOWN).map((f) => (
                <FollowUpRow key={f.path} item={f} today={today.date} />
              ))}
            </ul>
          )}
        </Group>

        <Group title="Resume here" cardClassName={`card--stack${p ? " breathing" : ""}`}>
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
        </Group>
      </div>

      {today.parseErrors > 0 && (
        <p className="notice" role="status">
          {today.parseErrors} note{today.parseErrors === 1 ? "" : "s"} could not be read. Check
          their fields.
        </p>
      )}
    </div>
  );
}

export function TodayPage({ onNavigate }: { onNavigate: Navigate }) {
  const [response, setResponse] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const date = localDate();

  const load = useCallback(() => {
    getToday(date)
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(loadError(err));
      });
  }, [date]);

  const retry = useCallback(() => {
    setError(null);
    load();
  }, [load]);

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
        <p className="page-header__sub">{longDate(date)}</p>
        <h1 className="page-title">{greeting(new Date().getHours())}</h1>
      </header>
      {error && <ErrorState title="Could not load today." detail={error.detail} onRetry={retry} />}
      {response === null && error === null && <Skeleton label="today" layout={SKELETON} />}
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
