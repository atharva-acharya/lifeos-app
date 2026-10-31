import { useCallback, useEffect, useRef, useState } from "react";
import { getHealth, localDate, type Health, type HealthResponse } from "../api";
import { EmptyHint } from "../components/EmptyHint";
import { HealthToday } from "../components/HealthToday";
import { HealthTrends } from "../components/HealthTrends";
import { HealthWorkouts } from "../components/HealthWorkouts";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { NotConnected } from "../components/NotConnected";
import { ago, dateTime, wholeDays } from "../healthStats";
import type { Navigate } from "../routes";

const REFRESH_MS = 5 * 60_000;
const DATE_CHECK_MS = 60_000;
const LISTED_BAD_FILES = 5;

/** Today's rings and cards, the trend cards, then the workouts list. */
const SKELETON: SkeletonGroup[][] = [
  [
    { height: 200, weight: 2 },
    { cards: 2, height: 92, weight: 3 },
  ],
  [{ cards: 4, columns: 2, height: 160 }],
  [{ height: 240 }],
];

function Notices({ health, now }: { health: Health; now: number }) {
  const bad = health.badFiles.slice(0, LISTED_BAD_FILES).map((f) => f.name);
  const more = health.badFileCount - bad.length;
  return (
    <>
      {health.stale && health.lastExport !== null && (
        <p className="notice" role="status">
          No new export for {wholeDays(health.lastExport, now)} days. Check Health Auto Export on
          your iPhone and iCloud for Windows.
        </p>
      )}
      {health.badFileCount > 0 && (
        <p className="notice" role="status">
          {health.badFileCount} export file{health.badFileCount === 1 ? "" : "s"} could not be read
          and {health.badFileCount === 1 ? "was" : "were"} skipped: {bad.join(", ")}
          {more > 0 ? ` and ${String(more)} more` : ""}.
        </p>
      )}
      {health.skippedFiles > 0 && (
        <p className="notice" role="status">
          The folder has more export files than the app reads. {health.skippedFiles} of the oldest
          were left out.
        </p>
      )}
    </>
  );
}

function Dashboard({ health, now }: { health: Health; now: number }) {
  return (
    <div className="fitness">
      <Notices health={health} now={now} />
      {health.latestData === null && (
        <EmptyHint lead="The export files have no steps, energy, sleep, heart or weight data yet.">
          In Health Auto Export, add those metrics to the export, then let it run once.
        </EmptyHint>
      )}
      <HealthToday day={health.ringsDay} goals={health.goals} days={health.days} />
      <HealthTrends days={health.days} sleepGoal={health.goals.sleepHours} />
      <HealthWorkouts workouts={health.workouts} />
    </div>
  );
}

export function HealthPage({ onNavigate }: { onNavigate: Navigate }) {
  const [response, setResponse] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [date, setDate] = useState(() => localDate());
  const [now, setNow] = useState(() => Date.now());
  // Only the newest request may update the page.
  const request = useRef(0);

  const cancel = useCallback(() => {
    request.current++;
  }, []);

  const load = useCallback(() => {
    const mine = ++request.current;
    getHealth(date)
      .then((r) => {
        if (mine !== request.current) return;
        setNow(Date.now());
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine !== request.current) return;
        setError(loadError(err));
      });
  }, [date]);

  const retry = useCallback(() => {
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancel();
      window.removeEventListener("focus", load);
      clearInterval(timer);
    };
  }, [load, cancel]);

  // Past midnight the 90-day window moves, so fetch again for the new date.
  useEffect(() => {
    const timer = setInterval(() => {
      setDate(localDate());
    }, DATE_CHECK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const health = response?.status === "ready" ? response.health : null;
  const lastExport = health?.lastExport ?? null;

  return (
    <>
      <header className="page-header">
        <p className="kicker">Body</p>
        <h1 className="page-title">Health</h1>
        {health !== null && lastExport !== null && (
          <p className="muted">
            Last export arrived {ago(lastExport, now)} ({dateTime(lastExport)})
          </p>
        )}
      </header>
      {error && <ErrorState title="Could not load health." detail={error.detail} onRetry={retry} />}
      {response === null && error === null && <Skeleton label="health" layout={SKELETON} />}
      {response?.status === "notConfigured" && (
        <NotConnected onNavigate={onNavigate} pill="Not set up">
          Choose the folder where Health Auto Export saves its files, to see your steps, sleep,
          heart rate and weight. The app only reads it.
        </NotConnected>
      )}
      {health?.fileCount === 0 && (
        <section className="card placeholder">
          <span className="pill pill--pending">No files yet</span>
          <EmptyHint lead="The Health folder has no export files.">
            Check that Health Auto Export is writing JSON files to it, and that iCloud for Windows
            has synced them.
          </EmptyHint>
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
      )}
      {health !== null && health.fileCount > 0 && <Dashboard health={health} now={now} />}
    </>
  );
}
