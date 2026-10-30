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

/**
 * Entering, leaving and choosing a vault run one at a time in the core. While
 * one is pending, every button that starts another is disabled.
 */
let pending = 0;

function notify(): void {
  listeners.forEach((l) => {
    l();
  });
}

export function trackSwitch<T>(call: Promise<T>): Promise<T> {
  pending += 1;
  notify();
  return call.finally(() => {
    pending -= 1;
    notify();
  });
}

export function useSwitching(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0);
}

/** Reads the mode from the core and mirrors it. */
export function loadMode(): Promise<AppMode> {
  return getMode().then((m) => {
    setMode(m);
    return m;
  });
}
