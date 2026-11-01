import { useCallback, useEffect, useState } from "react";
import { chooseVaultFolder, getSettings, type AppSettings } from "../api";
import { AppearanceSettings } from "../components/AppearanceSettings";
import { DiagnosticsSettings } from "../components/DiagnosticsSettings";
import { ErrorState, loadError, type LoadError } from "../components/ErrorState";
import { GoogleSettings } from "../components/GoogleSettings";
import { HealthSettings } from "../components/HealthSettings";
import { SetupChecklist } from "../components/SetupChecklist";
import { Skeleton, type SkeletonGroup } from "../components/Skeleton";
import { UpdateSettings } from "../components/UpdateSettings";
import type { GuideId } from "../guides";
import { trackSwitch, useMode } from "../mode";

type Status = "loading" | "ready" | "choosing";

/** The vault, Health export, Google and updates cards; none has a group title. */
const SKELETON: SkeletonGroup[][] = [
  [{ height: 120, title: false }],
  [{ height: 120, title: false }],
  [{ height: 220, title: false }],
  [{ height: 88, title: false }],
];

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

export function SettingsPage({ openGuide = null }: { openGuide?: GuideId | null }) {
  const sample = useMode() === "sample";
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSettings()
      .then((s) => {
        if (!active) return;
        setSettings(s);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (active) setFailed(loadError(err));
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setFailed(null);
    setAttempt((n) => n + 1);
  }, []);

  const choose = () => {
    setStatus("choosing");
    setError(null);
    trackSwitch(chooseVaultFolder())
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

      {sample ? (
        <p className="notice" role="status">
          Leave sample data to change settings.
        </p>
      ) : (
        <SetupChecklist
          openGuide={openGuide}
          onChooseVault={choose}
          refreshKey={settings?.vaultPath ?? null}
        />
      )}

      {failed && (
        <ErrorState title="Could not load settings." detail={failed.detail} onRetry={retry} />
      )}
      {status === "loading" && failed === null && (
        <div className="settings-skeleton">
          <Skeleton label="settings" layout={SKELETON} />
        </div>
      )}
      {status !== "loading" && (
        <fieldset className="settings-group" disabled={sample}>
          <section className="card setting" aria-labelledby="vault-heading">
            <div className="setting__text">
              <h2 id="vault-heading" className="setting__title">
                Vault folder
              </h2>
              <p className="setting__help">
                The Life OS folder with your notes. The app only reads and writes inside it.
              </p>
              {vault ? (
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

          {settings && (
            <HealthSettings healthPath={settings.healthPath ?? null} onChange={setSettings} />
          )}

          {settings && <GoogleSettings google={settings.google} onChange={setSettings} />}

          {settings && <UpdateSettings autoUpdate={settings.autoUpdate} onChange={setSettings} />}
        </fieldset>
      )}

      <AppearanceSettings />

      <DiagnosticsSettings />
    </>
  );
}
