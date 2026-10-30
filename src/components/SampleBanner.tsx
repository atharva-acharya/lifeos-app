import { useState } from "react";
import { exitSampleMode, getSettings } from "../api";
import { setMode } from "../mode";

/** Shown on every page while sample data is on. */
export function SampleBanner({ onLeft }: { onLeft: (vaultPath: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => {
    setBusy(true);
    setError(null);
    exitSampleMode()
      .then((m) => getSettings().then((s) => ({ m, s })))
      .then(({ m, s }) => {
        // Both updates land together, so there is no flash of the wrong screen.
        onLeft(s.vaultPath);
        setMode(m);
      })
      .catch((err: unknown) => {
        setError(typeof err === "string" ? err : "Could not leave sample data.");
        setBusy(false);
      });
  };

  return (
    <aside className="sample-banner card" aria-label="Sample data">
      <span className="pill pill--read">Sample</span>
      <p>You're looking at sample data. None of it is yours.</p>
      {error && (
        <span className="setting__error" role="alert">
          {error}
        </span>
      )}
      <button type="button" className="button" disabled={busy} onClick={leave}>
        Leave sample data
      </button>
    </aside>
  );
}
