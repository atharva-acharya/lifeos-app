//! Local error log (threat model T21): UI errors and panics are appended to a
//! small rotating file in local app data. Nothing is sent anywhere; the owner
//! copies it from Settings when reporting a problem.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::Serialize;

pub const LOG_FILE: &str = "errors.log";
const OLD_LOG_FILE: &str = "errors.1.log";
/// The log rotates past this size, so at most twice this is kept.
const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_MESSAGE_CHARS: usize = 2_000;

/// One line per entry: control characters (including newlines) become
/// spaces so an entry cannot forge others, and long messages are cut.
pub fn clean(message: &str) -> String {
    let mut out: String = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_MESSAGE_CHARS)
        .collect();
    if message.chars().count() > MAX_MESSAGE_CHARS {
        out.push('…');
    }
    out.trim().to_owned()
}

/// Appends `[source] message` with a millisecond timestamp, rotating first
/// if the log is full.
pub fn append(dir: &Path, at_ms: i64, source: &str, message: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(LOG_FILE);
    if fs::metadata(&path).is_ok_and(|m| m.len() > MAX_LOG_BYTES) {
        fs::rename(&path, dir.join(OLD_LOG_FILE))?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{at_ms} [{}] {}", clean(source), clean(message))
}

/// The newest `n` entries, oldest first.
pub fn tail(dir: &Path, n: usize) -> Vec<String> {
    let mut lines: Vec<String> = [OLD_LOG_FILE, LOG_FILE]
        .iter()
        .filter_map(|f| fs::read_to_string(dir.join(f)).ok())
        .flat_map(|text| text.lines().map(str::to_owned).collect::<Vec<_>>())
        .filter(|l| !l.trim().is_empty())
        .collect();
    let skip = lines.len().saturating_sub(n);
    lines.drain(..skip);
    lines
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub version: String,
    pub os: String,
    /// Newest entries of the local error log, oldest first.
    pub log: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_are_one_line_and_capped() {
        assert_eq!(clean("bad\nline\r\u{0}x"), "bad line  x");
        let long = "a".repeat(MAX_MESSAGE_CHARS + 50);
        let cut = clean(&long);
        assert_eq!(cut.chars().count(), MAX_MESSAGE_CHARS + 1);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn append_and_tail_keep_order() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(tail(dir.path(), 10).is_empty());
        for i in 0..5 {
            append(dir.path(), i, "ui", &format!("error {i}")).expect("append");
        }
        assert_eq!(
            tail(dir.path(), 2),
            vec!["3 [ui] error 3", "4 [ui] error 4"]
        );
        // A forged second entry stays on its own line.
        append(dir.path(), 9, "ui", "real\n10 [panic] fake").expect("append");
        assert_eq!(tail(dir.path(), 1), vec!["9 [ui] real 10 [panic] fake"]);
    }

    #[test]
    fn the_log_rotates_and_stays_bounded() {
        let dir = tempfile::tempdir().expect("temp dir");
        let big = "x".repeat(1_500);
        for i in 0..400 {
            append(dir.path(), i, "ui", &big).expect("append");
        }
        let size = |f: &str| fs::metadata(dir.path().join(f)).map_or(0, |m| m.len());
        assert!(size(OLD_LOG_FILE) > 0);
        assert!(size(LOG_FILE) + size(OLD_LOG_FILE) <= 2 * MAX_LOG_BYTES + 4_096);
        // The newest entry is still the last one returned.
        assert!(tail(dir.path(), 1)[0].starts_with("399 [ui]"));
    }
}
