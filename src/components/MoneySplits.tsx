import { useRef, useState } from "react";
import { localDate, settleUp, type FriendBalance, type SplitRow } from "../api";
import { pounds } from "../money";
import { summarise } from "../splitMath";
import "../styles/money-splits.css";
import { CardHead } from "./Card";
import { BALANCES_ID } from "./MoneyQuickActions";
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
        <p className="muted">No splits yet. Use Split at the top to share a bill.</p>
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

/** Running balances with friends and settle-ups. Splitting a bill is a flow (MoneySplitFlow). */
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
    <section className="card money__splits" aria-labelledby="money-splits-title">
      <CardHead id="money-splits-title" title="Splits with friends" />
      {friends.length > 0 && <SplitsSummary friends={friends} />}
      {readOnly ? (
        <ul className="list" aria-label="Balances with friends">
          {friends.map((f) => (
            <li key={f.friend} className="list__row">
              <span className="list__title">{balanceText(f)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div id={BALANCES_ID} className="money__balances">
          <Balances friends={friends} onSettled={settled} />
        </div>
      )}
      {recentLog}
      <Toast
        toast={toast}
        busy={undoing}
        onDismiss={() => {
          setToast(null);
        }}
      />
    </section>
  );
}
