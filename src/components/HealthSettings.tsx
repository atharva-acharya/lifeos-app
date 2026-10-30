import { useState } from "react";
import { chooseHealthFolder, clearHealthFolder, type AppSettings } from "../api";

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

/** Settings section: the folder Health Auto Export writes to. */
export function HealthSettings({
  healthPath,
  onChange,
}: {
  healthPath: string | null;
  onChange: (s: AppSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<AppSettings>) => {
    setBusy(true);
    setError(null);
    action()
      .then(onChange)
      .catch((err: unknown) => {
        setError(message(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="card setting" aria-labelledby="health-heading">
      <div className="setting__text">
        <h2 id="health-heading" className="setting__title">
          Health export
        </h2>
        <p className="setting__help">
          The folder Health Auto Export saves its JSON files to. The app only reads it and nothing
          from it leaves this PC.
        </p>
        {healthPath ? (
          <p className="setting__value">
            <span className="pill pill--done">Reading</span>
            <code className="path">{healthPath}</code>
          </p>
        ) : (
          <p className="setting__value">
            <span className="pill pill--pending">Not chosen</span>
            Choose the folder to see your Health page.
          </p>
        )}
        {error && (
          <p className="setting__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="setting__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            run(chooseHealthFolder);
          }}
        >
          {healthPath ? "Change Health folder" : "Choose Health folder"}
        </button>
        {healthPath && (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => {
              run(clearHealthFolder);
            }}
          >
            Remove
          </button>
        )}
      </div>
    </section>
  );
}
