//! Commands the UI may call. Each one is listed in `build.rs` and granted
//! explicitly in `capabilities/default.json`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::applications::{self, Cache};
use crate::diagnostics::{self, Diagnostics};
use crate::fitness::{self, Fitness};
use crate::google::{self, GoogleConfig};
use crate::health::{self, Health, HealthState};
use crate::jobs::{self, Jobs};
use crate::live::{self, LiveState, Mode};
use crate::onboarding::{self, Setup};
use crate::projects::{self, Projects};
use crate::sample;
use crate::settings::{self, Settings};
use crate::today::{self, Today};
use crate::updates::{self, Pending, UpdateInfo};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub vault_path: Option<String>,
    pub health_path: Option<String>,
    pub google: GoogleView,
    pub auto_update: bool,
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
            health_path: s.health_path.map(|p| p.to_string_lossy().into_owned()),
            google,
            auto_update: s.auto_update.unwrap_or(true),
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
pub async fn choose_vault_folder(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<SettingsView, String> {
    let _switching = state.switching().await;
    // Choosing a real folder leaves sample data first. Leaving never fails.
    if state.mode() == Mode::Sample {
        leave_sample(&app, &state);
    }
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
        live::start(&app, &vault)?;
    }
    Ok(current.into())
}

/// Opens the native folder picker for the Health Auto Export folder.
/// Returns the new settings, or the current ones if the picker was cancelled.
#[tauri::command]
pub async fn choose_health_folder(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<SettingsView, String> {
    state.require_real()?;
    let dir = config_dir(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Choose your Health Auto Export folder")
            .pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;

    // Sample data may have been turned on while the picker was open.
    state.require_real()?;
    let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
    if let Some(folder) = picked {
        let folder = settings::validate_health_folder(&folder).map_err(|e| e.to_string())?;
        current.health_path = Some(folder);
        settings::save(&dir, &current).map_err(|e| e.to_string())?;
        app.state::<HealthState>().clear();
    }
    Ok(current.into())
}

/// Forgets the Health folder. The folder itself is never touched.
#[tauri::command]
pub async fn clear_health_folder(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<SettingsView, String> {
    state.require_real()?;
    let dir = config_dir(&app)?;
    // Settings are files; keep that off the UI thread. Clearing bumps the
    // generation, so an import still running cannot bring the folder back.
    tauri::async_runtime::spawn_blocking(move || {
        let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
        current.health_path = None;
        settings::save(&dir, &current).map_err(|e| e.to_string())?;
        app.state::<HealthState>().clear();
        Ok(current.into())
    })
    .await
    .map_err(|e| e.to_string())?
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
    state: tauri::State<'_, LiveState>,
    client_id: String,
    client_secret: String,
    sheet_id: String,
) -> Result<SettingsView, String> {
    state.require_real()?;
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
pub async fn connect_google(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<SettingsView, String> {
    state.require_real()?;
    let config = google_config(&app)?;
    google::connect(&config).await.map_err(|e| e.to_string())?;
    // Sample data may have been turned on while the browser sign-in was open.
    state.require_real()?;
    get_settings(app)
}

/// Revokes and forgets the Google token and the saved copy of the Sheet.
/// If Google could not be told, says so: the token is gone locally but
/// stays valid until the owner removes the app's access in their account.
#[tauri::command]
pub async fn disconnect_google(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<SettingsView, String> {
    state.require_real()?;
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

pub(crate) fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
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
pub fn get_applications(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<ApplicationsView, String> {
    // Sample data brings its own in-memory synthetic copy; the real cache and
    // Google are never read (the copy is briefly absent while a rebuild runs).
    if state.mode() == Mode::Sample {
        return Ok(ApplicationsView {
            configured: false,
            connected: false,
            cache: state.sample_applications(),
            error: None,
        });
    }
    applications_view(&app, None)
}

/// Fetches the Sheet now and updates the saved copy. Failures keep the old
/// copy and are reported alongside it.
#[tauri::command]
pub async fn refresh_applications(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<ApplicationsView, String> {
    state.require_real()?;
    let config = match google_config(&app) {
        Ok(c) => c,
        Err(e) => return applications_view(&app, Some(e)),
    };
    let fetched = google::fetch_sheet(&config).await;
    // Sample data may have been turned on during the fetch: write nothing and
    // never hand real rows to a UI that is showing sample data.
    state.require_real()?;
    let error = match fetched {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum FitnessResponse {
    NoVault,
    Ready { fitness: Box<Fitness> },
}

/// Weight, steps, protein, workouts and lift progress, with the 90-day
/// window ending on `date` (the owner's local date, YYYY-MM-DD).
#[tauri::command]
pub fn get_fitness(
    state: tauri::State<'_, LiveState>,
    date: String,
) -> Result<FitnessResponse, String> {
    if !crate::vault::note::is_iso_date(&date) {
        return Err("date must look like 2026-10-29".to_owned());
    }
    match state.with_index(|index| fitness::fitness(index, &date)) {
        None => Ok(FitnessResponse::NoVault),
        Some(result) => result
            .map(|fitness| FitnessResponse::Ready {
                fitness: Box::new(fitness),
            })
            .map_err(|e| e.to_string()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum ProjectsResponse {
    NoVault,
    Ready { projects: Box<Projects> },
}

/// Project trackers: steps, progress, next step and log. Takes no arguments,
/// so nothing from the UI reaches the vault.
#[tauri::command]
pub fn get_projects(state: tauri::State<'_, LiveState>) -> Result<ProjectsResponse, String> {
    match state.with_index(projects::projects) {
        None => Ok(ProjectsResponse::NoVault),
        Some(result) => result
            .map(|projects| ProjectsResponse::Ready {
                projects: Box::new(projects),
            })
            .map_err(|e| e.to_string()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum HealthResponse {
    /// No Health folder chosen yet.
    NotConfigured,
    Ready {
        health: Box<Health>,
    },
}

/// Which folder `get_health` reads. Sample data reads only its own synthetic
/// folder, and the owner's configured folder is not even looked up
/// (threat model T23); in real mode it comes from settings.
fn health_folder(
    mode: Mode,
    sample_data_dir: impl FnOnce() -> Result<PathBuf, String>,
    configured: impl FnOnce() -> Result<Option<PathBuf>, String>,
) -> Result<Option<PathBuf>, String> {
    match mode {
        Mode::Sample => Ok(Some(sample::health_dir(&sample_data_dir()?))),
        Mode::Real => configured(),
    }
}

/// Apple Health data from the export folder, with the 90-day window ending
/// on `date` (the owner's local date, YYYY-MM-DD) and `now_ms` the current
/// time. The folder comes from settings, never from the UI. Works without a
/// vault; the vault then adds nothing (default goals, no vault workouts).
#[tauri::command]
pub async fn get_health(
    app: AppHandle,
    date: String,
    now_ms: i64,
) -> Result<HealthResponse, String> {
    if !crate::vault::note::is_iso_date(&date) || crate::fitness::shift_days(&date, 0) != date {
        return Err("date must look like 2026-10-29".to_owned());
    }
    let mode = app.state::<LiveState>().mode();
    let Some(folder) = health_folder(
        mode,
        || cache_dir(&app),
        || {
            let dir = config_dir(&app)?;
            Ok(settings::load(&dir).map_err(|e| e.to_string())?.health_path)
        },
    )?
    else {
        return Ok(HealthResponse::NotConfigured);
    };
    // Opening an iCloud placeholder can download it, so keep this off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let imported = app
            .state::<HealthState>()
            .load(&folder)
            .map_err(|e| format!("the Health folder could not be read: {}", e.kind()))?;
        // The mode changed while the import ran: never hand data from the
        // other side to a UI that has switched.
        if app.state::<LiveState>().mode() != mode {
            return Err(live::SAMPLE_REFUSED.to_owned());
        }
        let view = app
            .state::<LiveState>()
            .with_index(|index| health::health(&imported, Some(index), &date, now_ms))
            .unwrap_or_else(|| health::health(&imported, None, &date, now_ms))
            .map_err(|e| e.to_string())?;
        Ok(HealthResponse::Ready {
            health: Box::new(view),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Records a UI error in the local log; nothing is sent anywhere.
#[tauri::command]
pub fn log_error(app: AppHandle, message: String) -> Result<(), String> {
    diagnostics::append(&cache_dir(&app)?, applications::now_ms(), "ui", &message)
        .map_err(|e| e.to_string())
}

/// App version, OS and the newest log entries, for "Copy diagnostics".
#[tauri::command]
pub fn get_diagnostics(app: AppHandle) -> Result<Diagnostics, String> {
    Ok(Diagnostics {
        version: app.package_info().version.to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        log: diagnostics::tail(&cache_dir(&app)?, 50),
    })
}

/// Turns the start-up update check on or off.
#[tauri::command]
pub fn set_auto_update(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
    enabled: bool,
) -> Result<SettingsView, String> {
    state.require_real()?;
    let dir = config_dir(&app)?;
    let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
    current.auto_update = Some(enabled);
    settings::save(&dir, &current).map_err(|e| e.to_string())?;
    Ok(current.into())
}

/// Asks GitHub Releases whether a newer signed version exists.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<Option<UpdateInfo>, String> {
    updates::check(&app, &pending).await
}

/// Installs the update the owner was shown (`version`) and restarts the app.
#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    pending: tauri::State<'_, Pending>,
    version: String,
) -> Result<(), String> {
    updates::install(&app, &pending, &version).await
}

fn setup_view(app: &AppHandle, state: &LiveState) -> Result<Setup, String> {
    let dir = config_dir(app)?;
    let current = settings::load(&dir).map_err(|e| e.to_string())?;
    let connected = google::is_connected();
    // In sample mode the demo index must not colour the owner's checklist.
    if state.mode() == Mode::Sample {
        return Ok(onboarding::compute(&current, connected, None));
    }
    Ok(state
        .with_index(|index| onboarding::compute(&current, connected, Some(index)))
        .unwrap_or_else(|| onboarding::compute(&current, connected, None)))
}

/// The first-run checklist, computed from settings and the index.
#[tauri::command]
pub fn get_setup(app: AppHandle, state: tauri::State<'_, LiveState>) -> Result<Setup, String> {
    setup_view(&app, &state)
}

fn change_onboarding(
    app: &AppHandle,
    state: &LiveState,
    change: impl FnOnce(&mut settings::Onboarding) -> Result<(), onboarding::OnboardingError>,
) -> Result<Setup, String> {
    state.require_real()?;
    let dir = config_dir(app)?;
    let mut current = settings::load(&dir).map_err(|e| e.to_string())?;
    change(&mut current.onboarding).map_err(|e| e.to_string())?;
    settings::save(&dir, &current).map_err(|e| e.to_string())?;
    setup_view(app, state)
}

/// Marks a checklist item as skipped (anything but the vault folder).
#[tauri::command]
pub fn skip_setup_item(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
    id: String,
) -> Result<Setup, String> {
    change_onboarding(&app, &state, |o| onboarding::skip(o, &id))
}

/// Puts a skipped checklist item back.
#[tauri::command]
pub fn unskip_setup_item(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
    id: String,
) -> Result<Setup, String> {
    change_onboarding(&app, &state, |o| onboarding::unskip(o, &id))
}

/// Hides the setup card on Today; the checklist stays in Settings.
#[tauri::command]
pub fn dismiss_setup(app: AppHandle, state: tauri::State<'_, LiveState>) -> Result<Setup, String> {
    change_onboarding(&app, &state, |o| {
        o.dismissed = true;
        Ok(())
    })
}

/// Whether the app is showing the owner's vault or the sample data.
#[tauri::command]
pub fn get_mode(state: tauri::State<'_, LiveState>) -> Mode {
    state.mode()
}

/// Turns sample data on, with dates relative to `date` (the owner's local date).
#[tauri::command]
pub async fn enter_sample_mode(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
    date: String,
) -> Result<Mode, String> {
    let _switching = state.switching().await;
    sample::parse_date(&date).map_err(|e| e.to_string())?;
    let data = cache_dir(&app)?;
    // Already in sample mode: close the old index but keep refusing like
    // sample mode while the files are rebuilt (never pass through real mode).
    state.begin_rebuild();
    app.state::<HealthState>().clear();
    let built = sample::applications(&date)
        .and_then(|apps| sample::build(&data, &date).map(|(v, i)| (v, i, apps)));
    match built {
        Ok((vault, index, applications)) => {
            state.install_sample(vault, index, applications);
            let _ = app.emit(live::INDEX_UPDATED, ());
            Ok(Mode::Sample)
        }
        Err(e) => {
            // Back to the owner's own profile, with the real vault reopened.
            leave_sample(&app, &state);
            Err(e.to_string())
        }
    }
}

/// Closes sample mode: drops the sample index, deletes the sample folder and
/// reopens the owner's vault if one is set.
/// Never fails: a cleanup problem is logged and the real vault is reopened
/// regardless (leftovers are removed again at the next start).
fn leave_sample(app: &AppHandle, state: &LiveState) {
    state.clear();
    app.state::<HealthState>().clear();
    if let Ok(dir) = cache_dir(app)
        && let Err(e) = sample::cleanup(&dir)
    {
        let _ = diagnostics::append(
            &dir,
            applications::now_ms(),
            "sample",
            &format!("could not remove the sample data: {e}"),
        );
    }
    let vault = config_dir(app)
        .ok()
        .and_then(|dir| settings::load(&dir).ok())
        .and_then(|s| s.vault_path)
        .filter(|p| settings::validate_vault(p).is_ok());
    if let Some(vault) = vault {
        // The vault was fine at start-up; an indexing hiccup should not trap
        // the owner in sample mode.
        let _ = live::start(app, &vault);
    }
}

#[tauri::command]
pub async fn exit_sample_mode(
    app: AppHandle,
    state: tauri::State<'_, LiveState>,
) -> Result<Mode, String> {
    let _switching = state.switching().await;
    leave_sample(&app, &state);
    Ok(Mode::Real)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn sample_mode_never_looks_up_the_owners_health_folder() {
        let folder = health_folder(
            Mode::Sample,
            || Ok(PathBuf::from("data")),
            || panic!("the configured Health folder was read in sample mode"),
        )
        .expect("folder");
        assert_eq!(folder, Some(sample::health_dir(Path::new("data"))));
        assert!(
            folder
                .expect("folder")
                .starts_with(sample::sample_dir(Path::new("data")))
        );
    }

    #[test]
    fn real_mode_uses_the_configured_folder_or_none() {
        let set = health_folder(
            Mode::Real,
            || panic!("sample folder used in real mode"),
            || Ok(Some(PathBuf::from("health"))),
        );
        assert_eq!(set, Ok(Some(PathBuf::from("health"))));
        let unset = health_folder(Mode::Real, || panic!("unused"), || Ok(None));
        assert_eq!(unset, Ok(None));
    }
}
