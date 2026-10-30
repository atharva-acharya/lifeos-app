import { useState } from "react";
import {
  addSplit,
  localDate,
  settleUp,
  type FriendBalance,
  type NewSplit,
  type SplitRow,
} from "../api";
import { pounds, toPence } from "../money";

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

function Balances({ friends, onChanged }: { friends: FriendBalance[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const settle = (f: FriendBalance) => {
    setBusy(f.friend);
    settleUp(f.friend, -f.balance, localDate())
      .then(() => {
        setMessage({ error: false, text: `Recorded a settle-up with ${f.friend}.` });
        onChanged();
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
        <ul className="rows" aria-label="Balances with friends">
          {friends.map((f) => (
            <li key={f.friend} className="row">
              <div className="row__main">
                <span className="row__title">{balanceText(f)}</span>
                <span className="row__sub">Last change {f.lastDate}</span>
              </div>
              {f.balance !== 0 && (
                <button
                  type="button"
                  className="button"
                  disabled={busy !== null}
                  onClick={() => {
                    settle(f);
                  }}
                >
                  Settle up with {f.friend}
                </button>
              )}
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

function SplitForm({ known, onAdded }: { known: string[]; onAdded: () => void }) {
  const [date, setDate] = useState(localDate());
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [names, setNames] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const [paidBy, setPaidBy] = useState("");
  const [method, setMethod] = useState<NewSplit["method"]>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const friends = parseNames(names);
  // "" stands for the owner in the per-person inputs.
  const people = [...(includeMe ? [""] : []), ...friends];

  const submit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy) return;
    const pence = toPence(total);
    if (pence === null || pence === 0) {
      setMessage({ error: true, text: "Enter a total like 45.00." });
      return;
    }
    const value = (who: string): number | null => {
      const text = values[who] ?? "";
      if (method === "equal") return 0;
      if (method === "amounts") return toPence(text);
      return /^\d+$/.test(text.trim()) ? Number(text) : null;
    };
    const split: NewSplit = {
      date,
      description,
      total: pence,
      paidBy: paidBy === "" ? null : paidBy,
      method,
      people: [],
    };
    for (const who of people) {
      const v = value(who);
      if (v === null) {
        setMessage({
          error: true,
          text: `Enter ${method === "amounts" ? "an amount" : "a share"} for everyone.`,
        });
        return;
      }
      split.people.push({ name: who === "" ? null : who, value: v });
    }
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
      <h3 id="split-heading" className="kicker">
        Split a bill
      </h3>
      <div className="form">
        <label>
          <span className="kicker">What for</span>
          <input
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
              setMethod(e.target.value as NewSplit["method"]);
            }}
          >
            <option value="equal">Equally</option>
            <option value="amounts">By amount</option>
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
                {who === "" ? "Me" : who} ({method === "amounts" ? "£" : "share"})
              </span>
              <input
                inputMode={method === "amounts" ? "decimal" : "numeric"}
                value={values[who] ?? ""}
                onChange={(e) => {
                  setValues({ ...values, [who]: e.target.value });
                }}
              />
            </label>
          ))}
        <div className="form__actions">
          <button type="submit" className="button button--primary">
            {busy ? "Saving…" : "Save split"}
          </button>
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
  return (
    <section className="card money__splits" aria-labelledby="splits-heading">
      <h2 id="splits-heading" className="kicker">
        Splits with friends
      </h2>
      {readOnly ? (
        <ul className="rows" aria-label="Balances with friends">
          {friends.map((f) => (
            <li key={f.friend} className="row">
              <span className="row__title">{balanceText(f)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <Balances friends={friends} onChanged={onChanged} />
          <SplitForm known={friends.map((f) => f.friend)} onAdded={onChanged} />
        </>
      )}
      {recent.length > 0 && (
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
      )}
    </section>
  );
}
