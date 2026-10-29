import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  vaultPath: string | null;
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_settings");
}

/** Opens the native folder picker; resolves with the settings after the choice. */
export function chooseVaultFolder(): Promise<AppSettings> {
  return invoke<AppSettings>("choose_vault_folder");
}

export interface Habits {
  weighIn: boolean;
  steps: number | null;
  proteinG: number | null;
  mealsTracked: boolean;
  mobility: boolean;
}

export interface FollowUp {
  path: string;
  company: string | null;
  role: string | null;
  stage: string | null;
  nextAction: string | null;
  nextDate: string;
}

export interface Resume {
  path: string;
  project: string | null;
  done: number;
  total: number;
  nextStep: string | null;
  lastLog: string | null;
}

export interface Today {
  date: string;
  weight: number | null;
  weightChange: number | null;
  applications: number | null;
  gym: string | null;
  habits: Habits;
  followUps: FollowUp[];
  project: Resume | null;
  parseErrors: number;
}

export type TodayResponse = { status: "noVault" } | { status: "ready"; today: Today };

/** The owner's local date as YYYY-MM-DD. */
export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function getToday(date: string): Promise<TodayResponse> {
  return invoke<TodayResponse>("get_today", { date });
}

/** Calls `onChange` whenever the vault index changes; returns an unsubscribe function. */
export async function onIndexUpdated(onChange: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("index-updated", onChange);
}
