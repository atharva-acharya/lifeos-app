//! Commands the UI may call. Each one is listed in `build.rs` and granted
//! explicitly in `capabilities/default.json`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::live::LiveState;
use crate::settings::{self, Settings};
use crate::today::{self, Today};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub vault_path: Option<String>,
}

impl From<Settings> for SettingsView {
    fn from(s: Settings) -> Self {
        Self {
            vault_path: s.vault_path.map(|p| p.to_string_lossy().into_owned()),
        }
    }
}

pub(crate) fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<SettingsView, String> {
    let dir = config_dir(&app)?;
    settings::load(&dir)
        .map(Into::into)
        .map_err(|e| e.to_string())
}

/// Opens the native folder picker. Returns the new settings, or the current
/// ones unchanged if the picker was cancelled.
#[tauri::command]
pub async fn choose_vault_folder(app: AppHandle) -> Result<SettingsView, String> {
    let dir = config_dir(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose your Life OS vault folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
    if let Some(folder) = picked {
        let vault = settings::validate_vault(&folder).map_err(|e| e.to_string())?;
        current.vault_path = Some(vault.clone());
        settings::save(&dir, &current).map_err(|e| e.to_string())?;
        crate::live::start(&app, &vault)?;
    }
    Ok(current.into())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum TodayResponse {
    /// No vault chosen yet, or it is still being indexed.
    NoVault,
    Ready {
        today: Box<Today>,
    },
}

/// Today's dashboard for `date` (the owner's local date, YYYY-MM-DD).
#[tauri::command]
pub fn get_today(
    state: tauri::State<'_, LiveState>,
    date: String,
) -> Result<TodayResponse, String> {
    if !crate::vault::note::is_iso_date(&date) {
        return Err("date must look like 2026-10-29".to_owned());
    }
    match state.with_index(|index| today::today(index, &date)) {
        None => Ok(TodayResponse::NoVault),
        Some(result) => result
            .map(|today| TodayResponse::Ready {
                today: Box::new(today),
            })
            .map_err(|e| e.to_string()),
    }
}
