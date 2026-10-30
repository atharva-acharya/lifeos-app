//! Safe note writing (ADR 0003 §3, §4). A change is written to a hidden temp
//! file in the same folder, flushed, and moved over the note in one step, so
//! a crash never leaves half a note. The note is read again just before the
//! move; if Obsidian changed it in the meantime the write is refused, never
//! merged. Only the inserted line is new: every other byte is kept.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::guard::{self, GuardError, MAX_NOTE_BYTES, is_reparse_point};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WriteError {
    #[error(transparent)]
    Guard(#[from] GuardError),
    #[error("the note changed while saving; nothing was written, try again")]
    Conflict,
    #[error("could not save the note: {0}")]
    Io(String),
}

fn io(e: &std::io::Error) -> WriteError {
    WriteError::Io(e.kind().to_string())
}

/// Longest text kept in one table cell, in characters.
pub const MAX_CELL_CHARS: usize = 200;

/// Makes `text` safe for one Markdown table cell: no pipes, line breaks or
/// control characters, trimmed and clipped.
pub fn cell(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| match c {
            '|' => '/',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    cleaned.trim().chars().take(MAX_CELL_CHARS).collect()
}

/// Adds one row to the first table of the note at `rel`, matching cells to
/// the table's own headers (case-insensitive), so a reordered table stays as
/// the owner arranged it. If the note does not exist it is created from
/// `front_matter` and a table with `columns`. Missing folders are created
/// inside the vault.
pub fn append_row(
    root: &Path,
    rel: &str,
    front_matter: &str,
    columns: &[&str],
    values: &[(&str, String)],
) -> Result<(), WriteError> {
    guard::check_relative(rel)?;
    let parent = ensure_parent(root, rel)?;
    match guard::resolve(root, rel) {
        Ok(path) => {
            let original = read(&path)?;
            let updated = insert_row(&original, columns, values);
            replace(&parent, &path, &original, &updated)
        }
        Err(GuardError::NotFound) => {
            let target = root.join(rel);
            let text = new_note(front_matter, columns, values);
            create(&parent, &target, &text)
        }
        Err(e) => Err(e.into()),
    }
}

/// Creates the folders above `rel` inside `root`, refusing links and
/// junctions on the way. Returns the note's folder.
fn ensure_parent(root: &Path, rel: &str) -> Result<PathBuf, WriteError> {
    let mut current = root.to_path_buf();
    let rel = Path::new(rel);
    if let Some(parent) = rel.parent() {
        for component in parent.components() {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() || is_reparse_point(&meta) {
                        return Err(GuardError::Reparse.into());
                    }
                    if !meta.is_dir() {
                        return Err(WriteError::Io("a file is in the way of a folder".into()));
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&current).map_err(|e| io(&e))?;
                }
                Err(e) => return Err(io(&e)),
            }
        }
    }
    Ok(current)
}

fn read(path: &Path) -> Result<String, WriteError> {
    let bytes = fs::read(path).map_err(|e| io(&e))?;
    if bytes.len() as u64 > MAX_NOTE_BYTES {
        return Err(GuardError::TooLarge.into());
    }
    String::from_utf8(bytes).map_err(|_| WriteError::Io("note is not valid UTF-8".into()))
}

fn hash(text: &str) -> [u8; 32] {
    Sha256::digest(text.as_bytes()).into()
}

/// Writes `text` to a new hidden file in `dir` and returns its path.
fn write_temp(dir: &Path, text: &str) -> Result<PathBuf, WriteError> {
    let name = format!(".lifeos-{:016x}.tmp", rand::random::<u64>());
    let temp = dir.join(name);
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()
    })();
    match result {
        Ok(()) => Ok(temp),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(io(&e))
        }
    }
}

fn replace(dir: &Path, path: &Path, original: &str, updated: &str) -> Result<(), WriteError> {
    if updated.len() as u64 > MAX_NOTE_BYTES {
        return Err(GuardError::TooLarge.into());
    }
    let temp = write_temp(dir, updated)?;
    let unchanged = read(path).map(|now| hash(&now) == hash(original));
    if unchanged != Ok(true) {
        let _ = fs::remove_file(&temp);
        return Err(unchanged.err().unwrap_or(WriteError::Conflict));
    }
    fs::rename(&temp, path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        io(&e)
    })
}

/// Creates a note that must not exist yet. A hard link fails if the name is
/// taken, so a note Obsidian created a moment ago is never overwritten.
fn create(dir: &Path, path: &Path, text: &str) -> Result<(), WriteError> {
    let temp = write_temp(dir, text)?;
    let linked = fs::hard_link(&temp, path);
    let _ = fs::remove_file(&temp);
    match linked {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(WriteError::Conflict),
        Err(e) => Err(io(&e)),
    }
}

fn row_line(headers: &[String], values: &[(&str, String)]) -> String {
    let cells: Vec<String> = headers
        .iter()
        .map(|h| {
            values
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(h))
                .map(|(_, v)| cell(v))
                .unwrap_or_default()
        })
        .collect();
    format!("| {} |", cells.join(" | "))
}

fn table_block(columns: &[&str], values: &[(&str, String)], nl: &str) -> String {
    let headers: Vec<String> = columns.iter().map(|c| (*c).to_owned()).collect();
    format!(
        "| {} |{nl}| {} |{nl}{}{nl}",
        columns.join(" | "),
        vec!["---"; columns.len()].join(" | "),
        row_line(&headers, values)
    )
}

fn new_note(front_matter: &str, columns: &[&str], values: &[(&str, String)]) -> String {
    format!(
        "---\n{}\n---\n\n{}",
        front_matter.trim_end(),
        table_block(columns, values, "\n")
    )
}

