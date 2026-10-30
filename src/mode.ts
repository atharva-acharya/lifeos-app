import { useSyncExternalStore } from "react";
import { getMode, type AppMode } from "./api";

/**
 * Whether the app shows the owner's vault or the sample data. The Rust core
 * holds the truth (in memory only); this mirrors it so every page can react.
 */
let current: AppMode = "real";
const listeners = new Set<() => void>();

export function setMode(next: AppMode): void {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => {
    l();
  });
}

export function currentMode(): AppMode {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMode(): AppMode {
  return useSyncExternalStore(subscribe, currentMode);
}

/** Reads the mode from the core and mirrors it. */
export function loadMode(): Promise<AppMode> {
  return getMode().then((m) => {
    setMode(m);
    return m;
  });
}
