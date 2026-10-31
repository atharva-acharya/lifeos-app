import { useRef, useState } from "react";
import {
  addSplit,
  localDate,
  settleUp,
  type FriendBalance,
  type NewSplit,
  type SplitRow,
} from "../api";
import { pounds, toPence } from "../money";
import { checkSplit, summarise, type SplitMethod } from "../splitMath";
import "../styles/money-splits.css";
import { Group } from "./Card";
import { BALANCES_ID, SPLIT_FIELD_ID } from "./MoneyQuickActions";
import { Toast, type ToastMessage } from "./Toast";

/** "Sam owes you £12.00", "You owe Sam £5.00" or "Settled up". */
export function balanceText(f: FriendBalance): string {
  if (f.balance > 0) return `${f.friend} owes you ${pounds(f.balance)}`;
  if (f.balance < 0) return `You owe ${f.friend} ${pounds(-f.balance)}`;
  return `Settled up with ${f.friend}`;
}

/** Splits a comma-separated list into unique, trimmed names. */
export function parseNames(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const name = raw.trim();
    if (name && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

function errorText(err: unknown, fallback: string): string {
  return typeof err === "string" ? err : fallback;
}

type Message = { error: boolean; text: string } | null;

/** A settle-up that was written and can be reversed from the toast. */
export interface Settled {
  friend: string;
  /** Pence written by the settle-up (the opposite of the balance). */
  amount: number;
  date: string;
}

function Balances({
  friends,
  onSettled,
}: {
  friends: FriendBalance[];
  onSettled: (s: Settled) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const settle = (f: FriendBalance) => {
    setBusy(f.friend);
    setMessage(null);
    const record: Settled = { friend: f.friend, amount: -f.balance, date: localDate() };
    settleUp(record.friend, record.amount, record.date)
      .then(() => {
        onSettled(record);
      })
      .catch((err: unknown) => {
        setMessage({ error: true, text: errorText(err, "Could not save.") });
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <>
      {friends.length === 0 ? (
        <p className="muted">No splits yet. Split a bill below to start a balance.</p>
      ) : (
        <ul className="list" aria-label="Balances with friends">
          {friends.map((f) => (
            <li key={f.friend} className="list__row">
              <div className="list__main">
                <span className="list__title">{balanceText(f)}</span>
                <span className="list__sub">Last change {f.lastDate}</span>
              </div>
              {f.balance !== 0 &&
                (confirming === f.friend ? (
                  <span className="setup__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy !== null}
                      onClick={() => {
                        setConfirming(null);
                        settle(f);
                      }}
                    >
                      Confirm {pounds(Math.abs(f.balance))}{" "}
                      {f.balance > 0 ? `paid by ${f.friend}` : `paid to ${f.friend}`}
                    </button>
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() => {
                        setConfirming(null);
                      }}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="button"
                    data-settle
                    disabled={busy !== null}
                    onClick={() => {
                      setConfirming(f.friend);
                    }}
                  >
                    Settle up with {f.friend}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p
          className={message.error ? "setting__error" : "muted"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </>
  );
}

const UNIT: Record<Exclude<SplitMethod, "equal">, string> = {
  amounts: "£",
  percent: "%",
  shares: "share",
};

const PLACEHOLDER: Record<Exclude<SplitMethod, "equal">, string> = {
  amounts: "0.00",
  percent: "0",
  shares: "1",
};

function SplitForm({ known, onAdded }: { known: string[]; onAdded: () => void }) {
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [names, setNames] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const [paidBy, setPaidBy] = useState("");
  const [method, setMethod] = useState<SplitMethod>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const friends = parseNames(names);
  // "" stands for the owner in the per-person inputs.
  const people = [...(includeMe ? [""] : []), ...friends];
  const pence = toPence(total);
  const validTotal = pence !== null && pence > 0 ? pence : null;
  const check = checkSplit(
    method,
    validTotal,
    people.map((who) => values[who] ?? ""),
  );

  let reason: string | null = null;
  if (description.trim() === "") reason = "Add what it was for.";
  else if (validTotal === null) reason = "Enter a total like 45.00.";
  else if (friends.length === 0) reason = "Add at least one friend.";
  else reason = check.problem;

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy || reason !== null || validTotal === null || check.values === null) return;
    const parts = check.values;
    const split: NewSplit = {
      date,
      description,
      total: validTotal,
      paidBy: paidBy === "" ? null : paidBy,
      // Percentages are saved as the exact pence they work out to.
      method: method === "percent" ? "amounts" : method,
      people: people.map((who, i) => ({ name: who === "" ? null : who, value: parts[i] })),
    };
    setBusy(true);
    setMessage(null);
    addSplit(split)
      .then(() => {
        setMessage({ error: false, text: "Split saved to Money/Splits.md." });
        setDescription("");
        setTotal("");
        setValues({});
        onAdded();
      })
      .catch((err: unknown) => {
        setMessage({ error: true, text: errorText(err, "Could not save.") });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form onSubmit={submit} aria-labelledby="split-heading">
      <h3 id="split-heading" className="card__title">
        Split a bill
      </h3>
      <div className="form">
        <label>
          <span className="kicker">What for</span>
          <input
            id={SPLIT_FIELD_ID}
            required
            maxLength={200}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="kicker">Total (£)</span>
          <input
            required
            inputMode="decimal"
            placeholder="45.00"
            value={total}
            onChange={(e) => {
              setTotal(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="kicker">Split date</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="kicker">Friends (comma-separated)</span>
          <input
            list="money-friends"
            required
            value={names}
            onChange={(e) => {
              setNames(e.target.value);
            }}
          />
          <datalist id="money-friends">
            {known.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="kicker">Who paid</span>
          <select
            value={paidBy}
            onChange={(e) => {
              setPaidBy(e.target.value);
            }}
          >
            <option value="">I paid</option>
            {friends.map((f) => (
              <option key={f} value={f}>
                {f} paid
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="kicker">Split</span>
          <select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as SplitMethod);
              setValues({});
            }}
          >
            <option value="equal">Equally</option>
            <option value="amounts">By amount</option>
            <option value="percent">By percentage</option>
            <option value="shares">By shares</option>
          </select>
        </label>
        <label className="setting__check">
          <input
            type="checkbox"
            checked={includeMe}
            onChange={(e) => {
              setIncludeMe(e.target.checked);
            }}
          />
          Include me in the split
        </label>
        {method !== "equal" &&
          people.map((who) => (
            <label key={who === "" ? "me" : who}>
              <span className="kicker">
                {who === "" ? "Me" : who} ({UNIT[method]})
              </span>
              <input
                inputMode={method === "shares" ? "numeric" : "decimal"}
                placeholder={PLACEHOLDER[method]}
                value={values[who] ?? ""}
                onChange={(e) => {
                  setValues({ ...values, [who]: e.target.value });
                }}
              />
            </label>
          ))}
        {check.progress !== "" && people.length > 0 && (
          <p className="split-form__progress" aria-live="polite">
            {check.progress}
          </p>
        )}
        <div className="form__actions split-form__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || reason !== null}
            aria-describedby={reason === null ? undefined : "split-save-reason"}
          >
            {busy ? "Saving…" : "Save split"}
          </button>
          {reason !== null && (
            <span id="split-save-reason" className="split-form__reason">
              {reason}
            </span>
          )}
        </div>
      </div>
      {message && (
        <p
          className={message.error ? "setting__error" : "muted"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}

/** You owe, you are owed and net, across every friend (spec P9). */
export function SplitsSummary({ friends }: { friends: FriendBalance[] }) {
  const { owe, owed, net } = summarise(friends.map((f) => f.balance));
  const tone = (pence: number) =>
    pence > 0 ? "splits-summary__value--owed" : pence < 0 ? "splits-summary__value--owe" : "";
  const netWords = net > 0 ? "owed to you" : net < 0 ? "you owe" : "all square";
  return (
    <dl className="splits-summary" aria-label="Split totals">
      <div className="splits-summary__item">
        <dt>You owe</dt>
        <dd className={tone(-owe)}>{pounds(owe)}</dd>
      </div>
      <div className="splits-summary__item">
        <dt>You are owed</dt>
        <dd className={tone(owed)}>{pounds(owed)}</dd>
      </div>
      <div className="splits-summary__item">
        <dt>Net</dt>
        <dd className={tone(net)}>
          {pounds(Math.abs(net))} <span className="splits-summary__words">{netWords}</span>
        </dd>
      </div>
    </dl>
  );
}

/** Running balances with friends, settle-ups, and a form to split a bill. */
export function MoneySplits({
  friends,
  recent,
  readOnly,
  onChanged,
}: {
  friends: FriendBalance[];
  recent: SplitRow[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [undoing, setUndoing] = useState(false);
  const nextId = useRef(0);

  const show = (t: Omit<ToastMessage, "id">) => {
    nextId.current += 1;
    setToast({ ...t, id: nextId.current });
  };

  const undo = (s: Settled) => {
    setUndoing(true);
    settleUp(s.friend, -s.amount, s.date)
      .then(() => {
        onChanged();
        show({ text: "Settle-up undone" });
      })
      .catch((err: unknown) => {
        show({ error: true, text: errorText(err, "Could not undo the settle-up.") });
      })
      .finally(() => {
        setUndoing(false);
      });
  };

  const settled = (s: Settled) => {
    onChanged();
    show({
      text: `Recorded a settle-up with ${s.friend}`,
      onUndo: () => {
        undo(s);
      },
    });
  };

  const recentLog = recent.length > 0 && (
    <details className="project__log">
      <summary>Recent ({recent.length})</summary>
      <ul>
        {recent.map((r, i) => (
          <li key={`${r.date}-${String(i)}`}>
            <time>{r.date}</time> {r.description} · {r.friend}{" "}
            {r.amount > 0 ? `owes ${pounds(r.amount)}` : `is owed ${pounds(-r.amount)}`}
          </li>
        ))}
      </ul>
    </details>
  );
  return (
    <Group title="Splits with friends" className="money__splits" bare>
      {friends.length > 0 && <SplitsSummary friends={friends} />}
      {readOnly ? (
        <div className="card card--stack">
          <ul className="list" aria-label="Balances with friends">
            {friends.map((f) => (
              <li key={f.friend} className="list__row">
                <span className="list__title">{balanceText(f)}</span>
              </li>
            ))}
          </ul>
          {recentLog}
        </div>
      ) : (
        <div className="grid grid--2">
          <div id={BALANCES_ID} className="card card--stack">
            <Balances friends={friends} onSettled={settled} />
            {recentLog}
          </div>
          <div className="card card--stack">
            <SplitForm known={friends.map((f) => f.friend)} onAdded={onChanged} />
          </div>
        </div>
      )}
      <Toast
        toast={toast}
        busy={undoing}
        onDismiss={() => {
          setToast(null);
        }}
      />
    </Group>
  );
}
