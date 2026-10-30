import { vi } from "vitest";
import type { Setup } from "../api";

/** Shared mocks for the Tauri bridge; tests set `invoke` results per case. */
export const invoke = vi.fn();
export const listen = vi.fn(() => Promise.resolve(() => undefined));

export const NO_GOOGLE = {
  clientId: "",
  sheetId: "",
  hasSecret: false,
  configured: false,
  connected: false,
};

/** A set-up profile: a vault is chosen and update checks are off. */
export const READY_SETTINGS = {
  vaultPath: "D:\\Notes\\Life OS",
  google: NO_GOOGLE,
  autoUpdate: false,
};

/** Every item done, so the Today card stays hidden. */
export const COMPLETE_SETUP: Setup = {
  items: [
    {
      id: "vault",
      title: "Vault folder",
      required: true,
      done: true,
      skipped: false,
      detail: null,
    },
    {
      id: "daily",
      title: "Daily notes",
      required: false,
      done: true,
      skipped: false,
      detail: null,
    },
    {
      id: "plan",
      title: "Fitness plan",
      required: false,
      done: true,
      skipped: false,
      detail: null,
    },
    {
      id: "sheet",
      title: "Google Sheet",
      required: false,
      done: true,
      skipped: false,
      detail: null,
    },
    {
      id: "projects",
      title: "Projects",
      required: false,
      done: true,
      skipped: false,
      detail: null,
    },
    {
      id: "health",
      title: "Health export",
      required: false,
      done: true,
      skipped: false,
      detail: null,
    },
  ],
  dismissed: false,
  total: 6,
  setUp: 6,
  skipped: 0,
  complete: true,
};

type Handler = unknown;

const DEFAULTS: Record<string, Handler> = {
  get_settings: READY_SETTINGS,
  get_mode: "real",
  get_setup: COMPLETE_SETUP,
  check_for_update: null,
  log_error: undefined,
};

/**
 * Answers `invoke` by command name. Commands the test did not list get the
 * defaults above (a set-up profile in real mode); anything else is rejected,
 * so a forgotten mock shows up as an error rather than a silent `undefined`.
 * A handler may be a function of the call's arguments.
 */
export function mockCommands(handlers: Record<string, Handler> = {}): void {
  const table: Record<string, Handler> = { ...DEFAULTS, ...handlers };
  invoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    const handler: unknown = cmd in table ? table[cmd] : rejected(`unmocked command: ${cmd}`);
    const result =
      typeof handler === "function"
        ? (handler as (a?: Record<string, unknown>) => unknown)(args)
        : handler;
    // Tauri rejects with the command's error string, not an Error object.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    return result instanceof Rejected ? Promise.reject(result.reason) : Promise.resolve(result);
  });
}

/** Returned by a handler to make that command reject with `reason`. */
export class Rejected {
  constructor(readonly reason: string) {}
}

export function rejected(reason: string): Rejected {
  return new Rejected(reason);
}
