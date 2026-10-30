//! Local app settings (ADR 0003 §6). Stored in the app config folder,
//! never in the vault or the repository.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub vault_path: Option<PathBuf>,
    #[serde(default)]
    pub google: Option<crate::google::GoogleConfig>,
    /// Check GitHub for signed updates at start-up (default on; owner can
    /// switch it off in Settings).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_update: Option<bool>,
    /// Which setup steps the owner skipped and whether the Today card was dismissed.
    #[serde(default, skip_serializing_if = "Onboarding::is_default")]
    pub onboarding: Onboarding,
}

/// First-run checklist choices kept in `settings.json`.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Onboarding {
    #[serde(default)]
    pub skipped: Vec<String>,
    #[serde(default)]
    pub dismissed: bool,
}

impl Onboarding {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("could not read or write settings: {0}")]
    Io(#[from] io::Error),
    #[error("settings file is not valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("the chosen vault is not a folder")]
    NotAFolder,
    #[error("the chosen vault is a link or junction; pick the real folder")]
    Reparse,
}

/// Reads settings from `dir`. A missing file means defaults.
pub fn load(dir: &Path) -> Result<Settings, SettingsError> {
    match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(text) => Ok(serde_json::from_str(&text)?),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e.into()),
    }
}

/// Writes settings atomically: temp file in the same folder, then rename.
pub fn save(dir: &Path, settings: &Settings) -> Result<(), SettingsError> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(&tmp, dir.join(FILE_NAME))?;
    Ok(())
}

/// Checks a folder chosen as the vault root and returns its canonical path.
pub fn validate_vault(path: &Path) -> Result<PathBuf, SettingsError> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() || is_reparse_point(&meta) {
        return Err(SettingsError::Reparse);
    }
    if !meta.is_dir() {
        return Err(SettingsError::NotAFolder);
    }
    Ok(readable_canonical(path)?)
}

#[cfg(windows)]
fn is_reparse_point(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_meta: &fs::Metadata) -> bool {
    false
}

/// Canonicalises without the verbatim prefix Windows adds, so paths stay readable.
fn readable_canonical(path: &Path) -> io::Result<PathBuf> {
    let canonical = fs::canonicalize(path)?;
    let text = canonical.to_string_lossy();
    Ok(match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => canonical,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(load(dir.path()).expect("load"), Settings::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().expect("temp dir");
        let settings = Settings {
            vault_path: Some(PathBuf::from(r"D:\Notes\Life OS")),
            google: None,
            auto_update: Some(false),
            onboarding: Onboarding {
                skipped: vec!["plan".to_owned()],
                dismissed: true,
            },
        };
        save(dir.path(), &settings).expect("save");
        assert_eq!(load(dir.path()).expect("load"), settings);
        assert!(!dir.path().join("settings.json.tmp").exists());
    }

    #[test]
    fn corrupt_file_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join(FILE_NAME), "{ not json").expect("write");
        assert!(matches!(load(dir.path()), Err(SettingsError::Parse(_))));
    }

    #[test]
    fn folder_is_accepted_and_canonicalised() {
        let dir = tempfile::tempdir().expect("temp dir");
        let vault = dir.path().join("Life OS");
        fs::create_dir(&vault).expect("mkdir");
        let got = validate_vault(&vault.join("..").join("Life OS")).expect("valid");
        assert!(got.ends_with("Life OS"));
        assert!(!got.to_string_lossy().contains(".."));
        assert!(!got.to_string_lossy().starts_with(r"\\?\"));
    }

    #[test]
    fn file_is_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        let file = dir.path().join("note.md");
        fs::write(&file, "x").expect("write");
        assert!(matches!(
            validate_vault(&file),
            Err(SettingsError::NotAFolder)
        ));
    }

    #[test]
    fn missing_folder_is_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(matches!(
            validate_vault(&dir.path().join("nope")),
            Err(SettingsError::Io(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn junction_is_rejected() {
        let dir = tempfile::tempdir().expect("temp dir");
        let real = dir.path().join("real");
        let link = dir.path().join("link");
        fs::create_dir(&real).expect("mkdir");
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&real)
            .output()
            .expect("run mklink");
        assert!(out.status.success(), "mklink failed");
        assert!(matches!(validate_vault(&link), Err(SettingsError::Reparse)));
    }
}
