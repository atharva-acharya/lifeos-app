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
