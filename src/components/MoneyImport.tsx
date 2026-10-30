import { useEffect, useState } from "react";
import {
  getBanks,
  importCsv,
  previewImport,
  type ImportMapping,
  type ImportPreview,
  type ImportRow,
} from "../api";
import { pounds } from "../money";

/** Largest statement the app reads (the Rust core enforces the same cap). */
const MAX_BYTES = 2 * 1024 * 1024;
/** Rows shown in the preview table; the counts cover every row. */
const SHOWN = 50;

const STATUS: Record<ImportRow["status"], { label: string; tone: string }> = {
  new: { label: "New", tone: "done" },
  duplicate: { label: "Already in ledger", tone: "read" },
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
    <label>
      <span className="kicker">{label}</span>
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

/** Bank statement import: pick a CSV, check the columns and preview, then import. */
export function MoneyImport({ onImported }: { onImported: () => void }) {
  const [banks, setBanks] = useState<string[]>([]);
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    getBanks()
      .then(setBanks)
      .catch(() => undefined);
  }, []);

  const runPreview = (text: string, mapping: ImportMapping | null) => {
    if (bank.trim() === "") {
      setMessage({ error: true, text: "Name the bank first, so its columns can be remembered." });
      return;
    }
    setBusy(true);
    setMessage(null);
    previewImport(text, bank, mapping, account.trim() || null)
      .then(setPreview)
      .catch((err: unknown) => {
        setPreview(null);
        setMessage({ error: true, text: errorText(err, "Could not read the file.") });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const pick = (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      setMessage({ error: true, text: "The file is larger than 2 MB." });
      return;
    }
    chosen
      .text()
      .then((text) => {
        setFile({ name: chosen.name, text });
        runPreview(text, null);
      })
      .catch(() => {
        setMessage({ error: true, text: "Could not read the file." });
      });
  };

  const change = (patch: Partial<ImportMapping>) => {
    if (!file || !preview) return;
    runPreview(file.text, { ...preview.mapping, ...patch });
  };

  const run = () => {
    if (!file || !preview) return;
    setBusy(true);
    importCsv(file.text, bank, preview.mapping, account.trim() || null)
      .then((r) => {
        setMessage({
          error: false,
          text: `Imported ${String(r.imported)} row${r.imported === 1 ? "" : "s"}; skipped ${String(r.duplicates)} already in the ledger and ${String(r.errors)} unreadable.`,
        });
        setPreview(null);
        setFile(null);
        if (!banks.includes(bank)) setBanks([...banks, bank]);
        onImported();
      })
      .catch((err: unknown) => {
        setMessage({ error: true, text: errorText(err, "Could not import.") });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const m = preview?.mapping;
  return (
    <section className="card" aria-labelledby="import-heading">
      <h2 id="import-heading" className="kicker">
        Import bank statement
      </h2>
      <p className="muted">
        Export a CSV from your bank. Rows already in your ledger are skipped, so importing the same
        statement twice is safe.
      </p>
      <div className="form money__import">
        <label>
          <span className="kicker">Bank</span>
          <input
            list="money-banks"
            maxLength={60}
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
            }}
          />
          <datalist id="money-banks">
            {banks.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="kicker">Account (optional)</span>
          <input
            maxLength={60}
            placeholder="Defaults to the bank"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
            }}
            onBlur={() => {
              // Duplicates are matched within the account, so check again.
              if (file && preview) runPreview(file.text, preview.mapping);
            }}
          />
        </label>
        <label>
          <span className="kicker">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              pick(e.currentTarget);
            }}
          />
        </label>
      </div>

      {preview && m && (
        <>
          <p className="muted">
            {file?.name}:{" "}
            {preview.saved ? "using the columns saved for this bank." : "check the columns below."}
          </p>
          <div className="form money__mapping">
            <ColumnSelect
              label="Date"
              value={m.date}
              headers={preview.headers}
              onChange={(v) => {
                change({ date: v ?? "" });
              }}
            />
            <label>
              <span className="kicker">Date format</span>
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

          <ul className="counts" aria-label="Import summary" aria-live="polite">
            <li>
              <strong>{preview.new}</strong> new
            </li>
            <li>
              <strong>{preview.duplicates}</strong> already in ledger
            </li>
            <li>
              <strong>{preview.errors}</strong> skipped
            </li>
          </ul>

          <table className="table">
            <caption className="sr-only">Preview of {file?.name}</caption>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="table__num">
                  Amount
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, SHOWN).map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.date ?? "—"}</td>
                  <td>{r.description || "—"}</td>
                  <td className="table__num">{r.amount === null ? "—" : pounds(r.amount)}</td>
                  <td>
                    <span className={`pill pill--${STATUS[r.status].tone}`}>
                      {r.error ?? STATUS[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.rows.length > SHOWN && (
            <p className="muted">
              Showing the first {SHOWN} of {preview.rows.length} rows.
            </p>
          )}
          <div className="form__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy || preview.new === 0}
              onClick={run}
            >
              Import {preview.new} new row{preview.new === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}

      {message && (
        <p
          className={message.error ? "setting__error" : "muted"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
