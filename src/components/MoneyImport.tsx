import { useEffect, useState, type RefObject } from "react";
import {
  getBanks,
  importCsv,
  previewImport,
  type ImportMapping,
  type ImportPreview,
  type ImportRow,
} from "../api";
import { pounds } from "../money";
import { FlowPane, FlowSteps, Tick } from "./Flow";
import { Sheet } from "./Sheet";

/** Largest statement the app reads (the Rust core enforces the same cap). */
const MAX_BYTES = 2 * 1024 * 1024;
/** Rows shown in the preview; the counts cover every row. */
const SHOWN = 50;

const STEPS = ["Statement", "Check", "Done"];

const STATUS: Record<ImportRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "done" },
  duplicate: { label: "Already in Life OS", tone: "progress" },
  error: { label: "Skipped", tone: "danger" },
};

function errorText(err: unknown, fallback: string): string {
  return typeof err === "string" ? err : fallback;
}

function ColumnSelect({
  label,
  value,
  headers,
  optional,
  onChange,
}: {
  label: string;
  value: string | null;
  headers: string[];
  optional?: boolean;
  onChange: (v: string | null) => void;
}) {
  return (
    <label className="flow-select">
      <span className="flow__label">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          onChange(e.target.value === "" ? null : e.target.value);
        }}
      >
        <option value="">{optional ? "None" : "Choose…"}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Bank statement import as a flow: name the bank and drop the CSV onto the
 * card, check the rows found (rows already in Life OS are flagged and left
 * out), then confirm. Columns are guessed or remembered per bank; they can
 * be changed under "Columns" when a bank is new.
 */
