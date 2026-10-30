import { useState } from "react";
import { enterSampleMode } from "../api";
import type { GuideId } from "../guides";
import { setMode } from "../mode";
import type { Navigate } from "../routes";

/** The "Not connected" card: open settings, or look around with sample data. */
export function NotConnected({
  children,
  onNavigate,
  guide,
  pill = "Not connected",
}: {
  children: string;
  onNavigate: Navigate;
  guide?: GuideId;
  pill?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trySample = () => {
    setBusy(true);
    setError(null);
    enterSampleMode()
      .then(setMode)
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Sample data could not be opened.");
        setBusy(false);
      });
  };

  return (
    <section className="card placeholder">
      <span className="pill pill--pending">{pill}</span>
      <p>{children}</p>
      <div className="placeholder__actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            if (guide) onNavigate("settings", guide);
            else onNavigate("settings");
          }}
        >
          Open settings
        </button>
        <button type="button" className="button button--quiet" disabled={busy} onClick={trySample}>
          Try with sample data
        </button>
      </div>
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
