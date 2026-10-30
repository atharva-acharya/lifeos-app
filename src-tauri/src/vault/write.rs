//! Safe note writing (ADR 0003 §3, §4). A change is written to a hidden temp
//! file in the same folder, flushed, and moved over the note in one step, so
//! a crash never leaves half a note. The note is read again just before the
//! move; if Obsidian changed it in the meantime the write is refused, never
//! merged. Only the inserted line is new: every other byte is kept. Each
//! write is recorded in a local log (threat model T15).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use super::guard::{self, GuardError, MAX_NOTE_BYTES, is_reparse_point};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WriteError {
    #[error(transparent)]
    Guard(#[from] GuardError),
    #[error("the note changed while saving; nothing was written, try again")]
    Conflict,
    #[error("the note's table has no {0} column; add one in Obsidian")]
    NoColumn(String),
    #[error("could not save the note: {0}")]
    Io(String),
}

fn io(e: &std::io::Error) -> WriteError {
    WriteError::Io(e.kind().to_string())
}

/// Longest text kept in one table cell, in characters.
pub const MAX_CELL_CHARS: usize = 200;

/// Temp files left by a crash are removed once they are this old.
const STALE_TEMP: Duration = Duration::from_secs(60);

/// One cell of a new row: the header names (lower case) it may go under, and
/// its text. The first name of each is used when a new table is made.
pub type Value<'a> = (&'a [&'a str], String);

/// What a write changed, for the write log: SHA-256 of the note before (none
/// if it was created) and after, in hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteRecord {
    pub before: Option<String>,
    pub after: String,
}

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

/// Adds one row to the first table of the note at `rel` (outside code
/// blocks), putting each value under the table's own header for it, so a
/// table the owner reordered or renamed stays as they arranged it. A value
/// with no column to go in is an error, never dropped. If the note does not
/// exist it is created from `front_matter` and a table headed `columns`
/// (one per value). Missing folders are created inside the vault.
pub fn append_row(
    root: &Path,
    rel: &str,
    front_matter: &str,
    columns: &[&str],
    values: &[Value<'_>],
) -> Result<WriteRecord, WriteError> {
    append_rows(root, rel, front_matter, columns, &[values.to_vec()])
}

/// Like `append_row`, for several rows in one write: all of them land, or
/// none do.
pub fn append_rows(
    root: &Path,
    rel: &str,
    front_matter: &str,
    columns: &[&str],
    rows: &[Vec<Value<'_>>],
) -> Result<WriteRecord, WriteError> {
    guard::check_relative(rel)?;
    let parent = ensure_parent(root, rel)?;
    sweep_temps(&parent);
    match guard::resolve(root, rel) {
        Ok(path) => {
            let original = read(&path)?;
            let updated = insert_rows(&original, columns, rows)?;
            check_inside(root, &parent)?;
            replace(&parent, &path, &original, &updated)?;
            Ok(WriteRecord {
                before: Some(hex(&original)),
                after: hex(&updated),
            })
        }
        Err(GuardError::NotFound) => {
            let text = new_note(front_matter, columns, rows);
            check_inside(root, &parent)?;
            let name = Path::new(rel).file_name().ok_or(GuardError::Empty)?;
            create(&parent, &parent.join(name), &text)?;
            Ok(WriteRecord {
                before: None,
                after: hex(&text),
            })
        }
        Err(e) => Err(e.into()),
    }
}

/// Appends one line to `write-log.txt` in `log_dir` (app data, never the
/// vault): time, action, note path and hashes. No note content is logged.
pub fn log_write(log_dir: &Path, action: &str, rel: &str, record: &WriteRecord) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let line = format!(
        "{secs}\t{action}\t{rel}\t{}\t{}\n",
        record.before.as_deref().unwrap_or("-"),
        record.after
    );
    let _ = fs::create_dir_all(log_dir);
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("write-log.txt"))
    {
        let _ = file.write_all(line.as_bytes());
    }
}

