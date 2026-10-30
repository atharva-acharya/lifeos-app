//! Signed auto-update (ADR 0007, threat model T22). The Rust core checks
//! GitHub Releases for `latest.json`; the updater refuses any download whose
//! minisign signature does not match the public key built into the app. The
//! UI gets plain commands, never the updater plugin itself.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Where release builds look for updates (also in tauri.conf.json).
pub const ENDPOINT: &str =
    "https://github.com/atharva-acharya/lifeos-app/releases/latest/download/latest.json";

/// The update found by the last check, waiting for the owner to install it.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// Release notes from GitHub (plain text, may be empty).
    pub notes: String,
}

/// Debug builds only: `LIFEOS_UPDATE_ENDPOINT` points the check at a local
/// test server. Release builds always use [`ENDPOINT`].
fn endpoint() -> Result<Url, String> {
    let custom = cfg!(debug_assertions)
        .then(|| std::env::var("LIFEOS_UPDATE_ENDPOINT").ok())
        .flatten();
    Url::parse(custom.as_deref().unwrap_or(ENDPOINT)).map_err(|e| e.to_string())
}

/// Release notes are shown as text; keep them short.
pub fn short_notes(body: Option<&str>) -> String {
    let text = body.unwrap_or("").trim();
    let mut notes: String = text.chars().take(2_000).collect();
    if text.chars().count() > 2_000 {
        notes.push('…');
    }
    notes
}

/// Owner-facing text for a failed install; a bad signature is said plainly.
pub fn install_error(detail: &str) -> String {
    if detail.to_lowercase().contains("signature") {
        concat!(
            "This update failed its security check and was not installed. ",
            "You are still on your current version."
        )
        .to_owned()
    } else {
        "The update could not be installed. Check your connection and try again.".to_owned()
    }
}

pub async fn check(app: &AppHandle, pending: &Pending) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint()?])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|_| {
        "Could not check for updates. Check your connection and try again.".to_owned()
    })?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: short_notes(u.body.as_deref()),
    });
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(info)
}

/// Downloads, verifies and installs the pending update, then restarts.
pub async fn install(app: &AppHandle, pending: &Pending) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
        .ok_or_else(|| "No update is waiting; check for updates first.".to_owned())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| install_error(&e.to_string()))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_endpoint_is_github_https() {
        let url = Url::parse(ENDPOINT).expect("url");
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(url.path().starts_with("/atharva-acharya/lifeos-app/"));
    }

    #[test]
    fn a_bad_signature_is_explained_plainly() {
        assert!(
            install_error("The signature was created with a different key than the one provided")
                .contains("failed its security check")
        );
        assert!(install_error("connection reset").contains("could not be installed"));
    }

    #[test]
    fn notes_are_trimmed_and_capped() {
        assert_eq!(short_notes(None), "");
        assert_eq!(short_notes(Some("  Fixes  ")), "Fixes");
        let long = "x".repeat(2_100);
        assert_eq!(short_notes(Some(&long)).chars().count(), 2_001);
    }
}
