//! Changing one transaction's category (ui-spec P6). The UI names the row by
//! what it shows (date, description, amount, account and current category)
//! plus which of any identical rows it means; it never sends a path. The
//! note follows from the date (`Money/Ledger/YYYY-MM.md`), and only the text
//! of that one Category cell changes: every other byte of the note is kept.
//! The write goes through the safe writer (ADR 0003).

use std::path::Path;

use serde::Deserialize;

use crate::vault::note::{
    self, CATEGORY_HEADERS, MAX_AMOUNT_PENCE, Note, Transaction, is_iso_date,
};
use crate::vault::write::{self, MAX_CELL_CHARS, WriteError, WriteRecord};

/// Longest category name, as in quick add.
pub const MAX_CATEGORY_CHARS: usize = 60;

const NOT_FOUND: &str =
    "That transaction is no longer in its ledger note. Reload the page and try again.";
const AMBIGUOUS: &str = "The ledger note changed since this page loaded, so the row is not certain. Reload the page and try again.";

/// One ledger row as the page shows it, and the category to give it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CategoryChange {
    pub date: String,
    pub description: String,
    /// Pence, signed as in the ledger.
    pub amount: i64,
    pub account: Option<String>,
    /// The row's category now; `None` when it has none.
    pub category: Option<String>,
    /// Which of the identical rows is meant: 0 is the last one in the note
    /// (the one the page lists first, as it lists newest first).
    pub occurrence: usize,
    /// How many identical rows the page showed. The change is refused unless
    /// the note still has exactly that many.
    pub duplicates: usize,
    /// The new category.
    pub new_category: String,
}

impl CategoryChange {
    /// Checks the request; the message is shown in the UI.
    pub fn validate(&self) -> Result<(), String> {
        if !is_iso_date(&self.date) {
            return Err("Date must look like 2026-10-29.".into());
        }
        if self.amount.abs() > MAX_AMOUNT_PENCE {
            return Err(NOT_FOUND.into());
        }
        let long = |s: &str| s.chars().count() > note::MAX_TEXT_CHARS;
        if long(&self.description)
            || self.account.as_deref().is_some_and(long)
            || self.category.as_deref().is_some_and(long)
        {
            return Err(NOT_FOUND.into());
        }
        if self.duplicates == 0 || self.occurrence >= self.duplicates {
            return Err(AMBIGUOUS.into());
        }
        let name = &self.new_category;
        if name.contains('|') || name.chars().any(char::is_control) {
            return Err("A category cannot contain a | or a line break.".into());
        }
        let n = write::cell(name).chars().count();
        if n == 0 {
            return Err("Type a category name.".into());
        }
        if n > MAX_CATEGORY_CHARS || name.chars().count() > MAX_CELL_CHARS {
            return Err(format!(
                "A category must be {MAX_CATEGORY_CHARS} characters or fewer."
            ));
        }
        Ok(())
    }

    /// The vault-relative ledger note for this row's month.
    pub fn ledger_path(&self) -> String {
        format!("Money/Ledger/{}.md", &self.date[..7])
    }

    fn matches(&self, t: &Transaction) -> bool {
        t.date == self.date
            && t.description == self.description
            && t.amount == self.amount
            && t.account == self.account
            && t.category == self.category
    }
}

/// Why an edit was refused: a message for the UI, or the writer's error.
#[derive(Debug)]
enum Refusal {
    Message(String),
    Write(WriteError),
}

impl From<WriteError> for Refusal {
    fn from(e: WriteError) -> Self {
        Refusal::Write(e)
    }
}

fn refuse(message: &str) -> Refusal {
    Refusal::Message(message.to_owned())
}

/// Byte ranges (within `line`) of a table row's cells, split exactly as the
/// note parser splits them: trimmed, outer pipes dropped, then split on `|`.
fn cell_spans(line: &str) -> Vec<(usize, usize)> {
    let start = line.len() - line.trim_start().len();
    let end = line.trim_end().len().max(start);
    let row = &line[start..end];
    let inner = row.trim_start_matches('|');
    let base = start + (row.len() - inner.len());
    let inner = inner.trim_end_matches('|');
    let mut spans = Vec::new();
    let mut from = 0;
    for (i, c) in inner.char_indices() {
        if c == '|' {
            spans.push((base + from, base + i));
            from = i + 1;
        }
    }
    spans.push((base + from, base + inner.len()));
    spans
}