/// Creates the folders above `rel` inside `root`, refusing links and
/// junctions on the way. Returns the note's folder.
fn ensure_parent(root: &Path, rel: &str) -> Result<PathBuf, WriteError> {
    let mut current = root.to_path_buf();
    if let Some(parent) = Path::new(rel).parent() {
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

/// Re-checks, just before the move, that the note's folder still resolves
/// inside the vault and that neither has become a link or junction.
fn check_inside(root: &Path, dir: &Path) -> Result<(), WriteError> {
    for path in [root, dir] {
        let meta = fs::symlink_metadata(path).map_err(|e| io(&e))?;
        if meta.file_type().is_symlink() || is_reparse_point(&meta) {
            return Err(GuardError::Reparse.into());
        }
    }
    let root = fs::canonicalize(root).map_err(|e| io(&e))?;
    let dir = fs::canonicalize(dir).map_err(|e| io(&e))?;
    if dir.starts_with(&root) {
        Ok(())
    } else {
        Err(GuardError::Escapes.into())
    }
}

fn is_temp_name(name: &str) -> bool {
    name.starts_with(".lifeos-") && name.ends_with(".tmp")
}

/// Removes temp files a crash left in `dir`, so cloud sync does not keep them.
fn sweep_temps(dir: &Path) {
    let Ok(items) = fs::read_dir(dir) else {
        return;
    };
    for item in items.flatten() {
        let stale = item
            .metadata()
            .ok()
            .filter(fs::Metadata::is_file)
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > STALE_TEMP);
        if stale && is_temp_name(&item.file_name().to_string_lossy()) {
            let _ = fs::remove_file(item.path());
        }
    }
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

fn hex(text: &str) -> String {
    hash(text).iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes `text` to a new hidden file in `dir` and returns its path.
fn write_temp(dir: &Path, text: &str) -> Result<PathBuf, WriteError> {
    let temp = dir.join(format!(".lifeos-{:016x}.tmp", rand::random::<u64>()));
    match write_new(&temp, text) {
        Ok(()) => Ok(temp),
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(io(&e))
        }
    }
}

/// Writes a file that must not exist yet, and flushes it to disk.
fn write_new(path: &Path, text: &str) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()
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
/// Drives without hard links (FAT, exFAT, some cloud folders) fall back to
/// an exclusive create, which refuses a taken name just the same.
fn create(dir: &Path, path: &Path, text: &str) -> Result<(), WriteError> {
    let temp = write_temp(dir, text)?;
    let linked = fs::hard_link(&temp, path);
    let _ = fs::remove_file(&temp);
    let result = match linked {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => write_new(path, text),
        other => other,
    };
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(WriteError::Conflict),
        Err(e) => Err(io(&e)),
    }
}

fn row(cells: &[String]) -> String {
    format!("| {} |", cells.join(" | "))
}

fn table_block(columns: &[&str], rows: &[Vec<Value<'_>>], nl: &str) -> String {
    let mut out = format!(
        "{}{nl}| {} |{nl}",
        row(&columns.iter().map(|c| (*c).to_owned()).collect::<Vec<_>>()),
        vec!["---"; columns.len()].join(" | "),
    );
    for values in rows {
        let cells: Vec<String> = values.iter().map(|(_, v)| cell(v)).collect();
        out.push_str(&row(&cells));
        out.push_str(nl);
    }
    out
}

fn new_note(front_matter: &str, columns: &[&str], rows: &[Vec<Value<'_>>]) -> String {
    format!(
        "---\n{}\n---\n\n{}",
        front_matter.trim_end(),
        table_block(columns, rows, "\n")
    )
}

/// Fills one row for a table with `headers`. Every non-empty value must find
/// a column; `columns` names it in the error.
fn fill(headers: &[String], columns: &[&str], values: &[Value<'_>]) -> Result<String, WriteError> {
    let lower: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
    let mut cells = vec![String::new(); headers.len()];
    for (i, (names, value)) in values.iter().enumerate() {
        let value = cell(value);
        if value.is_empty() {
            continue;
        }
        let at = lower
            .iter()
            .position(|h| names.contains(&h.as_str()))
            .ok_or_else(|| {
                WriteError::NoColumn(columns.get(i).copied().unwrap_or("needed").to_owned())
            })?;
        cells[at] = value;
    }
    Ok(row(&cells))
}

fn is_fence(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("```") || t.starts_with("~~~")
}

/// Returns `text` with a row added after the last row of its first table
/// (outside front matter and code blocks), or with a new table appended if
/// it has none. Line endings follow the note.
pub fn insert_row(
    text: &str,
    columns: &[&str],
    values: &[Value<'_>],
) -> Result<String, WriteError> {
    insert_rows(text, columns, &[values.to_vec()])
}

/// Like `insert_row`, for several rows in order.
pub fn insert_rows(
    text: &str,
    columns: &[&str],
    rows: &[Vec<Value<'_>>],
) -> Result<String, WriteError> {
    let nl = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let (front, _) = super::note::split_front_matter(text);
    let body_start = front.map_or(0, |f| {
        // `f` is a slice of `text`; skip it and the closing `---` line.
        let after = f.as_ptr() as usize - text.as_ptr() as usize + f.len();
        after
            + text[after..]
                .find('\n')
                .map_or(text.len() - after, |i| i + 1)
    });

    let mut offset = body_start;
    let mut in_code = false;
    let mut table: Option<(usize, String)> = None; // (end offset, header line)
    for line in text[body_start..].split_inclusive('\n') {
        let is_row = !in_code && line.trim_start().starts_with('|');
        if let Some((end, _)) = table.as_mut() {
            if !is_row {
                break;
            }
            *end = offset + line.len();
        } else if is_row {
            table = Some((offset + line.len(), line.trim().to_owned()));
        } else if is_fence(line) {
            in_code = !in_code;
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
            let mut lines = String::new();
            for values in rows {
                lines.push_str(&fill(&headers, columns, values)?);
                lines.push_str(nl);
            }
            let mut out = String::with_capacity(text.len() + lines.len() + 2);
            out.push_str(&text[..end]);
            if !out.ends_with('\n') {
                out.push_str(nl);
            }
            out.push_str(&lines);
            out.push_str(&text[end..]);
            Ok(out)
        }
        None => {
            let mut out = text.to_owned();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push_str(nl);
            }
            if !out.is_empty() {
                out.push_str(nl);
            }
            out.push_str(&table_block(columns, rows, nl));
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const COLS: &[&str] = &["Date", "Description", "Amount"];

    fn vals() -> Vec<Value<'static>> {
        vec![
            (&["date"], "2026-10-30".to_owned()),
            (&["description", "payee"], "Coffee".to_owned()),
            (&["amount"], "-3.20".to_owned()),
        ]
    }

    fn insert(text: &str) -> String {
        insert_row(text, COLS, &vals()).expect("insert")
    }

    #[test]
    fn cells_lose_pipes_breaks_and_length() {
        assert_eq!(cell(" a|b\r\nc\t "), "a/b  c");
        assert_eq!(cell(&"x".repeat(500)).chars().count(), MAX_CELL_CHARS);
    }

    #[test]
    fn adds_a_row_after_the_table_and_keeps_every_other_byte() {
        let text = "---\ntype: ledger\nnote: keep | me\n---\n\nIntro.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-01 | Rent | -950.00 |\n\nTail text.\n";
        assert_eq!(
            insert(text),
            "---\ntype: ledger\nnote: keep | me\n---\n\nIntro.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-01 | Rent | -950.00 |\n| 2026-10-30 | Coffee | -3.20 |\n\nTail text.\n"
        );
    }

    #[test]
    fn follows_the_tables_own_columns_names_and_line_endings() {
        let text = "---\r\ntype: ledger\r\n---\r\n| Amount | Note | Payee | Date |\r\n|---|---|---|---|\r\n";
        assert_eq!(
            insert(text),
            "---\r\ntype: ledger\r\n---\r\n| Amount | Note | Payee | Date |\r\n|---|---|---|---|\r\n| -3.20 |  | Coffee | 2026-10-30 |\r\n"
        );
    }

    #[test]
    fn a_value_with_no_column_is_refused_not_dropped() {
        let text = "| Date | Amount |\n|---|---|\n";
        assert_eq!(
            insert_row(text, COLS, &vals()),
            Err(WriteError::NoColumn("Description".into()))
        );
        let mut empty = vals();
        empty[1].1 = " ".to_owned();
        assert!(
            insert_row(text, COLS, &empty).is_ok(),
            "empty values need no column"
        );
    }

    #[test]
    fn skips_tables_in_code_blocks() {
        let text = "```\n| Date | Description | Amount |\n```\nText.";
        assert_eq!(
            insert(text),
            "```\n| Date | Description | Amount |\n```\nText.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
    }

    #[test]
    fn appends_a_table_when_there_is_none_or_the_table_ends_the_file() {
        assert_eq!(
            insert("---\ntype: ledger\n---\nNo table yet."),
            "---\ntype: ledger\n---\nNo table yet.\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
        assert_eq!(
            insert("| Date | Description | Amount |\n|---|---|---|"),
            "| Date | Description | Amount |\n|---|---|---|\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
    }

    #[test]
    fn creates_the_note_and_folders_then_appends_and_logs() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        let rel = "Money/Ledger/2026-10.md";
        let first =
            append_row(&root, rel, "type: ledger\nmonth: 2026-10", COLS, &vals()).expect("create");
        assert_eq!(first.before, None);
        let second = append_row(&root, rel, "unused", COLS, &vals()).expect("append");
        assert_eq!(second.before.as_deref(), Some(first.after.as_str()));
        let text = fs::read_to_string(root.join(rel)).expect("read");
        assert_eq!(
            text,
            "---\ntype: ledger\nmonth: 2026-10\n---\n\n| Date | Description | Amount |\n| --- | --- | --- |\n| 2026-10-30 | Coffee | -3.20 |\n| 2026-10-30 | Coffee | -3.20 |\n"
        );
        assert_eq!(second.after, hex(&text));
        let names: Vec<_> = fs::read_dir(root.join("Money/Ledger"))
            .expect("list")
            .map(|e| e.expect("entry").file_name())
            .collect();
        assert_eq!(names.len(), 1, "no temp files left behind: {names:?}");

        let logs = tempfile::tempdir().expect("logs");
        log_write(logs.path(), "append-row", rel, &second);
        let log = fs::read_to_string(logs.path().join("write-log.txt")).expect("log");
        assert!(log.ends_with(&format!(
            "\tappend-row\t{rel}\t{}\t{}\n",
            first.after, second.after
        )));
        assert!(!log.contains("Coffee"), "no note content in the log");
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
    fn a_folder_outside_the_vault_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let other = tempfile::tempdir().expect("other");
        assert_eq!(
            check_inside(dir.path(), other.path()),
            Err(GuardError::Escapes.into())
        );
        assert_eq!(check_inside(dir.path(), dir.path()), Ok(()));
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

    #[test]
    fn only_old_temp_files_are_swept() {
        let dir = tempfile::tempdir().expect("tempdir");
        let fresh = dir.path().join(".lifeos-0000000000000001.tmp");
        fs::write(&fresh, "x").expect("write");
        fs::write(dir.path().join("keep.md"), "x").expect("write");
        sweep_temps(dir.path());
        assert!(
            fresh.exists(),
            "a temp file in use by another write is left alone"
        );
        assert!(is_temp_name(".lifeos-abc.tmp") && !is_temp_name("lifeos-abc.tmp"));
    }
}
