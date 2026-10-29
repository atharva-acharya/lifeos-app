import { vi } from "vitest";

/** Shared mocks for the Tauri bridge; tests set `invoke` results per case. */
export const invoke = vi.fn();
export const listen = vi.fn(() => Promise.resolve(() => undefined));