/// One data line of the note's first table: where it starts in the note,
/// the line itself (without its line ending) and the transaction the parser
/// reads from it, if any.
struct Line<'a> {
    offset: usize,
    text: &'a str,
    transaction: Option<Transaction>,
}

/// The first table of the note's body, found the way the ledger parser
/// finds it: its header line and its data lines.
fn table(text: &str) -> Option<(&str, Vec<Line<'_>>)> {
    let (_, body) = note::split_front_matter(text);
    // `body` is a slice of `text`.
    let mut offset = body.as_ptr() as usize - text.as_ptr() as usize;
    let mut header: Option<&str> = None;
    let mut lines = Vec::new();
    for raw in body.split_inclusive('\n') {
        let line = raw.strip_suffix('\n').unwrap_or(raw);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let is_row = line.trim().starts_with('|');
        match header {
            None if is_row => header = Some(line),
            None => {}
            Some(_) if !is_row => break,
            Some(h) => {
                // The parser reads each row against the header, so a table of
                // just the header and this line reads it the same way.
                let transaction = note::ledger_table(&format!("{}\n{}\n", h.trim(), line.trim()))
                    .into_iter()
                    .next();
                lines.push(Line {
                    offset,
                    text: line,
                    transaction,
                });
            }
        }
        offset += raw.len();
    }
    header.map(|h| (h, lines))
}

fn ledger(text: &str) -> Result<Vec<Transaction>, Refusal> {
    match note::parse(text) {
        Ok(Note::Ledger(rows)) => Ok(rows),
        _ => Err(refuse(NOT_FOUND)),
    }
}

/// Returns `text` with the matching row's Category cell set to `name`, or
/// refuses. Nothing but that cell's text changes.
fn edit(text: &str, change: &CategoryChange, name: &str) -> Result<String, Refusal> {
    let before = ledger(text)?;
    let (header, lines) = table(text).ok_or_else(|| refuse(NOT_FOUND))?;
    let matching: Vec<&Line<'_>> = lines
        .iter()
        .filter(|l| l.transaction.as_ref().is_some_and(|t| change.matches(t)))
        .collect();
    if matching.is_empty() {
        return Err(refuse(NOT_FOUND));
    }
    if matching.len() != change.duplicates {
        return Err(refuse(AMBIGUOUS));
    }
    // The page lists rows newest first, so its first copy is the note's last.
    let line = matching[matching.len() - 1 - change.occurrence];
    if change.category.as_deref() == Some(name) {
        return Ok(text.to_owned());
    }

    let column = note_headers(header)
        .iter()
        .position(|h| CATEGORY_HEADERS.contains(&h.as_str()))
        .ok_or(WriteError::NoColumn("Category".into()))?;
    let &(from, to) = cell_spans(line.text)
        .get(column)
        .ok_or_else(|| refuse("This row has no Category cell. Add one in Obsidian."))?;
    let current = &line.text[from..to];
    let (from, to, replacement) = if current.trim().is_empty() {
        (from, to, format!(" {name} "))
    } else {
        let lead = current.len() - current.trim_start().len();
        (
            from + lead,
            from + lead + current.trim().len(),
            name.to_owned(),
        )
    };
    let (from, to) = (line.offset + from, line.offset + to);
    let mut out = String::with_capacity(text.len() + replacement.len());
    out.push_str(&text[..from]);
    out.push_str(&replacement);
    out.push_str(&text[to..]);

    // Read the result back: exactly the one row may differ, and only in its
    // category, or nothing is written.
    let after = ledger(&out)?;
    let index = before
        .iter()
        .enumerate()
        .filter(|(_, t)| change.matches(t))
        .map(|(i, _)| i)
        .nth(change.duplicates - 1 - change.occurrence);
    let mut expected = before;
    match index.and_then(|i| expected.get_mut(i)) {
        Some(t) => t.category = Some(name.to_owned()),
        None => return Err(refuse(AMBIGUOUS)),
    }
    if after != expected {
        return Err(refuse(
            "That category could not be saved without changing other rows; nothing was written.",
        ));
    }
    Ok(out)
}

