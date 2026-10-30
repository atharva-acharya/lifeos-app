//! Commands the UI may call. Each one is listed in `build.rs` and granted
//! explicitly in `capabilities/default.json`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::applications::{self, Cache};
use crate::google::{self, GoogleConfig};
use crate::jobs::{self, Jobs};
use crate::live::LiveState;
use crate::settings::{self, Settings};
use crate::today::{self, Today};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub vault_path: Option<String>,
    pub google: GoogleView,
}

/// What the UI may know about the Google setup. The client secret and
/// tokens never leave the Rust core.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleView {
    pub client_id: String,
    pub sheet_id: String,
    pub has_secret: bool,
    pub configured: bool,
    pub connected: bool,
}

impl From<Settings> for SettingsView {
    fn from(s: Settings) -> Self {
        let google = s.google.map_or_else(GoogleView::default, |g| GoogleView {
            configured: g.is_complete(),
            has_secret: !g.client_secret.is_empty(),
            client_id: g.client_id,
            sheet_id: g.sheet_id,
            connected: google::is_connected(),
        });
        Self {
            vault_path: s.vault_path.map(|p| p.to_string_lossy().into_owned()),
            google,
        }
    }
}

/// Debug builds only: `LIFEOS_DATA_DIR` points settings and the index at a
/// throwaway folder so end-to-end tests never touch the owner's real data.
/// Release builds ignore it.
pub(crate) fn test_data_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        std::env::var_os("LIFEOS_DATA_DIR").map(PathBuf::from)
    } else {
        None
    }
}

pub(crate) fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match test_data_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_config_dir().map_err(|e| e.to_string()),
    }
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

/// Saves the Google client and Sheet details. An empty secret keeps the
/// stored one, so the UI never needs to read it back.
#[tauri::command]
pub fn save_google_config(
    app: AppHandle,
    client_id: String,
    client_secret: String,
    sheet_id: String,
) -> Result<SettingsView, String> {
    let sheet_id = sheet_id.trim().to_owned();
    if !google::valid_sheet_id(&sheet_id) {
        return Err(google::GoogleError::BadSheetId.to_string());
    }
    let client_id = client_id.trim();
    if !google::valid_client_id(client_id) {
        return Err("the client ID should end in .apps.googleusercontent.com".to_owned());
    }
    let secret = client_secret.trim();
    if !secret.is_empty() && !google::valid_client_secret(secret) {
        return Err("the client secret does not look right; copy it again".to_owned());
    }
    let dir = config_dir(&app)?;
    let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
    let previous = current.google.take().unwrap_or_default();
    // A different Sheet: the saved copy belongs to the old one.
    if previous.sheet_id != sheet_id {
        applications::clear(&cache_dir(&app)?).map_err(|e| e.to_string())?;
    }
    // The grant belongs to one client; switching needs a fresh sign-in.
    if google::is_connected() && !previous.client_id.is_empty() && previous.client_id != client_id {
        return Err("disconnect Google before changing the client ID".to_owned());
    }
    current.google = Some(GoogleConfig {
        client_id: client_id.to_owned(),
        client_secret: if secret.is_empty() {
            previous.client_secret
        } else {
            secret.to_owned()
        },
        sheet_id,
    });
    settings::save(&dir, &current).map_err(|e| e.to_string())?;
    Ok(current.into())
}

fn google_config(app: &AppHandle) -> Result<GoogleConfig, String> {
    let dir = config_dir(app)?;
    settings::load(&dir)
        .map_err(|e| e.to_string())?
        .google
        .filter(GoogleConfig::is_complete)
        .ok_or_else(|| google::GoogleError::NotConfigured.to_string())
}

/// Opens Google sign-in in the browser and stores the refresh token.
#[tauri::command]
pub async fn connect_google(app: AppHandle) -> Result<SettingsView, String> {
    let config = google_config(&app)?;
    google::connect(&config).await.map_err(|e| e.to_string())?;
    get_settings(app)
}

/// Revokes and forgets the Google token and the saved copy of the Sheet.
/// If Google could not be told, says so: the token is gone locally but
/// stays valid until the owner removes the app's access in their account.
#[tauri::command]
pub async fn disconnect_google(app: AppHandle) -> Result<SettingsView, String> {
    let revoked = google::disconnect().await.map_err(|e| e.to_string())?;
    applications::clear(&cache_dir(&app)?).map_err(|e| e.to_string())?;
    if !revoked {
        return Err(REVOKE_FAILED.to_owned());
    }
    get_settings(app)
}

pub const REVOKE_FAILED: &str = "Disconnected here, but Google could not be reached to cancel \
    access. Remove Life OS at myaccount.google.com/permissions.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationsView {
    pub configured: bool,
    pub connected: bool,
    pub cache: Option<Cache>,
    /// Set when a refresh failed; the cached copy is still shown.
    pub error: Option<String>,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    match test_data_dir() {
        Some(dir) => Ok(dir),
        None => app.path().app_local_data_dir().map_err(|e| e.to_string()),
    }
}

fn applications_view(app: &AppHandle, error: Option<String>) -> Result<ApplicationsView, String> {
    let configured = google_config(app).is_ok();
    Ok(ApplicationsView {
        configured,
        connected: configured && google::is_connected(),
        cache: applications::load(&cache_dir(app)?),
        error,
    })
}

/// The last saved copy of the Sheet; never touches the network.
#[tauri::command]
pub fn get_applications(app: AppHandle) -> Result<ApplicationsView, String> {
    applications_view(&app, None)
}

/// Fetches the Sheet now and updates the saved copy. Failures keep the old
/// copy and are reported alongside it.
#[tauri::command]
pub async fn refresh_applications(app: AppHandle) -> Result<ApplicationsView, String> {
    let config = match google_config(&app) {
        Ok(c) => c,
        Err(e) => return applications_view(&app, Some(e)),
    };
    let error = match google::fetch_sheet(&config).await {
        Ok(rows) => {
            let (rows, missing_columns) = applications::from_rows(&rows);
            let cache = Cache {
                fetched_at: applications::now_ms(),
                rows,
                missing_columns,
            };
            // Disconnect may have run while the Sheet was loading; it wins.
            if google::is_connected() {
                applications::save(&cache_dir(&app)?, &cache).map_err(|e| e.to_string())?;
            }
            None
        }
        Err(e) => Some(e.to_string()),
    };
    applications_view(&app, error)
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum JobsResponse {
    NoVault,
    Ready { jobs: Box<Jobs> },
}

/// Company pipeline and outreach log from the vault.
#[tauri::command]
pub fn get_jobs(state: tauri::State<'_, LiveState>) -> Result<JobsResponse, String> {
    match state.with_index(jobs::jobs) {
        None => Ok(JobsResponse::NoVault),
        Some(result) => result
            .map(|jobs| JobsResponse::Ready {
                jobs: Box::new(jobs),
            })
            .map_err(|e| e.to_string()),
    }
}
