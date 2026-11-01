import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import {
  getToday,
  localDate,
  onIndexUpdated,
  type FollowUp,
  type Today,
  type TodayResponse,
} from "../api";
import { Metric } from "../components/Card";
import { EmptyHint } from "../components/EmptyHint";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { NotConnected } from "../components/NotConnected";
import { Rings } from "../components/Rings";
import { SetupCard } from "../components/SetupCard";
import type { Navigate } from "../routes";
import "../styles/today.css";

const HABITS = 5;

/** Rings beside four summary cards, then the project beside follow-ups. */
const SKELETON: SkeletonGroup[][] = [
  [
    { height: 340, weight: 5 },
    { cards: 4, columns: 2, height: 160, weight: 7 },
  ],
  [
    { height: 300, weight: 7 },
    { height: 300, weight: 5 },
  ],
];
/** Today fits the window without scrolling, so the list is capped. */
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

/** What is left of a daily goal, in words (ui-spec P3). */
function toGo(goal: number, value: number | null, unit = ""): string {
  if (value === null) return "Not logged yet";
  if (value >= goal) return "Goal reached";
  return `${(goal - value).toLocaleString("en-GB")}${unit} to go`;
}

function Habit({ label, done }: { label: string; done: boolean }) {
  return (
    <li className={`habit${done ? " habit--done" : ""}`}>
      <span className="habit__tick" aria-hidden="true">
        <svg viewBox="0 0 12 12" focusable="false">
          <path d="M2.5 6.2 4.9 8.6 9.5 3.6" />
        </svg>
      </span>
      <span>{label}</span>
      <span className="sr-only">{done ? "done" : "not yet"}</span>
    </li>
  );
}

/** A card's own title row: the title inside the card, an action on the right. */
function CardHead({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="card__head">
      <h2 id={id} className="card__title">
        {title}
      </h2>
      {action}
    </div>
  );
}

function MoreLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="link-button card__action" onClick={onClick}>
      {children}
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M4.5 2.5 8 6l-3.5 3.5" />
      </svg>
    </button>
  );
}

function FollowUpRow({ item, today }: { item: FollowUp; today: string }) {
  const overdue = item.nextDate < today;
  const name = item.company ?? item.path;
  return (
    <li className="list__row today__follow-row">
      <span className="today__mark" aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <div className="list__main">
        <span className="list__title">{name}</span>
        <span className="list__sub">
          {[item.role, item.stage, item.nextAction].filter(Boolean).join(" · ")}
        </span>
      </div>
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
  const ringsId = useId();
  const resumeId = useId();
  const followId = useId();

  const noNote = !today.hasDailyNote;
  const more = today.followUps.length - FOLLOW_UPS_SHOWN;

  return (
    <div className="page page--fit today">
      {noNote && (
        <section className="card today__note" aria-label="Daily note">
          <EmptyHint
            lead={`No daily note for ${dayMonth(today.date)}.`}
            guide="daily"
            onNavigate={onNavigate}
          >
            Add a note with <code>type: daily</code> and <code>date: {today.date}</code>.
          </EmptyHint>
        </section>
      )}
      <div className="today__grid">
        <section className="card today__rings" aria-labelledby={ringsId}>
          <CardHead
            id={ringsId}
            title="Today's rings"
            action={<span className="card__aside">{habitsDone} of 5 habits</span>}
          />
          <Rings
            size={200}
            variant="hero"
            rings={[
              {
                key: "habits",
                name: "Habits",
                value: habitsDone,
                goal: HABITS,
                color: "var(--ring-habits)",
                hint:
                  habitsDone === HABITS ? "All done today" : `${String(HABITS - habitsDone)} to go`,
              },
              {
                key: "steps",
                name: "Steps",
                value: h.steps ?? 0,
                goal: today.stepsGoal,
                color: "var(--cat-fitness)",
                hint: toGo(today.stepsGoal, h.steps),
              },
              {
                key: "protein",
                name: "Protein",
                value: h.proteinG ?? 0,
                goal: today.proteinGoal,
                unit: " g",
                color: "var(--ring-protein)",
                hint: toGo(today.proteinGoal, h.proteinG, " g"),
              },
            ]}
          />
          {/* The rings carry the numbers; the chips only say what is done. */}
          <ul className="habits" aria-label="Habits">
            <Habit label="Weigh-in" done={h.weighIn} />
            <Habit label="Steps" done={h.steps !== null} />
            <Habit label="Protein" done={h.proteinG !== null} />
            <Habit label="Meals" done={h.mealsTracked} />
            <Habit label="Mobility" done={h.mobility} />
          </ul>
        </section>

        <div className="today__metrics">
          <Metric
            label="Follow-ups due"
            color="var(--cat-jobs)"
            count={today.followUps.length}
            unit="due"
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
            unit={today.applications !== null ? "applications" : undefined}
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

        <section
          className={`card today__resume${p ? " breathing" : ""}`}
          aria-labelledby={resumeId}
        >
          <CardHead
            id={resumeId}
            title="Pick up where you left off"
            action={
              <MoreLink
                onClick={() => {
                  onNavigate("projects");
                }}
              >
                All projects
              </MoreLink>
            }
          />
          {p ? (
            <div className="resume">
              <div className="resume__top">
                <p className="resume__project">{p.project ?? p.path}</p>
                <p className="resume__step">
                  Step {Math.min(p.done + 1, p.total)} of {p.total}
                </p>
              </div>
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
              {p.nextStep && (
                <p className="resume__next">
                  <span className="pill pill--progress">Next</span> {p.nextStep}
                </p>
              )}
              {p.lastLog && <p className="muted resume__last">Last: {p.lastLog}</p>}
            </div>
          ) : (
            <EmptyHint lead="No active project." guide="projects" onNavigate={onNavigate}>
              Add a <code>type: project</code> note with <code>status: active</code> and a{" "}
              <code>## Steps</code> checklist.
            </EmptyHint>
          )}
        </section>

        <section className="card today__follow" aria-labelledby={followId}>
          <CardHead
            id={followId}
            title="Follow-ups"
            action={
              more > 0 && (
                <MoreLink
                  onClick={() => {
                    onNavigate("jobs");
                  }}
                >
                  {more} more in Jobs
                </MoreLink>
              )
            }
          />
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
        </section>
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
        <h1 className="page-title">{greeting(new Date().getHours())}</h1>
        <p className="page-header__sub">{longDate(date)}</p>
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