/// Returns `text` with a row added after the last row of its first table, or
/// with a new table appended if it has none. Line endings follow the note.
pub fn insert_row(text: &str, columns: &[&str], values: &[(&str, String)]) -> String {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let (front, _) = super::note::split_front_matter(text);
    // Skip the front matter so a `|` there is never taken for a table.
    let body_start = front.map_or(0, |f| {
        // `f` is a slice of `text`; skip it and the closing `---` line.
        let after = f.as_ptr() as usize - text.as_ptr() as usize + f.len();
        after
            + text[after..]
                .find('\n')
                .map_or(text.len() - after, |i| i + 1)
    });

    let mut offset = body_start;
    let mut table: Option<(usize, String)> = None; // (end offset, header line)
    for line in text[body_start..].split_inclusive('\n') {
        let is_row = line.trim_start().starts_with('|');
        if let Some((end, _)) = table.as_mut() {
            if !is_row {
                break;
            }
            *end = offset + line.len();
        } else if is_row {
            table = Some((offset + line.len(), line.trim().to_owned()));
        }
        offset += line.len();
    }

    match table {
        Some((end, header)) => {
            let headers: Vec<String> = header
                .trim_matches('|')
                .split('|')
                .map(|h| h.trim().to_owned())
                .collect();
            let mut out = String::with_capacity(text.len() + 128);
            out.push_str(&text[..end]);
            if !out.ends_with('\n') {
                out.push_str(nl);
            }
            out.push_str(&row_line(&headers, values));
            out.push_str(nl);
            out.push_str(&text[end..]);
            out
        }
        None => {
            let mut out = text.to_owned();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push_str(nl);
            }
            if !out.is_empty() {
                out.push_str(nl);
            }
            out.push_str(&table_block(columns, values, nl));
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLS: &[&str] = &["Date", "Description", "Amount"];

    fn vals() -> Vec<(&'static str, String)> {
        vec![
            ("Date", "2026-10-30".to_owned()),
            ("Description", "Coffee".to_owned()),
            ("Amount", "-3.20".to_owned()),
        ]
    }

    #[test]
    fn cells_lose_pipes_breaks_and_length() {
        assert_eq!(cell(" a|b\r\nc\t "), "a/b  c");
        assert_eq!(cell(&"x".repeat(500)).chars().count(), MAX_CELL_CHARS);
    }

    #[test]
    fn adds_a_row_after_the_table_and_keeps_every_other_byte() {
        let text = "---\ntype: ledger\nnote: keep | me\n---\n\nIntro.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-01 | Rent | -950.00 |\n\nTail text.\n";
        let out = insert_row(text, COLS, &vals());
        assert_eq!(
            out,
            "---\ntype: ledger\nnote: keep | me\n---\n\nIntro.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-01 | Rent | -950.00 |\n| 2026-10-30 | Coffee | -3.20 |\n\nTail text.\n"
        );
    }

    #[test]
    fn follows_the_tables_own_column_order_and_line_endings() {
        let text = "---\r\ntype: ledger\r\n---\r\n| Amount | Note | Date |\r\n|---|---|---|\r\n";
        let out = insert_row(text, COLS, &vals());
        assert_eq!(
            out,
            "---\r\ntype: ledger\r\n---\r\n| Amount | Note | Date |\r\n|---|---|---|\r\n| -3.20 |  | 2026-10-30 |\r\n"
        );
    }

    #[test]
    fn appends_a_table_when_there_is_none() {
        let out = insert_row("---\ntype: ledger\n---\nNo table yet.", COLS, &vals());
        assert_eq!(
            out,
            "---\ntype: ledger\n---\nNo table yet.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
    }

    #[test]
    fn creates_the_note_and_folders_then_appends() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        let rel = "Money/Ledger/2026-10.md";
        append_row(&root, rel, "type: ledger\nmonth: 2026-10", COLS, &vals()).expect("create");
        append_row(&root, rel, "unused", COLS, &vals()).expect("append");
        let text = fs::read_to_string(root.join(rel)).expect("read");
        assert_eq!(
            text,
            "---\ntype: ledger\nmonth: 2026-10\n---\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-30 | Coffee | -3.20 |\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
        let names: Vec<_> = fs::read_dir(root.join("Money/Ledger"))
            .expect("list")
            .map(|e| e.expect("entry").file_name())
            .collect();
        assert_eq!(names.len(), 1, "no temp files left behind: {names:?}");
    }

    #[test]
    fn refuses_paths_outside_the_vault_and_non_markdown() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        for bad in ["../x.md", "Money/x.txt", "C:/x.md", "Money/../../x.md"] {
            assert!(append_row(&root, bad, "", COLS, &vals()).is_err(), "{bad}");
        }
    }

    #[test]
    fn refuses_when_a_file_blocks_a_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        fs::write(root.join("Money"), "not a folder").expect("write");
        assert!(matches!(
            append_row(&root, "Money/Ledger.md", "", COLS, &vals()),
            Err(WriteError::Io(_))
        ));
    }

    #[test]
    fn a_note_changed_before_the_move_is_a_conflict() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("n.md");
        fs::write(&path, "changed by Obsidian").expect("write");
        assert_eq!(
            replace(dir.path(), &path, "what we read", "our update"),
            Err(WriteError::Conflict)
        );
        assert_eq!(
            fs::read_to_string(&path).expect("read"),
            "changed by Obsidian"
        );
        assert_eq!(fs::read_dir(dir.path()).expect("list").count(), 1);
    }

    #[test]
    fn create_never_overwrites() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("n.md");
        fs::write(&path, "already here").expect("write");
        assert_eq!(create(dir.path(), &path, "new"), Err(WriteError::Conflict));
        assert_eq!(fs::read_to_string(&path).expect("read"), "already here");
    }
}
