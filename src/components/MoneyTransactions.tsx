import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { localDate, setTransactionCategory, type MoneyRow } from "../api";
import { useMode } from "../mode";
import { pounds } from "../money";
import { fromKeyboard } from "../motion";
import { Group } from "./Card";
import "../styles/money-transactions.css";

/** Longest category name the core accepts. */
const MAX_CATEGORY = 60;
/** How long the popover takes to close (M5), matching the CSS. */
const CLOSE_MS = 160;

function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Today", "Yesterday", otherwise e.g. "Tue 27 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  const yesterday = parseDay(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === localDate(yesterday)) return "Yesterday";
  const day = parseDay(date);
  if (Number.isNaN(day.getTime())) return date;
  return day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Pounds with a sign: "+£12.00", "-£3.20", and zero as "£0.00". */
export function signed(pence: number): string {
  return pence > 0 ? `+${pounds(pence)}` : pounds(pence);
}

export interface Day {
  date: string;
  net: number;
  rows: MoneyRow[];
}

/** Transactions by date, newest day first; rows keep their order within a day. */
export function groupByDay(transactions: MoneyRow[]): Day[] {
  const days = new Map<string, Day>();
  for (const t of transactions) {
    let day = days.get(t.date);
    if (!day) {
      day = { date: t.date, net: 0, rows: [] };
      days.set(t.date, day);
    }
    day.net += t.amount;
    day.rows.push(t);
  }
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Which copy of an identical row this is, and how many copies the page shows. */
export interface RowRef {
  occurrence: number;
  duplicates: number;
}

/**
 * Tells identical rows apart for the core: each row's place among the rows
 * with the same date, description, amount, account and category, in the
 * order the page lists them (0 first).
 */
export function rowRefs(transactions: MoneyRow[]): Map<MoneyRow, RowRef> {
  const key = (t: MoneyRow) =>
    JSON.stringify([t.date, t.description, t.amount, t.account, t.category]);
  const counts = new Map<string, number>();
  const refs = new Map<MoneyRow, RowRef>();
  for (const t of transactions) {
    const k = key(t);
    const seen = counts.get(k) ?? 0;
    counts.set(k, seen + 1);
    refs.set(t, { occurrence: seen, duplicates: 0 });
  }
  for (const [t, ref] of refs) ref.duplicates = counts.get(key(t)) ?? 1;
  return refs;
}

/** A value, or a dash read as "none" when it is missing (spec T8). */
function OrDash({ value }: { value: string | null }) {
  if (value) return <>{value}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">none</span>
    </>
  );
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

interface EditProps {
  row: MoneyRow;
  rowRef: RowRef;
  categories: string[];
  /** Id of the text saying why editing is off, when it is. */
  disabledReason: string | null;
  onChanged?: () => void;
}

/**
 * The row's category as a small button (spec P6: two clicks to change it).
 * It opens a popover from itself (M5) listing the known categories and a
 * field for a new one. Escape closes it and puts focus back on the button.
 */
function CategoryEdit({ row, rowRef, categories, disabledReason, onChanged }: EditProps) {
  const popId = useId();
  const inputId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  // `instant` when the keyboard opened it: no animation (M4).
  const [open, setOpen] = useState<{ instant: boolean } | null>(null);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = row.description || "this transaction";
  const current = row.category ?? "none";

  const finish = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(null);
    setClosing(false);
    setError(null);
    setDraft("");
  };

  const close = (instant: boolean, refocus: boolean) => {
    if (refocus) trigger.current?.focus();
    if (instant || open?.instant === true || reducedMotion()) {
      finish();
      return;
    }
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(finish, CLOSE_MS);
  };

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  // Focus the current category (or the first one, or the field) on open.
  useEffect(() => {
    if (!open) return;
    const items = popover.current?.querySelectorAll<HTMLElement>("[data-option]");
    const chosen = popover.current?.querySelector<HTMLElement>('[aria-current="true"]');
    (chosen ?? items?.[0] ?? popover.current?.querySelector<HTMLElement>("input"))?.focus();
  }, [open]);

  // A press outside closes it.
  useEffect(() => {
    if (!open || closing) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && e.target instanceof Node && !wrap.current.contains(e.target)) {
        close(false, false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  });

  const save = (category: string, instant: boolean) => {
    const value = category.trim();
    if (value === "") {
      setError("Type a category name.");
      return;
    }
    if (value === row.category) {
      close(instant, true);
      return;
    }
    setSaving(true);
    setError(null);
    setTransactionCategory({
      date: row.date,
      description: row.description,
      amount: row.amount,
      account: row.account,
      category: row.category,
      occurrence: rowRef.occurrence,
      duplicates: rowRef.duplicates,
      newCategory: value,
    })
      .then(() => {
        setSaving(false);
        close(instant, true);
        onChanged?.();
      })
      .catch((err: unknown) => {
        setSaving(false);
        setError(typeof err === "string" ? err : "Could not change the category.");
      });
  };

  // Escape closes and refocuses the button; arrow keys move between options.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!wrap.current?.contains(document.activeElement)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true, true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(popover.current?.querySelectorAll<HTMLElement>("[data-option]") ?? [])];
      const at = items.findIndex((el) => el === document.activeElement);
      if (at === -1) return;
      e.preventDefault();
      const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  });

  const onSubmit = (e: SyntheticEvent) => {
    e.preventDefault();
    save(draft, true);
  };

  return (
    <span className="money-tx__cat-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="money-tx__cat"
        aria-label={`Change category for ${name}, now ${current}`}
        aria-haspopup="dialog"
        aria-expanded={open !== null && !closing}
        aria-controls={open ? popId : undefined}
        aria-describedby={disabledReason ?? undefined}
        disabled={disabledReason !== null}
        onClick={(e) => {
          if (open && !closing) {
            close(fromKeyboard(e), false);
            return;
          }
          window.clearTimeout(closeTimer.current);
          setClosing(false);
          setOpen({ instant: fromKeyboard(e) });
        }}
      >
        <OrDash value={row.category} />
        <span className="money-tx__chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={popover}
          id={popId}
          role="dialog"
          aria-label={`Category for ${name}`}
          className="money-tx__pop"
          data-instant={open.instant ? "" : undefined}
          data-closing={closing ? "" : undefined}
        >
          {categories.length > 0 && (
            <ul className="money-tx__options" aria-label="Categories">
              {categories.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    className="money-tx__option"
                    data-option=""
                    aria-current={c === row.category ? "true" : undefined}
                    disabled={saving}
                    onClick={(e) => {
                      save(c, fromKeyboard(e));
                    }}
                  >
                    <span className="money-tx__option-name">{c}</span>
                    {c === row.category && (
                      <span className="money-tx__tick" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="money-tx__new" onSubmit={onSubmit}>
            <label htmlFor={inputId} className="money-tx__new-label">
              New category
            </label>
            <div className="money-tx__new-row">
              <input
                id={inputId}
                type="text"
                value={draft}
                maxLength={MAX_CATEGORY}
                autoComplete="off"
                disabled={saving}
                onChange={(e) => {
                  setDraft(e.target.value);
                }}
              />
              <button type="submit" className="button" disabled={saving}>
                Save
              </button>
            </div>
          </form>
          {error && (
            <p className="setting__error money-tx__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

function DayGroup({
  day,
  today,
  refs,
  categories,
  disabledReason,
  onChanged,
}: {
  day: Day;
  today: string;
  refs: Map<MoneyRow, RowRef>;
  categories: string[];
  disabledReason: string | null;
  onChanged?: () => void;
}) {
  const id = useId();
  const label = dayLabel(day.date, today);
  return (
    <li className="money-tx__day">
      <section aria-labelledby={id}>
        <div className="money-tx__head">
          <h3 id={id} className="money-tx__date">
            {label}
          </h3>
          <p className="money-tx__net">
            <span className="sr-only">Net for the day </span>
            {signed(day.net)}
          </p>
        </div>
        <ul className="money-tx__rows" aria-label={`Transactions on ${label}`}>
          {day.rows.map((t, i) => (
            <li key={i} className="money-tx__row">
              <div className="money-tx__main">
                <span className="money-tx__title">{t.description}</span>
                <span className="money-tx__sub">
                  <span className="sr-only">Category </span>
                  <CategoryEdit
                    row={t}
                    rowRef={refs.get(t) ?? { occurrence: 0, duplicates: 1 }}
                    categories={categories}
                    disabledReason={disabledReason}
                    onChanged={onChanged}
                  />
                  <span aria-hidden="true"> · </span>
                  <span className="sr-only">, account </span>
                  <OrDash value={t.account} />
                </span>
              </div>
              <span className={`money-tx__amount${t.amount > 0 ? " money-tx__amount--in" : ""}`}>
                <span className="sr-only">Amount </span>
                {signed(t.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </li>
  );
}

/**
 * The month's transactions as a list grouped by day (spec P6, C3). Each day
 * has a sticky header with its date and net, and each row's category opens
 * a popover to change it.
 */
export function MoneyTransactions({
  transactions,
  monthLabel,
  categories = [],
  onChanged,
  today = localDate(),
}: {
  transactions: MoneyRow[];
  /** e.g. "October 2026", for the empty state. */
  monthLabel: string;
  /** Known category names, offered when changing a row's category. */
  categories?: string[];
  /** Called after a category was saved, to reload the page. */
  onChanged?: () => void;
  /** YYYY-MM-DD; defaults to the local date. */
  today?: string;
}) {
  const sample = useMode() === "sample";
  const reasonId = useId();
  const days = groupByDay(transactions);
  const refs = rowRefs(transactions);
  return (
    <Group title="Transactions" cardClassName="card--flush money-tx">
      {days.length === 0 ? (
        <p className="muted">Nothing recorded in {monthLabel}.</p>
      ) : (
        <>
          {sample && (
            <p id={reasonId} className="muted money-tx__note">
              Categories cannot be changed while sample data is on.
            </p>
          )}
          <ul className="money-tx__days">
            {days.map((day) => (
              <DayGroup
                key={day.date}
                day={day}
                today={today}
                refs={refs}
                categories={categories}
                disabledReason={sample ? reasonId : null}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </>
      )}
    </Group>
  );
}
