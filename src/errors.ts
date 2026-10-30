import { logError } from "./api";

/** Per session, so a broken loop cannot fill the log (it also rotates). */
const MAX_REPORTS = 50;
let reported = 0;

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack ?? ""}`;
  return typeof err === "string" ? err : JSON.stringify(err);
}

/** Sends an error to the local log; reporting never throws. */
export function report(err: unknown, where = "ui"): void {
  if (reported >= MAX_REPORTS) return;
  reported += 1;
  let text: string;
  try {
    text = `${where}: ${describe(err)}`;
  } catch {
    text = `${where}: (error that could not be described)`;
  }
  logError(text).catch(() => undefined);
}

/** Uncaught errors and rejected promises go to the local log. */
export function installErrorReporting(): void {
  window.addEventListener("error", (e) => {
    report(e.error ?? e.message, "uncaught");
  });
  window.addEventListener("unhandledrejection", (e) => {
    report(e.reason, "promise");
  });
}

/** Test hook: reset the per-session cap. */
export function resetReportCount(): void {
  reported = 0;
}
