import { useState } from "react";

/** localStorage key for the app's own "Reduce transparency" toggle. */
export const TRANSPARENCY_KEY = "lifeos.reduceTransparency";

function read(): boolean {
  try {
    return window.localStorage.getItem(TRANSPARENCY_KEY) === "1";
  } catch {
    return false;
  }
}

function apply(reduced: boolean): void {
  if (reduced) document.documentElement.setAttribute("data-transparency", "reduced");
  else document.documentElement.removeAttribute("data-transparency");
}

/** Sets `data-transparency` on <html> from the stored choice (ui-spec L5). */
export function applyStoredTransparency(): void {
  apply(read());
}

/** Stores the choice and applies it at once. */
export function setReduceTransparency(reduced: boolean): void {
  try {
    if (reduced) window.localStorage.setItem(TRANSPARENCY_KEY, "1");
    else window.localStorage.removeItem(TRANSPARENCY_KEY);
  } catch {
    // Storage can be unavailable; the choice still applies until restart.
  }
  apply(reduced);
}

/** The stored choice as state, for the Settings toggle. */
export function useReduceTransparency(): [boolean, (reduced: boolean) => void] {
  const [reduced, setReduced] = useState(read);
  return [
    reduced,
    (next: boolean) => {
      setReduceTransparency(next);
      setReduced(next);
    },
  ];
}
