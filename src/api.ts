import { invoke } from "@tauri-apps/api/core";

export interface AppSettings {
  vaultPath: string | null;
  /** Folder Health Auto Export writes to; the app only reads it. */
  healthPath: string | null;
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

/** Opens the native folder picker for the Health export folder. */
export function chooseHealthFolder(): Promise<AppSettings> {
  return invoke<AppSettings>("choose_health_folder");
}

/** Forgets the Health folder (the folder itself is never touched). */
export function clearHealthFolder(): Promise<AppSettings> {
  return invoke<AppSettings>("clear_health_folder");
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
  /** A daily note exists for `date`; without one the numbers are blank, not zero. */
  hasDailyNote: boolean;
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

/** Amounts are in pence; budgets and categories carry spending as positive pence. */
export interface MoneyRow {
  date: string;
  description: string;
  category: string | null;
  amount: number;
  account: string | null;
}

export interface BudgetLine {
  category: string;
  limit: number;
  spent: number;
  status: "under" | "near" | "over";
}

export interface Money {
  month: string;
  months: string[];
  income: number;
  spent: number;
  budgets: BudgetLine[];
  categories: { category: string; spent: number }[];
  transactions: MoneyRow[];
  knownCategories: string[];
  hasLedger: boolean;
  hasBudgets: boolean;
  parseErrors: number;
  /** Six months ending with `month`, oldest first. */
  trend: MonthTotals[];
  friends: FriendBalance[];
  splits: SplitRow[];
}

/** `balance` is pence the friend owes the owner (negative: the owner owes). */
export interface FriendBalance {
  friend: string;
  balance: number;
  lastDate: string;
}

export interface SplitRow {
  date: string;
  description: string;
  friend: string;
  amount: number;
}

export interface NewSplit {
  date: string;
  description: string;
  total: number;
  /** null when the owner paid. */
  paidBy: string | null;
  method: "equal" | "amounts" | "shares";
  /** `name` null is the owner; `value` is pence (amounts) or a share (shares). */
  people: { name: string | null; value: number }[];
}

export function addSplit(split: NewSplit): Promise<undefined> {
  return invoke<undefined>("add_split", { split });
}

export function settleUp(friend: string, amount: number, date: string): Promise<undefined> {
  return invoke<undefined>("settle_up", { friend, amount, date });
}

export interface CategoryAmount {
  category: string;
  /** Positive pence. */
  spent: number;
}

export interface MonthTotals {
  month: string;
  income: number;
  spent: number;
  spending: CategoryAmount[];
  incomeBySource: CategoryAmount[];
}

export type MoneyResponse = { status: "noVault" } | { status: "ready"; money: Money };

export function getMoney(month: string): Promise<MoneyResponse> {
  return invoke<MoneyResponse>("get_money", { month });
}

export interface NewTransaction {
  date: string;
  description: string;
  category: string | null;
  amount: number;
  account: string | null;
}

export function addTransaction(transaction: NewTransaction): Promise<undefined> {
  return invoke<undefined>("add_transaction", { transaction });
}

/**
 * Names one ledger row by what the page shows, never by a path. `occurrence`
 * picks one of several identical rows (0 is the first the page lists) and
 * `duplicates` is how many the page shows; the core refuses if the note no
 * longer has exactly that many.
 */
export interface CategoryChange {
  date: string;
  description: string;
  amount: number;
  account: string | null;
  category: string | null;
  occurrence: number;
  duplicates: number;
  newCategory: string;
}

export function setTransactionCategory(change: CategoryChange): Promise<undefined> {
  return invoke<undefined>("set_transaction_category", { change });
}

export type DateFormat = "dmy" | "ymd" | "mdy";

/** Which CSV column (by header) holds each field of a bank statement. */
export interface ImportMapping {
  date: string;
  dateFormat: DateFormat;
  description: string;
  amount: string | null;
  moneyOut: string | null;
  moneyIn: string | null;
  category: string | null;
  flipSign: boolean;
}

export interface ImportRow {
  line: number;
  date: string | null;
  description: string;
  category: string | null;
  amount: number | null;
  status: "new" | "duplicate" | "error";
  error: string | null;
}

export interface ImportPreview {
  headers: string[];
  mapping: ImportMapping;
  saved: boolean;
  rows: ImportRow[];
  new: number;
  duplicates: number;
  errors: number;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: number;
  files: string[];
}

export function getBanks(): Promise<string[]> {
  return invoke<string[]>("get_banks");
}

export function previewImport(
  csv: string,
  bank: string,
  mapping: ImportMapping | null,
  account: string | null,
): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_import", { csv, bank, mapping, account });
}

export function importCsv(
  csv: string,
  bank: string,
  mapping: ImportMapping,
  account: string | null,
): Promise<ImportResult> {
  return invoke<ImportResult>("import_csv", { csv, bank, mapping, account });
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
  /** True when the plan note has no goal and the app default is used. */
  stepsGoalDefault?: boolean;
  proteinGoalDefault?: boolean;
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

export interface HealthSleep {
  total: number;
  core: number;
  deep: number;
  rem: number;
  awake: number;
}

export interface HealthDay {
  date: string;
  steps: number | null;
  activeEnergy: number | null;
  restingHr: number | null;
  hrv: number | null;
  sleep: HealthSleep | null;
  weight: number | null;
  weightSource: "health" | "vault" | null;
}

export interface HealthRingsDay extends HealthDay {
  isToday: boolean;
}

export interface HealthGoals {
  steps: number;
  activeEnergy: number;
  sleepHours: number;
}

export interface HealthWorkout {
  source: "health" | "vault";
  date: string;
  name: string;
  durationMin: number | null;
  activeEnergy: number | null;
  distanceKm: number | null;
  path: string | null;
}

export interface BadFile {
  name: string;
  reason: string;
}

export interface Health {
  /** Newest export file's modification time, ms since the Unix epoch. */
  lastExport: number | null;
  latestData: string | null;
  stale: boolean;
  /** The 90 days ending today, oldest first. */
  days: HealthDay[];
  ringsDay: HealthRingsDay | null;
  goals: HealthGoals;
  /** Newest first. */
  workouts: HealthWorkout[];
  badFiles: BadFile[];
  badFileCount: number;
  skippedFiles: number;
  fileCount: number;
}

export type HealthResponse = { status: "notConfigured" } | { status: "ready"; health: Health };

export function getHealth(date: string): Promise<HealthResponse> {
  return invoke<HealthResponse>("get_health", { date, nowMs: Date.now() });
}

export type SetupItemId = "vault" | "daily" | "plan" | "sheet" | "projects" | "health";

export interface SetupItem {
  id: SetupItemId;
  title: string;
  required: boolean;
  done: boolean;
  /** Skipped and not done. */
  skipped: boolean;
  /** Extra progress, for example "2 of 3 fields". */
  detail: string | null;
}

export interface Setup {
  items: SetupItem[];
  dismissed: boolean;
  total: number;
  setUp: number;
  skipped: number;
  /** Every item is done or skipped. */
  complete: boolean;
}

export function getSetup(): Promise<Setup> {
  return invoke<Setup>("get_setup");
}

export function skipSetupItem(id: SetupItemId): Promise<Setup> {
  return invoke<Setup>("skip_setup_item", { id });
}

export function unskipSetupItem(id: SetupItemId): Promise<Setup> {
  return invoke<Setup>("unskip_setup_item", { id });
}

export function dismissSetup(): Promise<Setup> {
  return invoke<Setup>("dismiss_setup");
}

export type AppMode = "real" | "sample";

export function getMode(): Promise<AppMode> {
  return invoke<AppMode>("get_mode");
}

/** Turns sample data on; dates in the demo vault are relative to the owner's local date. */
export function enterSampleMode(date: string = localDate()): Promise<AppMode> {
  return invoke<AppMode>("enter_sample_mode", { date });
}

export function exitSampleMode(): Promise<AppMode> {
  return invoke<AppMode>("exit_sample_mode");
}
