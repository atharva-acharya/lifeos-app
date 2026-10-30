import { useState } from "react";
import {
  checkForUpdate,
  installUpdate,
  setAutoUpdate,
  type AppSettings,
  type UpdateInfo,
} from "../api";

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest" }
  | { kind: "found"; update: UpdateInfo }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

/** Settings section: automatic update checks and a manual check. */
export function UpdateSettings({
  autoUpdate,
  onChange,
}: {
  autoUpdate: boolean;
  onChange: (s: AppSettings) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });

  const check = () => {
    setState({ kind: "checking" });
    checkForUpdate()
      .then((update) => {
        setState(update ? { kind: "found", update } : { kind: "latest" });
      })
      .catch((err: unknown) => {
        setState({ kind: "error", message: message(err) });
      });
  };

  const install = (version: string) => {
    setState({ kind: "installing" });
    installUpdate(version).catch((err: unknown) => {
      setState({ kind: "error", message: message(err) });
    });
  };

  const busy = state.kind === "checking" || state.kind === "installing";

  return (
    <section className="card setting" aria-labelledby="updates-heading">
      <div className="setting__text">
        <h2 id="updates-heading" className="setting__title">
          Updates
        </h2>
        <p className="setting__help">
          New versions come from GitHub and are installed only if their signature matches the one
          built into Life OS.
        </p>
        <label className="setting__check">
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => {
              setAutoUpdate(e.target.checked)
                .then(onChange)
                .catch((err: unknown) => {
                  setState({ kind: "error", message: message(err) });
                });
            }}
          />
          Check for updates when Life OS starts
        </label>
        <p className="setting__value" role="status">
          {state.kind === "checking" && "Checking…"}
          {state.kind === "latest" && (
            <>
              <span className="pill pill--done">Up to date</span>You have the latest version.
            </>
          )}
          {state.kind === "found" && (
            <>
              <span className="pill pill--progress">Update</span>Version {state.update.version} is
              available.
            </>
          )}
          {state.kind === "installing" && "Installing; Life OS will restart…"}
        </p>
        {state.kind === "error" && (
          <p className="setting__error" role="alert">
            {state.message}
          </p>
        )}
      </div>
      {state.kind === "found" ? (
        <button
          type="button"
          className="button"
          onClick={() => {
            install(state.update.version);
          }}
        >
          Install and restart
        </button>
      ) : (
        <button type="button" className="button" onClick={check} disabled={busy}>
          {state.kind === "checking" ? "Checking…" : "Check now"}
        </button>
      )}
    </section>
  );
}
