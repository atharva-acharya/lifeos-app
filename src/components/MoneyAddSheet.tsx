import { useState, type RefObject } from "react";
import { addTransaction, localDate } from "../api";
import { pounds, toPence } from "../money";
import { AmountEntry } from "./Flow";
import { Sheet } from "./Sheet";

/** Most categories shown as chips; the rest are typed. */
const CHIPS = 10;

function shiftDay(iso: string, by: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + by));
}

function errorText(err: unknown, fallback: string): string {
  return typeof err === "string" && err.trim() !== "" ? err : fallback;
}

export interface Added {
  amount: number;
  category: string | null;
  date: string;
}

/**
 * Quick add as a sheet: a big amount, then a tap on a category, then Add.
 * Description, date and account are there but never in the way.
 */
export function MoneyAddSheet({
  open,
  onClose,
  trigger,
  categories,
  disabledReason,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  categories: string[];
  /** Set when adding is off, e.g. while sample data is on. */
  disabledReason: string | null;
  onAdded: (added: Added) => void;
}) {
  const today = localDate();
  const [kind, setKind] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [date, setDate] = useState(today);
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pence = toPence(amount);
  const chosen = category ?? (typed.trim() || null);
  const reason =
    disabledReason ?? (pence === null || pence === 0 ? "Enter an amount like 12.50." : null);

  const reset = () => {
    setKind("out");
    setAmount("");
    setDescription("");
    setCategory(null);
    setTyped("");
    setDate(today);
    setAccount("");
    setError(null);
  };

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy || reason !== null || pence === null) return;
    setBusy(true);
    setError(null);
    addTransaction({
      date,
      description: description.trim() || chosen || (kind === "out" ? "Spending" : "Income"),
      category: chosen,
      amount: kind === "out" ? -pence : pence,
      account: account.trim() || null,
    })
      .then(() => {
        onAdded({ amount: kind === "out" ? -pence : pence, category: chosen, date });
        reset();
        onClose();
      })
      .catch((err: unknown) => {
        setError(errorText(err, "Could not save."));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const label =
    reason !== null ? reason : `Add ${pounds(pence ?? 0)}${chosen ? ` to ${chosen}` : ""}`;

  return (
    <Sheet open={open} onClose={onClose} title="Add a transaction" trigger={trigger}>
      <form className="flow" onSubmit={submit}>
        <div className="chips flow__kind" role="radiogroup" aria-label="Money out or in">
          {(["out", "in"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              className="chip"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
              }}
            >
              {k === "out" ? "Money out" : "Money in"}
            </button>
          ))}
        </div>
        <AmountEntry value={amount} onChange={setAmount} label="Amount in pounds" focusOnOpen />
        <div className="flow-field">
          <input
            placeholder="What was it? For example, weekly shop"
            aria-label="Description"
            maxLength={200}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </div>
        <div className="flow__pane">
          <p className="flow__label" id="add-category">
            Category
          </p>
          <ul className="chips" aria-labelledby="add-category">
            {categories.slice(0, CHIPS).map((c) => (
              <li key={c}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={category === c}
                  onClick={() => {
                    setCategory(category === c ? null : c);
                    setTyped("");
                  }}
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
          <div className="flow-field">
            <input
              list="money-categories"
              placeholder={categories.length > 0 ? "Or type another" : "Type a category"}
              aria-label="Another category"
              maxLength={60}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setCategory(null);
              }}
            />
            <datalist id="money-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="flow__pane">
          <p className="flow__label" id="add-when">
            When
          </p>
          <div className="chips" role="group" aria-labelledby="add-when">
            <button
              type="button"
              className="chip"
              aria-pressed={date === today}
              onClick={() => {
                setDate(today);
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={date === shiftDay(today, -1)}
              onClick={() => {
                setDate(shiftDay(today, -1));
              }}
            >
              Yesterday
            </button>
            <input
              type="date"
              className="chip"
              aria-label="Date"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
            <input
              className="chip"
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
        <div className="flow__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || reason !== null}
          >
            {busy ? "Saving…" : label}
          </button>
        </div>
        {error && (
          <p className="setting__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}
