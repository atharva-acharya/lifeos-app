//! Signed auto-update (ADR 0007, threat model T22). The Rust core checks
//! GitHub Releases for `latest.json`; the updater refuses any download whose
//! minisign signature does not match the public key built into the app, or
//! whose signed version differs from the one announced (no downgrades or
//! replays). The UI gets plain commands, never the updater plugin itself.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

/// Where release builds look for updates (also in tauri.conf.json).
pub const ENDPOINT: &str =
    "https://github.com/atharva-acharya/lifeos-app/releases/latest/download/latest.json";
/// Release downloads must come from this repository's GitHub releases.
const DOWNLOAD_PREFIX: &str = "/atharva-acharya/lifeos-app/releases/download/";

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

/// Debug builds only: the end-to-end suite points the check at a local
/// stand-in for GitHub (`LIFEOS_UPDATE_ENDPOINT`) with its own throwaway key
/// (`LIFEOS_UPDATE_PUBKEY`). Release builds ignore both.
fn test_override(name: &str) -> Option<String> {
    cfg!(debug_assertions)
        .then(|| std::env::var(name).ok())
        .flatten()
}

fn endpoint() -> Result<Url, String> {
    let custom = test_override("LIFEOS_UPDATE_ENDPOINT");
    Url::parse(custom.as_deref().unwrap_or(ENDPOINT)).map_err(|e| e.to_string())
}

/// The download must come from where the manifest came from: this
/// repository's GitHub releases over HTTPS (or, in tests, the local server).
pub fn allowed_download(download: &Url, endpoint: &Url) -> bool {
    if endpoint.as_str() == ENDPOINT {
        download.scheme() == "https"
            && download.host_str() == Some("github.com")
            && download.path().starts_with(DOWNLOAD_PREFIX)
    } else {
        download.scheme() == endpoint.scheme()
            && download.host_str() == endpoint.host_str()
            && download.port_or_known_default() == endpoint.port_or_known_default()
    }
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

/// Failures of the signature or signed-version checks, as opposed to
/// network or disk problems.
fn is_security_failure(e: &UpdaterError) -> bool {
    matches!(
        e,
        UpdaterError::Minisign(_)
            | UpdaterError::SignedVersionMismatch { .. }
            | UpdaterError::MissingSignedVersion
            | UpdaterError::SignatureUtf8(_)
            | UpdaterError::Base64(_)
    )
}

/// Owner-facing text for a failed install.
pub fn install_error(security: bool) -> String {
    if security {
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
    let endpoint = endpoint()?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint.clone()])
        .map_err(|e| e.to_string())?;
    if let Some(key) = test_override("LIFEOS_UPDATE_PUBKEY") {
        builder = builder.pubkey(key);
    }
    let found = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|_| {
            "Could not check for updates. Check your connection and try again.".to_owned()
        })?;
    if let Some(update) = &found
        && !allowed_download(&update.download_url, &endpoint)
    {
        *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = None;
        return Err(install_error(true));
    }
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: short_notes(u.body.as_deref()),
    });
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(info)
}

/// Downloads, verifies and installs the pending update, then restarts. Only
/// the version the owner was shown is installed.
pub async fn install(app: &AppHandle, pending: &Pending, version: &str) -> Result<(), String> {
    let update = {
        let mut slot = pending.0.lock().unwrap_or_else(|e| e.into_inner());
        if slot.as_ref().map(|u| u.version.as_str()) != Some(version) {
            return Err("This update is no longer offered; check for updates again.".to_owned());
        }
        slot.take()
            .ok_or_else(|| "No update is waiting; check for updates first.".to_owned())?
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| install_error(is_security_failure(&e)))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).expect("url")
    }

    #[test]
    fn release_endpoint_is_github_https() {
        let url = url(ENDPOINT);
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(url.path().starts_with("/atharva-acharya/lifeos-app/"));
    }

    #[test]
    fn release_downloads_must_be_this_repos_github_releases() {
        let release = url(ENDPOINT);
        let ok = "https://github.com/atharva-acharya/lifeos-app/releases/download/v0.3.0/Life.OS_0.3.0_x64-setup.exe";
        assert!(allowed_download(&url(ok), &release));
        for bad in [
            "http://github.com/atharva-acharya/lifeos-app/releases/download/v0.3.0/a.exe",
            "https://github.com/someone-else/lifeos-app/releases/download/v0.3.0/a.exe",
            "https://github.com.evil.example/atharva-acharya/lifeos-app/releases/download/v1/a.exe",
            "https://evil.example/atharva-acharya/lifeos-app/releases/download/v1/a.exe",
        ] {
            assert!(!allowed_download(&url(bad), &release), "{bad}");
        }
    }

    #[test]
    fn test_downloads_must_come_from_the_test_server() {
        let local = url("http://127.0.0.1:5000/latest.json");
        assert!(allowed_download(
            &url("http://127.0.0.1:5000/fake.exe"),
            &local
        ));
        assert!(!allowed_download(
            &url("http://127.0.0.1:5001/fake.exe"),
            &local
        ));
        assert!(!allowed_download(
            &url("http://evil.example:5000/fake.exe"),
            &local
        ));
    }

    #[test]
    fn security_failures_are_explained_plainly() {
        assert!(install_error(true).contains("failed its security check"));
        assert!(install_error(false).contains("could not be installed"));
        assert!(is_security_failure(&UpdaterError::MissingSignedVersion));
        assert!(is_security_failure(&UpdaterError::SignedVersionMismatch {
            signed: "0.0.1".into(),
            announced: "9.9.9".into(),
        }));
    }

    #[test]
    fn notes_are_trimmed_and_capped() {
        assert_eq!(short_notes(None), "");
        assert_eq!(short_notes(Some("  Fixes  ")), "Fixes");
        let long = "x".repeat(2_100);
        assert_eq!(short_notes(Some(&long)).chars().count(), 2_001);
    }
}
