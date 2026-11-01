import { useState, type RefObject } from "react";
import { addSplit, localDate, type NewSplit } from "../api";
import { pounds, toPence } from "../money";
import { checkSplit, liveShares, type SplitMethod } from "../splitMath";
import { AmountEntry, avatarColour, FlowPane, FlowSteps } from "./Flow";
import { parseNames } from "./MoneySplits";
import { Sheet } from "./Sheet";

const STEPS = ["Amount", "Who", "How"];

const METHODS: { id: SplitMethod; label: string }[] = [
  { id: "equal", label: "Equally" },
  { id: "amounts", label: "Exact amounts" },
  { id: "percent", label: "Percent" },
  { id: "shares", label: "Shares" },
];

const UNIT: Record<Exclude<SplitMethod, "equal">, { label: string; placeholder: string }> = {
  amounts: { label: "£", placeholder: "0.00" },
  percent: { label: "%", placeholder: "0" },
  shares: { label: "shares", placeholder: "1" },
};

function errorText(err: unknown, fallback: string): string {
  return typeof err === "string" && err.trim() !== "" ? err : fallback;
}

/** "" stands for the owner throughout, as the split note writes it. */
const ME = "";

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ "--avatar": avatarColour(name) } as React.CSSProperties}
    >
      {name === ME ? "Y" : name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Split a bill as three short steps: how much and what for, who was there
 * (tap their bubbles), then how to divide it, with each person's share
 * worked out live. Save stays off until the parts add up (ui-spec P8).
 */
export function MoneySplitFlow({
  open,
  onClose,
  trigger,
  known,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLElement | null>;
  /** Friends already in the splits note, offered as bubbles. */
  known: string[];
  onSaved: (text: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [back, setBack] = useState(false);
  const [total, setTotal] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(localDate());
  const [friends, setFriends] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const [paidBy, setPaidBy] = useState(ME);
  const [method, setMethod] = useState<SplitMethod>("equal");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pence = toPence(total);
  const validTotal = pence !== null && pence > 0 ? pence : null;
  const people = [...(includeMe ? [ME] : []), ...friends];
  const inputs = people.map((who) => values[who] ?? "");
  const check = checkSplit(method, validTotal, inputs);
  const shares = liveShares(method, validTotal, inputs);
  const bubbles = [...new Set([...known, ...friends])];

  const go = (to: number) => {
    setBack(to < step);
    setStep(to);
  };

  const reset = () => {
    setStep(0);
    setBack(false);
    setTotal("");
    setDescription("");
    setDate(localDate());
    setFriends([]);
    setNewName("");
    setIncludeMe(true);
    setPaidBy(ME);
    setMethod("equal");
    setValues({});
    setError(null);
  };

  const toggle = (name: string) => {
    setFriends((f) => (f.includes(name) ? f.filter((x) => x !== name) : [...f, name]));
    if (paidBy === name) setPaidBy(ME);
  };

  // Several names at once work too: "Sam, Robin".
  const addName = () => {
    const names = parseNames(newName).filter((n) => !friends.includes(n));
    if (names.length > 0) setFriends([...friends, ...names]);
    setNewName("");
  };

  const amountReason =
    validTotal === null
      ? "Enter the bill total."
      : description.trim() === ""
        ? "Say what it was for."
        : null;
  const whoReason = friends.length === 0 ? "Pick at least one friend." : null;

  const save = () => {
    if (busy || validTotal === null || check.values === null || check.problem !== null) return;
    const parts = check.values;
    const split: NewSplit = {
      date,
      description: description.trim(),
      total: validTotal,
      paidBy: paidBy === ME ? null : paidBy,
      // Percentages are saved as the exact pence they work out to.
      method: method === "percent" ? "amounts" : method,
      people: people.map((who, i) => ({ name: who === ME ? null : who, value: parts[i] })),
    };
    setBusy(true);
    setError(null);
    addSplit(split)
      .then(() => {
        onSaved(`Split ${pounds(validTotal)} with ${friends.join(", ")}`);
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

  return (
    <Sheet open={open} onClose={onClose} title="Split a bill" trigger={trigger}>
      <div className="flow">
        <FlowSteps steps={STEPS} current={step} />

        {step === 0 && (
          <FlowPane back={back} label="Amount">
            <AmountEntry
              value={total}
              onChange={setTotal}
              label="Bill total in pounds"
              focusOnOpen
            />
            <div className="flow-field">
              <input
                placeholder="What was it for? For example, dinner out"
                aria-label="What it was for"
                maxLength={200}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && amountReason === null) go(1);
                }}
              />
              <input
                type="date"
                aria-label="Date of the bill"
                className="flow-field__date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                }}
              />
            </div>
            <div className="flow__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={amountReason !== null}
                onClick={() => {
                  go(1);
                }}
              >
                {amountReason ?? "Next: who was there"}
              </button>
            </div>
          </FlowPane>
        )}

        {step === 1 && (
          <FlowPane back={back} label="Who">
            <p className="flow__label">Who is splitting {pounds(validTotal ?? 0)}?</p>
            <ul className="bubbles" aria-label="People">
              <li>
                <button
                  type="button"
                  className="bubble"
                  aria-pressed={includeMe}
                  onClick={() => {
                    setIncludeMe(!includeMe);
                  }}
                >
                  <Avatar name={ME} />
                  You
                </button>
              </li>
              {bubbles.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="bubble"
                    aria-pressed={friends.includes(name)}
                    onClick={() => {
                      toggle(name);
                    }}
                  >
                    <Avatar name={name} />
                    {name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flow-field">
              <input
                placeholder="Add someone new"
                aria-label="Add someone new"
                maxLength={60}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addName();
                  }
                }}
              />
              <button type="button" className="button button--quiet" onClick={addName}>
                Add
              </button>
            </div>
            <div className="flow__pane">
              <p className="flow__label" id="split-paid">
                Who paid
              </p>
              <div className="chips" role="radiogroup" aria-labelledby="split-paid">
                {[ME, ...friends].map((who) => (
                  <button
                    key={who === ME ? "me" : who}
                    type="button"
                    role="radio"
                    className="chip"
                    aria-checked={paidBy === who}
                    onClick={() => {
                      setPaidBy(who);
                    }}
                  >
                    {who === ME ? "You paid" : `${who} paid`}
                  </button>
                ))}
              </div>
            </div>
            <div className="flow__actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  go(0);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={whoReason !== null}
                onClick={() => {
                  go(2);
                }}
              >
                {whoReason ?? `Next: split between ${String(people.length)}`}
              </button>
            </div>
          </FlowPane>
        )}

        {step === 2 && (
          <FlowPane back={back} label="How">
            <div className="chips flow__kind" role="radiogroup" aria-label="How to split">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  className="chip"
                  aria-checked={method === m.id}
                  onClick={() => {
                    setMethod(m.id);
                    setValues({});
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <ul className="shares" aria-label="Shares">
              {people.map((who, i) => (
                <li key={who === ME ? "me" : who} className="share">
                  <Avatar name={who} />
                  <span className="share__name">{who === ME ? "You" : who}</span>
                  {method !== "equal" && (
                    <label className="flow-field share__input">
                      <input
                        inputMode={method === "shares" ? "numeric" : "decimal"}
                        placeholder={UNIT[method].placeholder}
                        aria-label={`${who === ME ? "Your" : `${who}'s`} ${UNIT[method].label}`}
                        value={values[who] ?? ""}
                        onChange={(e) => {
                          setValues({ ...values, [who]: e.target.value });
                        }}
                      />
                      <span aria-hidden="true">{UNIT[method].label}</span>
                    </label>
                  )}
                  <span className="share__amount" aria-live="polite">
                    {pounds(shares[i] ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
            {check.progress !== "" && (
              <p
                className={`flow-gap ${check.problem === null ? "flow-gap--ok" : "flow-gap--open"}`}
                aria-live="polite"
              >
                {check.progress}
              </p>
            )}
            <div className="flow__actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  go(1);
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy || check.problem !== null || check.values === null}
                onClick={save}
              >
                {busy
                  ? "Saving…"
                  : (check.problem ??
                    `Split ${pounds(validTotal ?? 0)} with ${String(friends.length)}`)}
              </button>
            </div>
            {error && (
              <p className="setting__error" role="alert">
                {error}
              </p>
            )}
          </FlowPane>
        )}
      </div>
    </Sheet>
  );
}
