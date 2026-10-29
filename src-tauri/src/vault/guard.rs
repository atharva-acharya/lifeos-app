//! Path guard (ADR 0003 §2, threat model T1). Every vault path the UI sends
//! is relative; this turns it into an absolute path that is proven to stay
//! inside the vault root, or refuses it.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// Largest note the app will read (threat model T6).
pub const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum GuardError {
    #[error("path is empty")]
    Empty,
    #[error("path must be relative to the vault")]
    NotRelative,
    #[error("path may not contain '..', '.' or a drive or device prefix")]
    BadComponent,
    #[error("path may not contain ':' (alternate data streams)")]
    StreamOrDrive,
    #[error("only Markdown (.md) notes can be opened")]
    NotMarkdown,
    #[error("path goes through a link or junction")]
    Reparse,
    #[error("path leaves the vault")]
    Escapes,
    #[error("note is larger than 2 MB")]
    TooLarge,
    #[error("note not found")]
    NotFound,
    #[error("could not access the note: {0}")]
    Io(String),
}

/// Checks the shape of a vault-relative path without touching the disk.
pub fn check_relative(rel: &str) -> Result<PathBuf, GuardError> {
    if rel.trim().is_empty() {
        return Err(GuardError::Empty);
    }
    if rel.contains(':') {
        return Err(GuardError::StreamOrDrive);
    }
    if rel.starts_with(['/', '\\']) {
        return Err(GuardError::NotRelative);
    }
    let path = Path::new(rel);
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_string_lossy();
                // Windows silently strips trailing dots and spaces, which can alias names.
                if part.ends_with(['.', ' ']) {
                    return Err(GuardError::BadComponent);
                }
            }
            Component::ParentDir | Component::CurDir | Component::Prefix(_) => {
                return Err(GuardError::BadComponent);
            }
            Component::RootDir => return Err(GuardError::NotRelative),
        }
    }
    let is_md = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !is_md {
        return Err(GuardError::NotMarkdown);
    }
    Ok(path.to_path_buf())
}

/// Resolves a vault-relative note path to an absolute one inside `root`.
/// `root` must already be canonical (see `settings::validate_vault`).
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, GuardError> {
    let rel = check_relative(rel)?;
    let mut current = root.to_path_buf();
    for component in rel.components() {
        current.push(component);
        let meta = fs::symlink_metadata(&current).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => GuardError::NotFound,
            _ => GuardError::Io(e.kind().to_string()),
        })?;
        if meta.file_type().is_symlink() || is_reparse_point(&meta) {
            return Err(GuardError::Reparse);
        }
    }
    let canonical = fs::canonicalize(&current).map_err(|e| GuardError::Io(e.kind().to_string()))?;
    let canonical_root =
        fs::canonicalize(root).map_err(|e| GuardError::Io(e.kind().to_string()))?;
    if !canonical.starts_with(&canonical_root) {
        return Err(GuardError::Escapes);
    }
    let len = fs::metadata(&current)
        .map_err(|e| GuardError::Io(e.kind().to_string()))?
        .len();
    if len > MAX_NOTE_BYTES {
        return Err(GuardError::TooLarge);
    }
    Ok(current)
}

#[cfg(windows)]
pub(crate) fn is_reparse_point(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
pub(crate) fn is_reparse_point(_meta: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn accepts_plain_note_paths() {
        assert!(check_relative("Daily/2026-10-29.md").is_ok());
        assert!(check_relative(r"Jobs\Companies\Acme.MD").is_ok());
        assert!(check_relative("Life OS note with spaces.md").is_ok());
    }

    #[test]
    fn refuses_traversal_and_absolute_paths() {
        assert_eq!(
            check_relative("../secret.md"),
            Err(GuardError::BadComponent)
        );
        assert_eq!(
            check_relative(r"Daily\..\..\x.md"),
            Err(GuardError::BadComponent)
        );
        assert_eq!(check_relative("./x.md"), Err(GuardError::BadComponent));
        assert_eq!(check_relative("/etc/x.md"), Err(GuardError::NotRelative));
        assert_eq!(
            check_relative(r"\Windows\x.md"),
            Err(GuardError::NotRelative)
        );
    }

    #[test]
    fn refuses_drive_device_unc_and_streams() {
        assert_eq!(check_relative(r"C:\x.md"), Err(GuardError::StreamOrDrive));
        assert_eq!(check_relative("C:x.md"), Err(GuardError::StreamOrDrive));
        assert_eq!(
            check_relative(r"\\server\share\x.md"),
            Err(GuardError::NotRelative)
        );
        assert_eq!(
            check_relative(r"\\?\C:\x.md"),
            Err(GuardError::StreamOrDrive)
        );
        assert_eq!(
            check_relative("note.md:hidden"),
            Err(GuardError::StreamOrDrive)
        );
    }

    #[test]
    fn refuses_non_markdown_and_aliasing_names() {
        assert_eq!(check_relative("x.txt"), Err(GuardError::NotMarkdown));
        assert_eq!(check_relative("x.md.exe"), Err(GuardError::NotMarkdown));
        assert_eq!(check_relative("Daily"), Err(GuardError::NotMarkdown));
        assert_eq!(check_relative("x.md."), Err(GuardError::BadComponent));
        assert_eq!(check_relative("dir /x.md"), Err(GuardError::BadComponent));
        assert_eq!(check_relative("  "), Err(GuardError::Empty));
    }

    #[test]
    fn resolves_inside_the_vault() {
        let vault = tempfile::tempdir().expect("temp dir");
        fs::create_dir(vault.path().join("Daily")).expect("mkdir");
        fs::write(vault.path().join("Daily/2026-10-29.md"), "x").expect("write");
        let got = resolve(vault.path(), "Daily/2026-10-29.md").expect("resolves");
        assert!(got.ends_with("2026-10-29.md"));
    }

    #[test]
    fn missing_note_is_not_found() {
        let vault = tempfile::tempdir().expect("temp dir");
        assert_eq!(resolve(vault.path(), "nope.md"), Err(GuardError::NotFound));
    }

    #[test]
    fn oversized_note_is_refused() {
        let vault = tempfile::tempdir().expect("temp dir");
        let big = vec![b'a'; usize::try_from(MAX_NOTE_BYTES).expect("fits") + 1];
        fs::write(vault.path().join("big.md"), big).expect("write");
        assert_eq!(resolve(vault.path(), "big.md"), Err(GuardError::TooLarge));
    }

    #[cfg(windows)]
    #[test]
    fn junction_out_of_the_vault_is_refused() {
        let outside = tempfile::tempdir().expect("temp dir");
        fs::write(outside.path().join("secret.md"), "secret").expect("write");
        let vault = tempfile::tempdir().expect("temp dir");
        let link = vault.path().join("Linked");
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .expect("run mklink");
        assert!(out.status.success(), "mklink failed");
        assert_eq!(
            resolve(vault.path(), "Linked/secret.md"),
            Err(GuardError::Reparse)
        );
    }

    proptest! {
        /// Whatever the input, an accepted path never climbs out or names a drive.
        #[test]
        fn accepted_paths_are_always_plain(s in r"[a-zA-Z0-9 ._:/\\?-]{0,40}") {
            if let Ok(p) = check_relative(&s) {
                prop_assert!(p.components().all(|c| matches!(c, Component::Normal(_))));
                prop_assert!(!s.contains(':'));
            }
        }

        #[test]
        fn dot_dot_is_always_refused(prefix in "[a-z]{0,8}", suffix in "[a-z]{1,8}") {
            let path = format!("{prefix}/../{suffix}.md");
            prop_assert!(check_relative(&path).is_err());
        }
    }
}
