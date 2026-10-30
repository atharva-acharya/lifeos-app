import { useCallback, useEffect, useState } from "react";
import { getFitness, localDate, onIndexUpdated, type Fitness, type FitnessResponse } from "../api";
import { FitnessActivity } from "../components/FitnessActivity";
import { FitnessHistory } from "../components/FitnessHistory";
import { FitnessLifts } from "../components/FitnessLifts";
import { FitnessWeek } from "../components/FitnessWeek";
import { FitnessWeight } from "../components/FitnessWeight";
import { DEFAULT_PROTEIN_GOAL, weekSummary } from "../fitnessStats";
import type { RouteId } from "../routes";

function Dashboard({ fitness, today }: { fitness: Fitness; today: string }) {
  const summary = weekSummary(fitness.days, fitness.plan, today, fitness.workouts);
  return (
    <div className="fitness">
      <FitnessWeek summary={summary} />
      <FitnessWeight days={fitness.days} plan={fitness.plan} today={today} />
      <FitnessActivity
        days={fitness.days}
        proteinGoal={fitness.plan?.proteinGoal ?? DEFAULT_PROTEIN_GOAL}
        today={today}
      />
      <FitnessHistory workouts={fitness.workouts} />
      <FitnessLifts lifts={fitness.lifts} />
      {fitness.parseErrors > 0 && (
        <p className="notice" role="status">
          {fitness.parseErrors} daily or fitness note{fitness.parseErrors === 1 ? "" : "s"} could
          not be read. Check their fields.
        </p>
      )}
    </div>
  );
}

export function FitnessPage({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const [response, setResponse] = useState<FitnessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = localDate();

  const load = useCallback(() => {
    getFitness(date)
      .then((r) => {
        setResponse(r);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not load fitness.");
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
        <p className="kicker">Training</p>
        <h1 className="page-title">Fitness</h1>
      </header>
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
      {response?.status === "noVault" && (
        <section className="card placeholder">
          <span className="pill pill--pending">Not connected</span>
          <p>Choose your Life OS vault folder to see your weight, workouts and lifts.</p>
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
      {response?.status === "ready" && <Dashboard fitness={response.fitness} today={date} />}
    </>
  );
}
