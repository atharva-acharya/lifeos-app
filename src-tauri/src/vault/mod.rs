//! Read-only access to the vault (ADR 0003). The index (task 9) and the
//! Today page build on `scan`.

pub mod guard;
pub mod note;

use std::fs;
use std::path::Path;

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

/// Reads every Markdown note under `root`. Links, junctions, hidden folders,
/// `old/` and oversized files are skipped; parse errors are recorded, never fatal.
pub fn scan(root: &Path) -> std::io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    walk(root, "", &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<Entry>) -> std::io::Result<()> {
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
            out.push(read_entry(&item.path(), rel, meta.len()));
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
