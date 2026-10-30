import { useEffect, useState } from "react";
import { checkForUpdate, getSettings, installUpdate, type UpdateInfo } from "../api";

/** Start-up check (if switched on in Settings); a quiet banner when a newer version exists. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => (s.autoUpdate ? checkForUpdate() : null))
      .then((found) => {
        if (active) setUpdate(found);
      })
      // Offline or GitHub unreachable at start-up: stay quiet; Settings can retry.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!update || hidden) return null;

  return (
    <aside className="update-banner card" aria-label="Update available">
      <span className="pill pill--progress">Update</span>
      <p>
        Life OS {update.version} is available.
        {error && (
          <span className="setting__error" role="alert">
            {" "}
            {error}
          </span>
        )}
      </p>
      {!error && (
        <button
          type="button"
          className="button"
          disabled={installing}
          onClick={() => {
            setInstalling(true);
            setError(null);
            installUpdate().catch((err: unknown) => {
              setInstalling(false);
              setError(typeof err === "string" ? err : "The update could not be installed.");
            });
          }}
        >
          {installing ? "Installing…" : "Install and restart"}
        </button>
      )}
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          setHidden(true);
        }}
      >
        {error ? "Dismiss" : "Later"}
      </button>
    </aside>
  );
}
