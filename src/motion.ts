import { flushSync } from "react-dom";

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface TransitionOptions {
  /**
   * Apply the change at once, with no animation. Used for every change the
   * keyboard starts (Ctrl K, arrow keys in tabs, Enter or Space on a button),
   * which must never animate (ui-spec M4).
   */
  instant?: boolean;
}

/**
 * Runs a state change inside a View Transition (page and tab changes), so the
 * old and new views animate as styled in motion.css. Falls back to a plain
 * update when the API is missing, the owner prefers reduced motion, or the
 * change came from the keyboard (`instant`).
 */
export function withTransition(update: () => void, options: TransitionOptions = {}): void {
  if (
    options.instant === true ||
    typeof document.startViewTransition !== "function" ||
    reducedMotion()
  ) {
    update();
    return;
  }
  document.startViewTransition(() => {
    flushSync(update);
  });
}

/**
 * True when a click event was produced by the keyboard (Enter or Space on a
 * button) rather than a pointer. Browsers report those clicks with
 * `detail === 0`, the number of pointer presses.
 */
export function fromKeyboard(e: { detail: number }): boolean {
  return e.detail === 0;
}
