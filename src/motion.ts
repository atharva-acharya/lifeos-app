import { flushSync } from "react-dom";

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Runs a state change inside a View Transition (page and tab changes), so the
 * old and new views animate as styled in motion.css. Falls back to a plain
 * update when the API is missing or the owner prefers reduced motion.
 */
export function withTransition(update: () => void): void {
  if (typeof document.startViewTransition !== "function" || reducedMotion()) {
    update();
    return;
  }
  document.startViewTransition(() => {
    flushSync(update);
  });
}
