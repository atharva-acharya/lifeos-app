//! Read-only access to the vault (ADR 0003). The index (task 9) and the
//! Today page build on `scan`.

pub mod guard;
pub mod note;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use guard::{MAX_NOTE_BYTES, is_reparse_point};
use note::Note;

/// Folders the app never reads: Obsidian config, trash, and archived notes.
const SKIP_DIRS: &[&str] = &["old"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Vault-relative path with forward slashes.
    pub path: String,
    pub note: Option<Note>,
    pub error: Option<String>,
}

/// A Markdown file found in the vault, before it is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileInfo {
    /// Vault-relative path with forward slashes.
    pub rel: String,
    pub abs: PathBuf,
    pub len: u64,
    /// Modification time in milliseconds since the Unix epoch.
    pub mtime_ms: i64,
}

/// Lists every Markdown note under `root`. Links, junctions, hidden folders
/// and `old/` are skipped.
pub fn list(root: &Path) -> std::io::Result<Vec<FileInfo>> {
    let mut out = Vec::new();
    walk(root, "", &mut out)?;
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// Reads and parses every note under `root`; parse errors are recorded, never fatal.
pub fn scan(root: &Path) -> std::io::Result<Vec<Entry>> {
    Ok(list(root)?.into_iter().map(|f| read(&f)).collect())
}

/// Reads and parses one listed note.
pub fn read(file: &FileInfo) -> Entry {
    read_entry(&file.abs, file.rel.clone(), file.len)
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<FileInfo>) -> std::io::Result<()> {
    for item in fs::read_dir(dir)? {
        let item = item?;
        let name = item.file_name().to_string_lossy().into_owned();
        let meta = fs::symlink_metadata(item.path())?;
        if meta.file_type().is_symlink() || is_reparse_point(&meta) || name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if meta.is_dir() {
            if !SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name)) {
                walk(&item.path(), &rel, out)?;
            }
        } else if guard::check_relative(&rel).is_ok() {
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .and_then(|d| i64::try_from(d.as_millis()).ok())
                .unwrap_or(0);
            out.push(FileInfo {
                rel,
                abs: item.path(),
                len: meta.len(),
                mtime_ms,
            });
        }
    }
    Ok(())
}

fn read_entry(path: &Path, rel: String, len: u64) -> Entry {
    if len > MAX_NOTE_BYTES {
        return Entry {
            path: rel,
            note: None,
            error: Some(guard::GuardError::TooLarge.to_string()),
        };
    }
    match fs::read_to_string(path) {
        Ok(text) => match note::parse(&text) {
            Ok(note) => Entry {
                path: rel,
                note: Some(note),
                error: None,
            },
            Err(e) => Entry {
                path: rel,
                note: None,
                error: Some(e.to_string()),
            },
        },
        Err(e) => Entry {
            path: rel,
            note: None,
            error: Some(format!("could not read note: {}", e.kind())),
        },
    }
}
