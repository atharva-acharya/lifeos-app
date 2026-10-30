import { useEffect, useState } from "react";
import { chooseVaultFolder, getSettings, type AppSettings } from "../api";
import { DiagnosticsSettings } from "../components/DiagnosticsSettings";
import { GoogleSettings } from "../components/GoogleSettings";

type Status = "loading" | "ready" | "choosing";

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => {
        if (active) setSettings(s);
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setStatus("ready");
      });
    return () => {
      active = false;
    };
  }, []);

  const choose = () => {
    setStatus("choosing");
    setError(null);
    chooseVaultFolder()
      .then(setSettings)
      .catch((err: unknown) => {
        setError(message(err));
      })
      .finally(() => {
        setStatus("ready");
      });
  };

  const vault = settings?.vaultPath ?? null;

  return (
    <>
      <header className="page-header">
        <p className="kicker">App</p>
        <h1 className="page-title">Settings</h1>
      </header>

      <section className="card setting" aria-labelledby="vault-heading">
        <div className="setting__text">
          <h2 id="vault-heading" className="setting__title">
            Vault folder
          </h2>
          <p className="setting__help">
            The Life OS folder with your notes. The app only reads and writes inside it.
          </p>
          {status === "loading" ? (
            <p className="setting__value">Loading…</p>
          ) : vault ? (
            <p className="setting__value">
              <span className="pill pill--done">Connected</span>
              <code className="path">{vault}</code>
            </p>
          ) : (
            <p className="setting__value">
              <span className="pill pill--pending">Not set</span>
              Choose your vault to see your dashboards.
            </p>
          )}
          {error && (
            <p className="setting__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="button" className="button" onClick={choose} disabled={status !== "ready"}>
          {status === "choosing" ? "Choosing…" : vault ? "Change folder" : "Choose folder"}
        </button>
      </section>

      {settings && <GoogleSettings google={settings.google} onChange={setSettings} />}

      <DiagnosticsSettings />
    </>
  );
}
