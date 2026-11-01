import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import type { SettingsSection, SettingsTarget } from "../routes";
import "../styles/settings.css";

type Status = "loading" | "ready" | "choosing";

const SECTIONS: { id: SettingsSection; label: string; hint: string }[] = [
  { id: "setup", label: "Setup", hint: "What is set up, with guides" },
  { id: "data", label: "Vault and Health", hint: "Your notes and Apple Health folders" },
  { id: "google", label: "Google Sheets", hint: "The job applications sheet" },
  { id: "updates", label: "Updates", hint: "Automatic updates" },
  { id: "appearance", label: "Appearance", hint: "Transparency" },
  { id: "diagnostics", label: "Diagnostics", hint: "The error log" },
];

const SKELETON: SkeletonGroup[][] = [
  [{ height: 120, title: false }],
  [{ height: 120, title: false }],
];

function message(err: unknown): string {
  return typeof err === "string" ? err : "Something went wrong. Please try again.";
}

function isSection(to: SettingsTarget | null): to is SettingsSection {
  return SECTIONS.some((s) => s.id === to);
}

/**
 * Settings fits the window: a list of sections on the left and one section
 * at a time on the right. A link from another page opens the section it is
 * about (Health opens Vault and Health), or Setup with a guide open.
 */
export function SettingsPage({ open = null }: { open?: SettingsTarget | null }) {
  const sample = useMode() === "sample";
  const [section, setSection] = useState<SettingsSection>(isSection(open) ? open : "setup");
  const guide: GuideId | null = open !== null && !isSection(open) ? open : null;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<LoadError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A new link into Settings while it is open moves to its section.
  const [linked, setLinked] = useState(open);
  if (open !== linked) {
    setLinked(open);
    if (open !== null) setSection(isSection(open) ? open : "setup");
  }

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
  const loading = status === "loading" && failed === null;

  /** A section that needs the saved settings: the skeleton or error until they load. */
  const withSettings = (body: (s: AppSettings) => ReactNode) => (
    <>
      {failed && (
        <ErrorState title="Could not load settings." detail={failed.detail} onRetry={retry} />
      )}
      {loading && <Skeleton label="settings" layout={SKELETON} />}
      {settings && (
        <fieldset className="settings-group" disabled={sample}>
          {body(settings)}
        </fieldset>
      )}
    </>
  );

  return (
    <div className="page page--fit settings">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
      </header>

      {sample && (
        <p className="notice" role="status">
          Leave sample data to change settings.
        </p>
      )}

      <div className="settings__layout">
        <nav className="settings__nav" aria-label="Settings sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="settings__tab"
                  aria-current={section === s.id ? "true" : undefined}
                  onClick={() => {
                    setSection(s.id);
                  }}
                >
                  <span className="settings__tab-label">{s.label}</span>
                  <span className="settings__tab-hint">{s.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section
          className="settings__panel"
          aria-label={`${SECTIONS.find((s) => s.id === section)?.label ?? ""} settings`}
          // The panel scrolls on its own when a section is long (an open guide).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable by keyboard
          tabIndex={0}
        >
          {section === "setup" &&
            (sample ? (
              <p className="muted">Setup is hidden while sample data is on.</p>
            ) : (
              <SetupChecklist
                openGuide={guide}
                onChooseVault={choose}
                onOpenSection={setSection}
                refreshKey={settings?.vaultPath ?? null}
              />
            ))}

          {section === "data" &&
            withSettings((s) => (
              <>
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
                  <button
                    type="button"
                    className="button"
                    onClick={choose}
                    disabled={status !== "ready"}
                  >
                    {status === "choosing"
                      ? "Choosing…"
                      : vault
                        ? "Change folder"
                        : "Choose folder"}
                  </button>
                </section>
                <HealthSettings healthPath={s.healthPath ?? null} onChange={setSettings} />
              </>
            ))}

          {section === "google" &&
            withSettings((s) => <GoogleSettings google={s.google} onChange={setSettings} />)}

          {section === "updates" &&
            withSettings((s) => (
              <UpdateSettings autoUpdate={s.autoUpdate} onChange={setSettings} />
            ))}

          {section === "appearance" && <AppearanceSettings />}

          {section === "diagnostics" && <DiagnosticsSettings />}
        </section>
      </div>
    </div>
  );
}