fn note_headers(header: &str) -> Vec<String> {
    let line = header.trim();
    line.trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|h| h.trim().to_lowercase())
        .collect()
}

/// Sets the category of one ledger row. Returns the note's vault-relative
/// path and the hashes for the write log.
pub fn set_category(
    vault: &Path,
    change: &CategoryChange,
) -> Result<(String, WriteRecord), String> {
    change.validate()?;
    let name = write::cell(&change.new_category);
    let rel = change.ledger_path();
    let record =
        write::rewrite(vault, &rel, |text| edit(text, change, &name)).map_err(|e| match e {
            Refusal::Message(m) => m,
            Refusal::Write(WriteError::Guard(crate::vault::guard::GuardError::NotFound)) => {
                NOT_FOUND.to_owned()
            }
            Refusal::Write(e @ (WriteError::Conflict | WriteError::NoColumn(_))) => e.to_string(),
            Refusal::Write(e) => format!("Could not save: {e}"),
        })?;
    Ok((rel, record))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const NOTE: &str = "---\ntype: ledger\nmonth: 2026-10\nnote: keep | me\n---\n\nIntro text.\n\n| Date | Description | Category | Amount | Account |\n| --- | --- | --- | --- | --- |\n| 2026-10-01 | Rent | Housing | -950.00 | Current |\n| 2026-10-03 | Corner Grocer | Groceries | -12.50 | Card |\n| 2026-10-03 | Sample Cafe |  | -3.20 |  |\n| 2026-10-03 | Sample Cafe |  | -3.20 |  |\n| 2026-10-05 | Example payroll | `Salary` | 2400.00 | Current |\n\nTail | not a table.\n";

    fn vault(text: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        fs::create_dir_all(root.join("Money/Ledger")).expect("mkdir");
        fs::write(root.join("Money/Ledger/2026-10.md"), text).expect("write");
        (dir, root)
    }

    fn read(root: &Path) -> String {
        fs::read_to_string(root.join("Money/Ledger/2026-10.md")).expect("read")
    }

    fn grocer(new: &str) -> CategoryChange {
        CategoryChange {
            date: "2026-10-03".into(),
            description: "Corner Grocer".into(),
            amount: -1250,
            account: Some("Card".into()),
            category: Some("Groceries".into()),
            occurrence: 0,
            duplicates: 1,
            new_category: new.into(),
        }
    }

    fn cafe(occurrence: usize, new: &str) -> CategoryChange {
        CategoryChange {
            date: "2026-10-03".into(),
            description: "Sample Cafe".into(),
            amount: -320,
            account: None,
            category: None,
            occurrence,
            duplicates: 2,
            new_category: new.into(),
        }
    }

    #[test]
    fn changes_only_the_one_cell() {
        let (_dir, root) = vault(NOTE);
        let (rel, record) = set_category(&root, &grocer("Food shop")).expect("set");
        assert_eq!(rel, "Money/Ledger/2026-10.md");
        let text = read(&root);
        assert_eq!(
            text,
            NOTE.replace(
                "| Corner Grocer | Groceries |",
                "| Corner Grocer | Food shop |"
            )
        );
        assert_eq!(record.after, {
            use sha2::{Digest, Sha256};
            Sha256::digest(text.as_bytes())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        });
        assert_ne!(record.before.as_deref(), Some(record.after.as_str()));
        let names = fs::read_dir(root.join("Money/Ledger"))
            .expect("list")
            .count();
        assert_eq!(names, 1, "no temp files left behind");
    }

    #[test]
    fn replaces_a_backticked_cell() {
        let (_dir, root) = vault(NOTE);
        let mut payroll = grocer("Income");
        payroll.date = "2026-10-05".into();
        payroll.description = "Example payroll".into();
        payroll.amount = 240_000;
        payroll.account = Some("Current".into());
        payroll.category = Some("Salary".into());
        set_category(&root, &payroll).expect("set");
        assert!(read(&root).contains("| Example payroll | Income | 2400.00 |"));
    }

    #[test]
    fn duplicates_are_told_apart_by_occurrence() {
        let (_dir, root) = vault(NOTE);
        // 0 is the copy the page lists first: the later one in the note.
        set_category(&root, &cafe(0, "Coffee")).expect("set");
        let first = "| 2026-10-03 | Sample Cafe |  | -3.20 |  |\n| 2026-10-03 | Sample Cafe | Coffee | -3.20 |  |\n";
        assert!(read(&root).contains(first), "{}", read(&root));

        let (_dir, root) = vault(NOTE);
        set_category(&root, &cafe(1, "Coffee")).expect("set");
        let second = "| 2026-10-03 | Sample Cafe | Coffee | -3.20 |  |\n| 2026-10-03 | Sample Cafe |  | -3.20 |  |\n";
        assert!(read(&root).contains(second), "{}", read(&root));
    }

    #[test]
    fn refuses_when_the_duplicate_count_changed() {
        let (_dir, root) = vault(NOTE);
        let mut one = cafe(0, "Coffee");
        one.duplicates = 1;
        assert_eq!(set_category(&root, &one).map(|_| ()), Err(AMBIGUOUS.into()));
        let mut three = cafe(2, "Coffee");
        three.duplicates = 3;
        assert_eq!(
            set_category(&root, &three).map(|_| ()),
            Err(AMBIGUOUS.into())
        );
        let mut past = cafe(2, "Coffee");
        past.duplicates = 2;
        assert!(
            set_category(&root, &past).is_err(),
            "occurrence past the end"
        );
        assert_eq!(read(&root), NOTE);
    }

    #[test]
    fn refuses_a_row_that_is_not_there_and_writes_nothing() {
        let (_dir, root) = vault(NOTE);
        let mut changes = Vec::new();
        let mut c = grocer("X");
        c.amount = -1251;
        changes.push(c);
        let mut c = grocer("X");
        c.category = Some("groceries".into());
        changes.push(c);
        let mut c = grocer("X");
        c.account = None;
        changes.push(c);
        let mut c = grocer("X");
        c.description = "Corner Grocer ".into();
        changes.push(c);
        let mut c = grocer("X");
        c.date = "2026-10-04".into();
        changes.push(c);
        for c in changes {
            assert_eq!(set_category(&root, &c).map(|_| ()), Err(NOT_FOUND.into()));
        }
        // Another month's note does not exist: refused, not created.
        let mut c = grocer("X");
        c.date = "2026-11-03".into();
        assert_eq!(set_category(&root, &c).map(|_| ()), Err(NOT_FOUND.into()));
        assert!(!root.join("Money/Ledger/2026-11.md").exists());
        assert_eq!(read(&root), NOTE);
    }

    #[test]
    fn refuses_injection_and_bad_names_and_writes_nothing() {
        let (_dir, root) = vault(NOTE);
        for bad in [
            "Food | Amount",
            "Food\n| 2026-10-09 | Fake | x | -1 | |",
            "Food\r",
            "Tab\there",
            "",
            "   ",
            &"x".repeat(MAX_CATEGORY_CHARS + 1),
        ] {
            assert!(set_category(&root, &grocer(bad)).is_err(), "{bad:?}");
        }
        assert_eq!(read(&root), NOTE);
    }

    #[test]
    fn markdown_is_kept_as_cell_text_and_backticks_that_would_not_read_back_are_refused() {
        let (_dir, root) = vault(NOTE);
        set_category(&root, &grocer("**Bold** [x](https://example.com) <b>")).expect("set");
        assert!(read(&root).contains("| Corner Grocer | **Bold** [x](https://example.com) <b> |"));
        let Ok(Note::Ledger(rows)) = note::parse(&read(&root)) else {
            panic!("ledger");
        };
        assert_eq!(rows.len(), 5, "no rows added or lost");

        let (_dir, root) = vault(NOTE);
        assert!(set_category(&root, &grocer("`Food`")).is_err());
        assert_eq!(read(&root), NOTE);
    }

    #[test]
    fn keeps_crlf_line_endings() {
        let crlf = NOTE.replace('\n', "\r\n");
        let (_dir, root) = vault(&crlf);
        set_category(&root, &grocer("Food shop")).expect("set");
        assert_eq!(
            read(&root),
            crlf.replace(
                "| Corner Grocer | Groceries |",
                "| Corner Grocer | Food shop |"
            )
        );
    }

    #[test]
    fn follows_the_tables_own_columns() {
        let text = "---\ntype: ledger\n---\n|Amount|Payee|Category|Date|\n|---|---|---|---|\n|-12.50|Corner Grocer||2026-10-03|\n";
        let (_dir, root) = vault(text);
        let mut c = grocer("Food");
        c.account = None;
        c.category = None;
        set_category(&root, &c).expect("set");
        assert_eq!(
            read(&root),
            "---\ntype: ledger\n---\n|Amount|Payee|Category|Date|\n|---|---|---|---|\n|-12.50|Corner Grocer| Food |2026-10-03|\n"
        );
    }

    #[test]
    fn refuses_a_table_without_a_category_column_or_cell() {
        let text = "---\ntype: ledger\n---\n| Date | Description | Amount |\n|---|---|---|\n| 2026-10-03 | Corner Grocer | -12.50 |\n";
        let (_dir, root) = vault(text);
        let mut c = grocer("Food");
        c.account = None;
        c.category = None;
        assert!(set_category(&root, &c).is_err());
        assert_eq!(read(&root), text);

        let short = "---\ntype: ledger\n---\n| Date | Amount | Description | Category |\n|---|---|---|---|\n| 2026-10-03 | -12.50 | Corner Grocer |\n";
        let (_dir, root) = vault(short);
        assert!(set_category(&root, &c).is_err());
        assert_eq!(read(&root), short);
    }

    #[test]
    fn refuses_a_note_that_is_not_a_ledger() {
        let text = NOTE.replace("type: ledger", "type: budgets");
        let (_dir, root) = vault(&text);
        assert_eq!(
            set_category(&root, &grocer("Food")).map(|_| ()),
            Err(NOT_FOUND.into())
        );
        assert_eq!(read(&root), text);
    }

    #[test]
    fn the_money_page_reads_the_new_category() {
        let (_dir, root) = vault(NOTE);
        set_category(&root, &cafe(0, "Coffee")).expect("set");
        let mut index = crate::index::Index::open_in_memory().expect("index");
        index.sync(&root).expect("sync");
        let m = crate::money::money(&index, "2026-10").expect("money");
        let cafes: Vec<Option<&str>> = m
            .transactions
            .iter()
            .filter(|t| t.description == "Sample Cafe")
            .map(|t| t.category.as_deref())
            .collect();
        // Newest first: the page's first copy is the one that changed.
        assert_eq!(cafes, [Some("Coffee"), None]);
        assert!(m.known_categories.contains(&"Coffee".to_owned()));
    }

    #[test]
    fn the_same_category_writes_nothing() {
        let (_dir, root) = vault(NOTE);
        let (_, record) = set_category(&root, &grocer(" Groceries ")).expect("set");
        assert_eq!(record.before.as_deref(), Some(record.after.as_str()));
        assert_eq!(read(&root), NOTE);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_ledger_folder_that_is_a_link() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        let outside = tempfile::tempdir().expect("outside");
        fs::write(outside.path().join("2026-10.md"), NOTE).expect("write");
        fs::create_dir_all(root.join("Money")).expect("mkdir");
        std::os::unix::fs::symlink(outside.path(), root.join("Money/Ledger")).expect("link");
        assert!(set_category(&root, &grocer("Food")).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("2026-10.md")).expect("read"),
            NOTE
        );
    }

    #[test]
    fn checks_the_request() {
        assert!(grocer("Food").validate().is_ok());
        let mut c = grocer("Food");
        c.date = "2026-13-01".into();
        assert!(c.validate().is_err());
        let mut c = grocer("Food");
        c.occurrence = 1;
        assert!(c.validate().is_err());
        let mut c = grocer("Food");
        c.duplicates = 0;
        assert!(c.validate().is_err());
        let mut c = grocer("Food");
        c.description = "x".repeat(note::MAX_TEXT_CHARS + 1);
        assert!(c.validate().is_err());
    }

    #[test]
    fn splits_cells_like_the_parser() {
        let line = "  | a | `b` ||  d  |  ";
        let spans = cell_spans(line);
        let cells: Vec<&str> = spans.iter().map(|&(f, t)| line[f..t].trim()).collect();
        assert_eq!(cells, ["a", "`b`", "", "d"]);
    }
}
