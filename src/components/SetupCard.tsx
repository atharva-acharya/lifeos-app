import { useEffect, useState } from "react";
import { dismissSetup, getSetup, type Setup } from "../api";
import { useMode } from "../mode";
import type { Navigate } from "../routes";
import { SetupProgress } from "./SetupChecklist";

/** Compact checklist on Today, until everything is done or skipped, or it is dismissed. */
export function SetupCard({ onNavigate }: { onNavigate: Navigate }) {
  const mode = useMode();
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    let active = true;
    getSetup()
      .then((s) => {
        if (active) setSetup(s);
      })
      // The full checklist in Settings reports problems; this card stays quiet.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!setup || mode === "sample" || setup.dismissed || setup.complete) return null;
  const todo = setup.items.filter((i) => !i.done && !i.skipped);

  return (
    <section className="card setup-card" aria-labelledby="setup-card-heading">
      <div className="section-head">
        <h2 id="setup-card-heading" className="card__title">
          Finish setting up
        </h2>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            dismissSetup()
              .then(setSetup)
              .catch(() => undefined);
          }}
        >
          Dismiss
        </button>
      </div>
      <SetupProgress setup={setup} />
      <p className="muted">Still to do: {todo.map((i) => i.title).join(", ")}.</p>
      <button
        type="button"
        className="button"
        onClick={() => {
          onNavigate("settings", "setup");
        }}
      >
        Open setup
      </button>
    </section>
  );
}
