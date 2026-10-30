import { useState } from "react";
import { chooseVaultFolder, enterSampleMode, type AppSettings } from "../api";
import { setMode, trackSwitch, useSwitching } from "../mode";

function message(err: unknown, fallback: string): string {
  return typeof err === "string" ? err : fallback;
}

/** First run: no sidebar, one required step, and a way to look around first. */
export function WelcomePage({
  onChosen,
  onSkip,
}: {
  onChosen: (settings: AppSettings) => void;
  onSkip: () => void;
}) {
  const switching = useSwitching();
  const [busy, setBusy] = useState<"choosing" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = () => {
    setBusy("choosing");
    setError(null);
    trackSwitch(chooseVaultFolder())
      .then((s) => {
        if (s.vaultPath) onChosen(s);
      })
      .catch((err: unknown) => {
        setError(message(err, "That folder could not be used. Please try another."));
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const sample = () => {
    setBusy("sample");
    setError(null);
    trackSwitch(enterSampleMode())
      .then(setMode)
      .catch((err: unknown) => {
        setError(message(err, "Sample data could not be opened."));
        setBusy(null);
      });
  };

  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__card card">
        <span className="brand__mark" aria-hidden="true" />
        <h1 id="welcome-title" className="page-title">
          Welcome to Life OS
        </h1>
        <p>
          Your job search, training and projects in one place, built from the notes in your Obsidian
          vault.
        </p>
        <p className="muted">
          Reads your Obsidian vault on this PC. Nothing leaves it except the read-only Google Sheet
          and update check.
        </p>
        {error && (
          <p className="setting__error" role="alert">
            {error}
          </p>
        )}
        <div className="welcome__actions">
          <button
            type="button"
            className="button"
            disabled={busy !== null || switching}
            onClick={choose}
          >
            {busy === "choosing" ? "Choosing…" : "Choose vault folder"}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={busy !== null || switching}
            onClick={sample}
          >
            Try with sample data
          </button>
        </div>
        <button
          type="button"
          className="welcome__skip"
          disabled={busy !== null || switching}
          onClick={onSkip}
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}