export function MoneyImport({
  open,
  onClose,
  trigger,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  onImported: () => void;
}) {
  const [step, setStep] = useState(0);
  const [back, setBack] = useState(false);
  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getBanks()
      .then(setBanks)
      .catch(() => undefined);
  }, []);

  const go = (to: number) => {
    setBack(to < step);
    setStep(to);
  };

  const close = () => {
    onClose();
    // Start again next time, but keep the bank: it is usually the same one.
    setStep(0);
    setFile(null);
    setPreview(null);
    setError(null);
    setDone(null);
  };

  const runPreview = (text: string, mapping: ImportMapping | null) => {
    setBusy(true);
    setError(null);
    previewImport(text, bank, mapping, account.trim() || null)
      .then((p) => {
        setPreview(p);
        go(1);
      })
      .catch((err: unknown) => {
        setPreview(null);
        setError(errorText(err, "Could not read the file."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const read = (chosen: File | undefined) => {
    if (!chosen) return;
    if (bank.trim() === "") {
      setError("Name the bank first, so its columns can be remembered.");
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setError("The file is larger than 2 MB.");
      return;
    }
    chosen
      .text()
      .then((text) => {
        setFile({ name: chosen.name, text });
        runPreview(text, null);
      })
      .catch(() => {
        setError("Could not read the file.");
      });
  };

  const change = (patch: Partial<ImportMapping>) => {
    if (!file || !preview) return;
    setBusy(true);
    previewImport(file.text, bank, { ...preview.mapping, ...patch }, account.trim() || null)
      .then(setPreview)
      .catch((err: unknown) => {
        setError(errorText(err, "Could not read the file."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const run = () => {
    if (!file || !preview) return;
    setBusy(true);
    setError(null);
    importCsv(file.text, bank, preview.mapping, account.trim() || null)
      .then((r) => {
        setDone(
          `Imported ${String(r.imported)} transaction${r.imported === 1 ? "" : "s"}. Skipped ${String(r.duplicates)} already in Life OS and ${String(r.errors)} unreadable.`,
        );
        if (!banks.includes(bank)) setBanks([...banks, bank]);
        go(2);
        onImported();
      })
      .catch((err: unknown) => {
        setError(errorText(err, "Could not import."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const m = preview?.mapping;
  return (
    <Sheet open={open} onClose={close} title="Import a bank statement" trigger={trigger}>
      <div className="flow">
        <FlowSteps steps={STEPS} current={step} />

        {step === 0 && (
          <FlowPane back={back} label="Statement">
            <div className="flow__pane">
              <p className="flow__label" id="import-bank">
                Bank
              </p>
              {banks.length > 0 && (
                <div className="chips" role="radiogroup" aria-labelledby="import-bank">
                  {banks.map((b) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      className="chip"
                      aria-checked={bank === b}
                      onClick={() => {
                        setBank(b);
                      }}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              )}
              <div className="flow-field">
                <input
                  aria-label="Bank"
                  placeholder={banks.length > 0 ? "Or type a new bank" : "Your bank's name"}
                  maxLength={60}
                  value={bank}
                  onChange={(e) => {
                    setBank(e.target.value);
                  }}
                />
                <input
                  aria-label="Account (optional)"
                  placeholder="Account (optional)"
                  maxLength={60}
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                  }}
                />
              </div>
            </div>
            <label
              className="drop-zone"
              data-over={over ? "" : undefined}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => {
                setOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                read(e.dataTransfer.files[0]);
              }}
            >
              <span className="drop-zone__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
                </svg>
              </span>
              <span className="drop-zone__title">
                {busy ? "Reading the statement…" : "Drop your bank statement here"}
              </span>
              <span className="drop-zone__hint">
                A CSV from your bank&apos;s website or app, or click to choose one. Rows already in
                Life OS are found and left out.
              </span>
              <input
                type="file"
                className="sr-only"
                aria-label="CSV file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  read(e.currentTarget.files?.[0]);
                }}
              />
            </label>
          </FlowPane>
        )}

        {step === 1 && preview && m && (
          <FlowPane back={back} label="Check">
            <ul className="chips" aria-label="Rows found" aria-live="polite">
              <li className="pill">{file?.name}</li>
              <li className="pill pill--done">{preview.new} new</li>
              <li className="pill pill--progress">{preview.duplicates} already in Life OS</li>
              {preview.errors > 0 && (
                <li className="pill pill--danger">{preview.errors} skipped</li>
              )}
            </ul>
            <ul className="preview-rows" aria-label={`Preview of ${file?.name ?? "the file"}`}>
              {preview.rows.slice(0, SHOWN).map((r) => (
                <li
                  key={r.line}
                  className={`preview-row${r.status === "new" ? "" : " preview-row--skip"}`}
                >
                  <span className="preview-row__date">{r.date ?? "—"}</span>
                  <span className="preview-row__text">{r.description || "—"}</span>
                  <span className={`pill pill--${STATUS[r.status].tone}`}>
                    {r.error ?? STATUS[r.status].label}
                  </span>
                  <span className="preview-row__amount">
                    {r.amount === null ? "—" : pounds(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
            {preview.rows.length > SHOWN && (
              <p className="flow__reason">
                Showing the first {SHOWN} of {preview.rows.length} rows.
              </p>
            )}
            <details className="flow-columns" open={!preview.saved}>
              <summary>
                {preview.saved ? "Columns remembered for this bank" : "Check the columns"}
              </summary>
              <div className="flow-columns__grid">
                <ColumnSelect
                  label="Date"
                  value={m.date}
                  headers={preview.headers}
                  onChange={(v) => {
                    change({ date: v ?? "" });
                  }}
                />
                <label className="flow-select">
                  <span className="flow__label">Date format</span>
                  <select
                    value={m.dateFormat}
                    onChange={(e) => {
                      change({ dateFormat: e.target.value as ImportMapping["dateFormat"] });
                    }}
                  >
                    <option value="dmy">31/10/2026</option>
                    <option value="ymd">2026-10-31</option>
                    <option value="mdy">10/31/2026</option>
                  </select>
                </label>
                <ColumnSelect
                  label="Description"
                  value={m.description}
                  headers={preview.headers}
                  onChange={(v) => {
                    change({ description: v ?? "" });
                  }}
                />
                <ColumnSelect
                  label="Amount (signed)"
                  value={m.amount}
                  headers={preview.headers}
                  optional
                  onChange={(v) => {
                    change({ amount: v });
                  }}
                />
                <ColumnSelect
                  label="Money out"
                  value={m.moneyOut}
                  headers={preview.headers}
                  optional
                  onChange={(v) => {
                    change({ moneyOut: v });
                  }}
                />
                <ColumnSelect
                  label="Money in"
                  value={m.moneyIn}
                  headers={preview.headers}
                  optional
                  onChange={(v) => {
                    change({ moneyIn: v });
                  }}
                />
                <ColumnSelect
                  label="Category"
                  value={m.category}
                  headers={preview.headers}
                  optional
                  onChange={(v) => {
                    change({ category: v });
                  }}
                />
                <label className="setting__check">
                  <input
                    type="checkbox"
                    checked={m.flipSign}
                    onChange={(e) => {
                      change({ flipSign: e.target.checked });
                    }}
                  />
                  Spending is shown as positive
                </label>
              </div>
            </details>
            <div className="flow__actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                  go(0);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || preview.new === 0}
                onClick={run}
              >
                {preview.new === 0
                  ? "Nothing new to import"
                  : `Import ${String(preview.new)} transaction${preview.new === 1 ? "" : "s"}`}
              </button>
            </div>
          </FlowPane>
        )}

        {step === 2 && (
          <FlowPane back={back} label="Done">
            <div className="flow-done" role="status">
              <span className="flow-done__mark" aria-hidden="true">
                <Tick />
              </span>
              <p className="flow__label">{done}</p>
            </div>
            <div className="flow__actions">
              <button type="button" className="button button--primary" onClick={close}>
                Done
              </button>
            </div>
          </FlowPane>
        )}

        {error && (
          <p className="setting__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
