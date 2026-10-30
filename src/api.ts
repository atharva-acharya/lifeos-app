import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  vaultPath: string | null;
  google: GoogleView;
  /** Check GitHub for signed updates at start-up. */
  autoUpdate: boolean;
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

export interface CompanyCard {
  path: string;
  company: string | null;
  role: string | null;
  stage: string;
  applied: string | null;
  contact: string | null;
  nextAction: string | null;
  nextDate: string | null;
}

export interface Stage {
  stage: string;
  companies: CompanyCard[];
}

export interface OutreachEntry {
  sent: string | null;
  name: string | null;
  profile: string | null;
  companyRole: string | null;
  contactType: string | null;
  status: string | null;
  lastUpdate: string | null;
}

export interface Jobs {
  pipeline: Stage[];
  outreach: OutreachEntry[];
}

export type JobsResponse = { status: "noVault" } | { status: "ready"; jobs: Jobs };

export function getJobs(): Promise<JobsResponse> {
  return invoke<JobsResponse>("get_jobs");
}

export interface GoogleView {
  clientId: string;
  sheetId: string;
  hasSecret: boolean;
  configured: boolean;
  connected: boolean;
}

export function saveGoogleConfig(
  clientId: string,
  clientSecret: string,
  sheetId: string,
): Promise<AppSettings> {
  return invoke<AppSettings>("save_google_config", { clientId, clientSecret, sheetId });
}

export function connectGoogle(): Promise<AppSettings> {
  return invoke<AppSettings>("connect_google");
}

export function disconnectGoogle(): Promise<AppSettings> {
  return invoke<AppSettings>("disconnect_google");
}

export interface Application {
  applied: string | null;
  company: string | null;
  role: string | null;
  source: string | null;
  inbox: string | null;
  status: string | null;
  lastUpdate: string | null;
  daysSince: string | null;
  followUp: string | null;
  email: string | null;
  notes: string | null;
  messageId: string | null;
}

export interface ApplicationsView {
  configured: boolean;
  connected: boolean;
  cache: { fetchedAt: number; rows: Application[]; missingColumns: string[] } | null;
  error: string | null;
}

export function getApplications(): Promise<ApplicationsView> {
  return invoke<ApplicationsView>("get_applications");
}

export function refreshApplications(): Promise<ApplicationsView> {
  return invoke<ApplicationsView>("refresh_applications");
}

export interface Diagnostics {
  version: string;
  os: string;
  /** Newest entries of the local error log, oldest first. */
  log: string[];
}

/** Records an error in the local log (never sent anywhere). */
export function logError(message: string): Promise<undefined> {
  return invoke<undefined>("log_error", { message });
}

export function getDiagnostics(): Promise<Diagnostics> {
  return invoke<Diagnostics>("get_diagnostics");
}

export interface UpdateInfo {
  version: string;
  notes: string;
}

export function setAutoUpdate(enabled: boolean): Promise<AppSettings> {
  return invoke<AppSettings>("set_auto_update", { enabled });
}

/** Resolves with the newer version, or null when this is the latest. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>("check_for_update");
}

/** Downloads, verifies and installs `version` (the one shown); the app then restarts. */
export function installUpdate(version: string): Promise<undefined> {
  return invoke<undefined>("install_update", { version });
}

export interface FitnessDay {
  date: string;
  weight: number | null;
  steps: number | null;
  proteinG: number | null;
}

export interface FitnessPlan {
  name: string | null;
  start: string | null;
  end: string | null;
  startWeight: number | null;
  targetWeight: number | null;
  stepsGoal: number;
  proteinGoal: number;
}

export interface ExerciseSet {
  name: string;
  sets: number | null;
  reps: number | null;
  kg: number | null;
  /** The line as written, sent only when it did not fully parse. */
  raw: string | null;
}

export interface FitnessWorkout {
  path: string;
  date: string | null;
  day: string | null;
  week: number | null;
  deload: boolean;
  durationMin: number | null;
  exercises: ExerciseSet[];
}

export interface LiftSession {
  date: string;
  kg: number;
  reps: number | null;
}

export interface Lift {
  name: string;
  /** Oldest first; deload sessions are left out. */
  sessions: LiftSession[];
}

export interface Fitness {
  /** The last 90 days with a daily note, oldest first. */
  days: FitnessDay[];
  plan: FitnessPlan | null;
  /** Newest first. */
  workouts: FitnessWorkout[];
  lifts: Lift[];
  parseErrors: number;
}

export type FitnessResponse = { status: "noVault" } | { status: "ready"; fitness: Fitness };

export function getFitness(date: string): Promise<FitnessResponse> {
  return invoke<FitnessResponse>("get_fitness", { date });
}

export interface ProjectStep {
  text: string;
  done: boolean;
}

export interface ProjectLogEntry {
  date: string | null;
  text: string;
}

export interface Project {
  path: string;
  name: string;
  status: string | null;
  active: boolean;
  updated: string | null;
  steps: ProjectStep[];
  done: number;
  total: number;
  /** Index of the first unchecked step. */
  current: number | null;
  nextStep: string | null;
  lastLog: ProjectLogEntry | null;
  /** Newest first, at most 100. */
  log: ProjectLogEntry[];
  /** Entries stored for the note; may exceed `log.length`. */
  logTotal: number;
}

export interface Projects {
  projects: Project[];
  parseErrors: number;
}

export type ProjectsResponse = { status: "noVault" } | { status: "ready"; projects: Projects };

export function getProjects(): Promise<ProjectsResponse> {
  return invoke<ProjectsResponse>("get_projects");
}
