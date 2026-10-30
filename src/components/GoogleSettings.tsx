import { useState } from "react";
import {
  connectGoogle,
  disconnectGoogle,
  getSettings,
  saveGoogleConfig,
  type AppSettings,
  type GoogleView,
} from "../api";

type Busy = null | "saving" | "connecting" | "disconnecting";

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

/** Google Sheet connection: client details, then browser sign-in. */
export function GoogleSettings({
  google,
  onChange,
}: {
  google: GoogleView;
  onChange: (s: AppSettings) => void;
}) {
  const [clientId, setClientId] = useState(google.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [sheetId, setSheetId] = useState(google.sheetId);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (kind: Busy, action: () => Promise<AppSettings>) => {
    setBusy(kind);
    setError(null);
    action()
      .then((s) => {
        onChange(s);
        setClientSecret("");
      })
      .catch((err: unknown) => {
        setError(message(err));
        // A failed step can still change state (Disconnect removes the token
        // locally even when Google cannot be reached), so show what is true now.
        getSettings()
          .then(onChange)
          .catch(() => undefined);
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <section className="card setting setting--stacked" aria-labelledby="google-heading">
      <div className="setting__text">
        <h2 id="google-heading" className="setting__title">
          Google Sheet
        </h2>
        <p className="setting__help">
          Read-only access to your applications Sheet. You sign in with Google in your browser; the
          app never sees your password and cannot change the Sheet.
        </p>
        <p className="setting__value">
          {google.connected ? (
            <span className="pill pill--done">Connected</span>
          ) : google.configured ? (
            <span className="pill pill--pending">Ready to connect</span>
          ) : (
            <span className="pill pill--pending">Not set up</span>
          )}
        </p>
      </div>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          run("saving", () => saveGoogleConfig(clientId, clientSecret, sheetId));
        }}
      >
        <label>
          <span className="kicker">Client ID</span>
          <input
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          <span className="kicker">Client secret</span>
          <input
            type="password"
            value={clientSecret}
            placeholder={google.hasSecret ? "Saved (leave blank to keep)" : ""}
            onChange={(e) => {
              setClientSecret(e.target.value);
            }}
            autoComplete="off"
          />
        </label>
        <label>
          <span className="kicker">Sheet ID</span>
          <input
            value={sheetId}
            onChange={(e) => {
              setSheetId(e.target.value);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="form__actions">
          <button type="submit" className="button" disabled={busy !== null}>
            {busy === "saving" ? "Saving…" : "Save"}
          </button>
          {google.connected ? (
            <button
              type="button"
              className="button button--danger"
              disabled={busy !== null}
              onClick={() => {
                run("disconnecting", disconnectGoogle);
              }}
            >
              {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy !== null || !google.configured}
              onClick={() => {
                run("connecting", connectGoogle);
              }}
            >
              {busy === "connecting" ? "Waiting for browser…" : "Connect"}
            </button>
          )}
        </div>
        {error && (
          <p className="setting__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
