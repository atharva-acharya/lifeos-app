import { useEffect, useState } from "react";
import {
  getSetup,
  skipSetupItem,
  unskipSetupItem,
  type Setup,
  type SetupItem,
  type SetupItemId,
} from "../api";
import { CHECKLIST_GUIDES, type GuideId } from "../guides";
import { GuidePanel } from "./GuidePanel";

/** "3 of 5 set up", plus "· 1 skipped" when any. */
export function progressText(setup: Pick<Setup, "setUp" | "total" | "skipped">): string {
  const base = `${String(setup.setUp)} of ${String(setup.total)} set up`;
  return setup.skipped > 0 ? `${base} · ${String(setup.skipped)} skipped` : base;
}

export function SetupProgress({ setup }: { setup: Setup }) {
  const handled = setup.setUp + setup.skipped;
  const pct = setup.total > 0 ? Math.round((handled / setup.total) * 100) : 0;
  return (
    <>
      <p className="muted">{progressText(setup)}</p>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={setup.total}
        aria-valuenow={handled}
        aria-label="Setup progress"
      >
        <span style={{ width: `${String(pct)}%` }} />
      </div>
    </>
  );
}

function guideOf(id: SetupItemId): GuideId | null {
  return CHECKLIST_GUIDES.find((g) => g === id) ?? null;
}

function pillOf(item: SetupItem): { cls: string; text: string } {
  if (item.done) return { cls: "pill--done", text: "Done" };
  if (item.skipped) return { cls: "pill--read", text: "Skipped" };
  return { cls: "pill--pending", text: "To do" };
}

function Row({
  item,
  disabled,
  open,
  onToggleGuide,
  onSkip,
  onUndo,
  onChooseVault,
}: {
  item: SetupItem;
  disabled: boolean;
  open: boolean;
  onToggleGuide: () => void;
  onSkip: () => void;
  onUndo: () => void;
  onChooseVault?: () => void;
}) {
  const guide = guideOf(item.id);
  const pill = pillOf(item);
  return (
    <li className="setup__item">
      <div className="setup__line">
        <span className={`pill ${pill.cls}`}>{pill.text}</span>
        <span className="setup__title">{item.title}</span>
        {item.detail && !item.done && <span className="muted">{item.detail}</span>}
        <span className="setup__actions">
          {!item.done && item.id === "vault" && onChooseVault && (
            <button type="button" className="button" disabled={disabled} onClick={onChooseVault}>
              Choose folder
            </button>
          )}
          {!item.done && item.id === "sheet" && (
            <a className="button button--quiet" href="#google-heading">
              Settings › Google
            </a>
          )}
          {!item.done && item.id === "health" && (
            <a className="button button--quiet" href="#health-heading">
              Settings › Health
            </a>
          )}
          {!item.done && guide && (
            <button
              type="button"
              className="button button--quiet"
              aria-expanded={open}
              onClick={onToggleGuide}
            >
              Guide
            </button>
          )}
          {!item.done && !item.required && !item.skipped && (
            <button
              type="button"
              className="button button--quiet"
              disabled={disabled}
              onClick={onSkip}
            >
              Skip
            </button>
          )}
          {item.skipped && (
            <button
              type="button"
              className="button button--quiet"
              disabled={disabled}
              onClick={onUndo}
            >
              Undo
            </button>
          )}
        </span>
      </div>
      {guide && open && <GuidePanel id={guide} />}
    </li>
  );
}

/** The full setup checklist, at the top of Settings. */
export function SetupChecklist({
  disabled = false,
  openGuide = null,
  onChooseVault,
  refreshKey,
}: {
  disabled?: boolean;
  /** A guide to show open at first, for example when arriving from an empty page. */
  openGuide?: GuideId | null;
  onChooseVault?: () => void;
  /** Changes when something the checklist depends on changed (for example the vault). */
  refreshKey?: string | null;
}) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<GuideId | null>(openGuide);

  useEffect(() => {
    let active = true;
    getSetup()
      .then((s) => {
        if (active) setSetup(s);
      })
      .catch((err: unknown) => {
        if (active) setError(typeof err === "string" ? err : "Could not load the checklist.");
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const change = (action: Promise<Setup>) => {
    setError(null);
    action.then(setSetup).catch((err: unknown) => {
      setError(typeof err === "string" ? err : "Something went wrong. Please try again.");
    });
  };

  return (
    <section className="card setup" aria-labelledby="setup-heading">
      <h2 id="setup-heading" className="setting__title">
        Setup
      </h2>
      {setup && <SetupProgress setup={setup} />}
      {error && (
        <p className="setting__error" role="alert">
          {error}
        </p>
      )}
      {setup && (
        <ul className="setup__list">
          {setup.items.map((item) => {
            const guide = guideOf(item.id);
            return (
              <Row
                key={item.id}
                item={item}
                disabled={disabled}
                open={guide !== null && open === guide}
                onToggleGuide={() => {
                  setOpen(open === guide ? null : guide);
                }}
                onSkip={() => {
                  change(skipSetupItem(item.id));
                }}
                onUndo={() => {
                  change(unskipSetupItem(item.id));
                }}
                onChooseVault={onChooseVault}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
