import { useEffect, useId, useRef, type ReactNode } from "react";
import type { FriendBalance } from "../api";
import { useMode } from "../mode";
import "../styles/money-actions.css";

/** Ids of the elements Settle up and Budget move focus to. */
export const BALANCES_ID = "money-balances";
export const BUDGETS_TITLE_ID = "money-budgets-title";

type ActionKey = "add" | "split" | "import" | "settle" | "budget";
/** The actions that open a sheet; the others move focus on the page. */
export type SheetAction = "add" | "split" | "import";

function opensSheet(action: ActionKey): action is SheetAction {
  return action === "add" || action === "split" || action === "import";
}

/** True when a key press should be left to the element that has focus. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * Moves focus to `el` and scrolls it into view. From the keyboard the jump
 * is instant (M4); from the mouse it may glide unless motion is reduced.
 */
function reveal(el: HTMLElement, smooth: boolean) {
  el.focus({ preventScroll: true });
  // "instant" overrides any CSS scroll-behavior; not in the ES2020 DOM types.
  const behavior = (smooth && !prefersReducedMotion() ? "smooth" : "instant") as ScrollBehavior;
  // Feature-checked: test DOMs (jsdom) do not implement it.
  if ("scrollIntoView" in el) el.scrollIntoView({ behavior, block: "nearest" });
}

function findTarget(action: "settle" | "budget"): HTMLElement | null {
  if (action === "settle") {
    const card = document.getElementById(BALANCES_ID);
    return (
      card?.querySelector<HTMLElement>("button[data-settle]:not(:disabled)") ??
      card?.querySelector<HTMLElement>("button:not(:disabled)") ??
      null
    );
  }
  // The card's heading, so a screen reader hears "Budgets".
  const heading = document.getElementById(BUDGETS_TITLE_ID);
  if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

function disabledActions(sample: boolean, owed: boolean): Record<ActionKey, boolean> {
  return { add: sample, split: sample, import: sample, settle: sample || !owed, budget: false };
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="money-actions__icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<ActionKey, ReactNode> = {
  add: <path d="M8 3v10M3 8h10" />,
  split: <path d="M8 2v5M8 7 3.5 13M8 7l4.5 6" />,
  import: <path d="M8 2.5v7m0 0L5 6.5m3 3 3-3M3 12.5h10" />,
  settle: <path d="m3 8.5 3 3 7-7" />,
  budget: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5V8l4 3.5" />
    </>
  ),
};

/** `name`, when set, is the accessible name; it starts with the visible label. */
/** In reading order; Add, the one primary action, comes last on the right. */
const ACTIONS: { key: ActionKey; label: string; name?: string; shortcut: string }[] = [
  { key: "budget", label: "Budget", shortcut: "B" },
  { key: "settle", label: "Settle up", shortcut: "U" },
  { key: "import", label: "Import", name: "Import a bank statement", shortcut: "I" },
  { key: "split", label: "Split", name: "Split a bill", shortcut: "S" },
  { key: "add", label: "Add", name: "Add a transaction", shortcut: "A" },
];

/**
 * The Money page's quick actions (spec P5), in its header: Add, Split and
 * Import open their flows; Settle up and Budget move to their cards. Each
 * has a single-key shortcut that works while focus is not in a field.
 */
export function MoneyQuickActions({
  friends,
  onOpen,
}: {
  friends: FriendBalance[];
  /** Opens a flow's sheet, growing from `trigger`. */
  onOpen: (action: SheetAction, trigger: HTMLElement) => void;
}) {
  const sample = useMode() === "sample";
  const reasonId = useId();
  const owed = friends.some((f) => f.balance !== 0);
  const buttons = useRef<Partial<Record<ActionKey, HTMLButtonElement | null>>>({});
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });

  const act = (key: ActionKey, smooth: boolean) => {
    const button = buttons.current[key];
    if (opensSheet(key)) {
      if (button) openRef.current(key, button);
      return;
    }
    const el = findTarget(key);
    if (el) reveal(el, smooth);
  };
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });

  const disabled = disabledActions(sample, owed);
  const reason = sample
    ? "Add, Split, Import and Settle up are off while sample data is on."
    : !owed
      ? "Settle up is off: nobody owes you and you owe nobody."
      : null;

  useEffect(() => {
    const off = disabledActions(sample, owed);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTyping(e.target)) return;
      const action = ACTIONS.find((a) => a.shortcut === e.key.toUpperCase());
      if (!action || off[action.key]) return;
      e.preventDefault();
      actRef.current(action.key, false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [sample, owed]);

  return (
    <div className="money-actions">
      <div className="money-actions__row" role="group" aria-label="Quick actions">
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            ref={(el) => {
              buttons.current[a.key] = el;
            }}
            type="button"
            className={`money-actions__button${a.key === "add" ? " money-actions__button--primary" : ""}`}
            disabled={disabled[a.key]}
            aria-label={a.name}
            aria-keyshortcuts={a.shortcut}
            aria-describedby={disabled[a.key] && reason ? reasonId : undefined}
            onClick={(e) => {
              // detail is 0 when Enter or Space pressed the button.
              act(a.key, e.detail > 0);
            }}
          >
            <Icon>{ICONS[a.key]}</Icon>
            <span className="money-actions__label">{a.label}</span>
            <kbd className="money-actions__key" aria-hidden="true">
              {a.shortcut}
            </kbd>
          </button>
        ))}
      </div>
      {reason && (
        <p id={reasonId} className="money-actions__reason">
          {reason}
        </p>
      )}
    </div>
  );
}
