import { useState } from "react";
import { enterSampleMode } from "../api";
import { setMode, trackSwitch, useSwitching } from "../mode";
import type { Navigate, SettingsTarget } from "../routes";

/** The "Not connected" card: open settings, or look around with sample data. */
export function NotConnected({
  children,
  onNavigate,
  guide,
  pill = "Not connected",
}: {
  children: string;
  onNavigate: Navigate;
  guide?: SettingsTarget;
  pill?: string;
}) {
  const switching = useSwitching();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trySample = () => {
    setBusy(true);
    setError(null);
    trackSwitch(enterSampleMode())
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
            // Without a guide, the section with the vault and Health folders.
            onNavigate("settings", guide ?? "data");
          }}
        >
          Open settings
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy || switching}
          onClick={trySample}
        >
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
