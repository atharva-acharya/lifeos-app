//! Bank statement CSV import (requirements §3.8). The UI reads the file the
//! owner picks and sends its text; nothing here opens files by path. Columns
//! are mapped by header name and the mapping is saved per bank in local
//! settings. Rows already in the ledger (same date, amount and description)
//! are skipped, so importing the same statement twice adds nothing.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::index::Index;
use crate::vault::note::{
    ACCOUNT_HEADERS, AMOUNT_HEADERS, CATEGORY_HEADERS, DATE_HEADERS, DESCRIPTION_HEADERS,
    LEDGER_COLUMNS, format_pence, is_iso_date, parse_pence,
};
use crate::vault::write::{self, Value, WriteRecord, cell};

/// Largest statement accepted, in bytes of text.
pub const MAX_CSV_BYTES: usize = 2 * 1024 * 1024;
const MAX_ROWS: usize = 20_000;
const MAX_COLUMNS: usize = 60;
const MAX_FIELD_CHARS: usize = 1_000;
/// Longest bank name kept, and most banks remembered.
const MAX_BANK_CHARS: usize = 60;
const MAX_BANKS: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateFormat {
    /// 31/10/2026 (UK banks).
    Dmy,
    /// 2026-10-31.
    Ymd,
    /// 10/31/2026.
    Mdy,
}

/// Which CSV column (by header) holds each field. Either `amount` (signed)
/// or `money_out` / `money_in` (unsigned) must be set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mapping {
    pub date: String,
    pub date_format: DateFormat,
    pub description: String,
    #[serde(default)]
    pub amount: Option<String>,
    #[serde(default)]
    pub money_out: Option<String>,
    #[serde(default)]
    pub money_in: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// The bank shows spending as positive amounts.
    #[serde(default)]
    pub flip_sign: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowStatus {
    New,
    Duplicate,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Row number as a spreadsheet shows it (header is 1; blank lines skipped).
    pub line: usize,
    pub date: Option<String>,
    pub description: String,
    pub category: Option<String>,
    pub amount: Option<i64>,
    pub status: RowStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub headers: Vec<String>,
    pub mapping: Mapping,
    /// The mapping came from settings for this bank.
    pub saved: bool,
    pub rows: Vec<Candidate>,
    pub new: usize,
    pub duplicates: usize,
    pub errors: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub duplicates: usize,
    pub errors: usize,
    /// Ledger notes written, vault-relative.
    pub files: Vec<String>,
}

/// Parses CSV text (RFC 4180: quoted fields, doubled quotes, CRLF or LF, a
/// leading BOM) into rows of fields. Blank lines are skipped.
pub fn parse_csv(text: &str) -> Result<Vec<Vec<String>>, String> {
    if text.len() > MAX_CSV_BYTES {
        return Err("The file is larger than 2 MB.".into());
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let push_field = |row: &mut Vec<String>, field: &mut String| -> Result<(), String> {
        if row.len() >= MAX_COLUMNS {
            return Err(format!("A row has more than {MAX_COLUMNS} columns."));
        }
        row.push(std::mem::take(field).trim().to_owned());
        Ok(())
    };
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    chars.next();
                    field.push('"');
                }
                '"' => quoted = false,
                c => field.push(c),
            }
        } else {
            match c {
                '"' if field.trim().is_empty() => {
                    field.clear();
                    quoted = true;
                }
                ',' => push_field(&mut row, &mut field)?,
                '\r' if chars.peek() == Some(&'\n') => {}
                '\n' | '\r' => {
                    push_field(&mut row, &mut field)?;
                    if row.iter().any(|f| !f.is_empty()) {
                        if rows.len() >= MAX_ROWS {
                            return Err(format!("The file has more than {MAX_ROWS} rows."));
                        }
                        rows.push(std::mem::take(&mut row));
                    } else {
                        row.clear();
                    }
                }
                c => field.push(c),
            }
        }
        if field.chars().count() > MAX_FIELD_CHARS {
            return Err("A field is longer than 1,000 characters.".into());
        }
    }
    if quoted {
        return Err("A quoted field is never closed.".into());
    }
    push_field(&mut row, &mut field)?;
    if row.iter().any(|f| !f.is_empty()) {
        if rows.len() >= MAX_ROWS {
            return Err(format!("The file has more than {MAX_ROWS} rows."));
        }
        rows.push(row);
    }
    Ok(rows)
}

fn find(headers: &[String], names: &[&str]) -> Option<String> {
    names.iter().find_map(|n| {
        headers
            .iter()
            .find(|h| h.trim().eq_ignore_ascii_case(n))
            .cloned()
    })
}

/// Guesses a mapping from the headers and the first data rows.
pub fn guess(headers: &[String], rows: &[Vec<String>]) -> Mapping {
    let date = find(
        headers,
        &["date", "transaction date", "posted date", "booking date"],
    )
    .or_else(|| {
        headers
            .iter()
            .find(|h| h.to_lowercase().contains("date"))
            .cloned()
    })
    .unwrap_or_default();
    let col = headers.iter().position(|h| h == &date);
    let ymd = col
        .and_then(|i| rows.iter().find_map(|r| r.get(i)))
        .is_some_and(|v| v.len() >= 10 && v.as_bytes().get(4) == Some(&b'-'));
    Mapping {
        date_format: if ymd {
            DateFormat::Ymd
        } else {
            DateFormat::Dmy
        },
        date,
        description: find(
            headers,
            &[
                "description",
                "details",
                "payee",
                "name",
                "narrative",
                "memo",
                "merchant",
                "reference",
            ],
        )
        .unwrap_or_default(),
        amount: find(headers, &["amount", "value", "amount (gbp)", "amount(gbp)"]),
        money_out: find(
            headers,
            &["paid out", "money out", "debit", "debits", "out"],
        ),
        money_in: find(headers, &["paid in", "money in", "credit", "credits", "in"]),
        category: find(headers, &["category"]),
        flip_sign: false,
    }
}

/// Reads a bank date (`31/10/2026`, `31-10-26`, `2026-10-31 09:15`) as ISO.
pub fn parse_date(text: &str, format: DateFormat) -> Option<String> {
    let day_part = text.trim().split([' ', 'T']).next()?;
    let parts: Vec<&str> = day_part.split(['/', '-', '.']).collect();
    let [a, b, c] = parts.as_slice() else {
        return None;
    };
    let (y, m, d) = match format {
        DateFormat::Dmy => (c, b, a),
        DateFormat::Ymd => (a, b, c),
        DateFormat::Mdy => (c, a, b),
    };
    let year: u32 = y.parse().ok()?;
    let year = match y.len() {
        2 => 2000 + year,
        4 => year,
        _ => return None,
    };
    let (month, day): (u32, u32) = (m.parse().ok()?, d.parse().ok()?);
    let iso = format!("{year:04}-{month:02}-{day:02}");
    is_iso_date(&iso).then_some(iso)
}

/// Reads an unsigned or signed bank amount; brackets mean negative.
fn amount(text: &str) -> Option<i64> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(inner) = t.strip_prefix('(').and_then(|r| r.strip_suffix(')')) {
        return parse_pence(inner).map(|p| -p.abs());
    }
    let t = t.trim_end_matches(" CR").trim_end_matches(" DR");
    parse_pence(t)
}

fn validate(mapping: &Mapping, headers: &[String]) -> Result<(), String> {
    let has = |h: &str| headers.iter().any(|x| x == h);
    if !has(&mapping.date) {
        return Err("Choose the date column.".into());
    }
    if !has(&mapping.description) {
        return Err("Choose the description column.".into());
    }
    let amount_ok = mapping.amount.as_deref().is_some_and(has);
    let split_ok = mapping.money_out.as_deref().is_some_and(has)
        || mapping.money_in.as_deref().is_some_and(has);
    if !amount_ok && !split_ok {
        return Err("Choose an amount column, or money out and money in columns.".into());
    }
    for c in [
        &mapping.amount,
        &mapping.money_out,
        &mapping.money_in,
        &mapping.category,
    ]
    .into_iter()
    .flatten()
    {
        if !has(c) {
            return Err(format!("There is no column called \"{c}\"."));
        }
    }
    Ok(())
}

fn key(date: &str, amount: i64, description: &str) -> (String, i64, String) {
    (date.to_owned(), amount, cell(description).to_lowercase())
}

/// How many times each (date, amount, description) is already in the ledger.
fn existing(index: &Index) -> rusqlite::Result<HashMap<(String, i64, String), usize>> {
    let mut seen = HashMap::new();
    let mut stmt = index
        .conn()
        .prepare("SELECT date, amount, description FROM ledger")?;
    let rows = stmt.query_map(params![], |r| {
        Ok(key(
            &r.get::<_, String>(0)?,
            r.get(1)?,
            &r.get::<_, String>(2)?,
        ))
    })?;
    for k in rows {
        *seen.entry(k?).or_insert(0) += 1;
    }
    Ok(seen)
}

/// Parses `csv` with `mapping` (or the bank's saved one, or a guess) and
/// marks each row new, duplicate or error.
pub fn preview(
    index: &Index,
    csv: &str,
    mapping: Option<Mapping>,
    saved: Option<&Mapping>,
) -> Result<Preview, String> {
    let mut rows = parse_csv(csv)?;
    if rows.is_empty() {
        return Err("The file is empty.".into());
    }
    let headers = rows.remove(0);
    let (mapping, from_settings) = match (mapping, saved) {
        (Some(m), _) => (m, false),
        (None, Some(s)) if validate(s, &headers).is_ok() => (s.clone(), true),
        (None, _) => (guess(&headers, &rows), false),
    };
    let check = validate(&mapping, &headers);
    let col = |name: &Option<String>| {
        name.as_ref()
            .and_then(|n| headers.iter().position(|h| h == n))
    };
    let (date_i, desc_i) = (
        col(&Some(mapping.date.clone())),
        col(&Some(mapping.description.clone())),
    );
    let (amount_i, out_i, in_i, cat_i) = (
        col(&mapping.amount),
        col(&mapping.money_out),
        col(&mapping.money_in),
        col(&mapping.category),
    );
    let mut seen = existing(index).map_err(|e| e.to_string())?;

    let candidates: Vec<Candidate> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let get = |c: Option<usize>| c.and_then(|c| r.get(c)).map(String::as_str);
            let date = get(date_i).and_then(|d| parse_date(d, mapping.date_format));
            let description = cell(get(desc_i).unwrap_or_default());
            let category = get(cat_i).map(cell).filter(|c| !c.is_empty());
            let value = if amount_i.is_some() {
                get(amount_i).and_then(amount)
            } else {
                let out = get(out_i).and_then(amount).map(|p| -p.abs());
                let inn = get(in_i).and_then(amount).map(i64::abs);
                match (out, inn) {
                    (Some(o), None) | (Some(o), Some(0)) => Some(o),
                    (None, Some(n)) | (Some(0), Some(n)) => Some(n),
                    _ => None,
                }
            };
            let value = value.map(|v| if mapping.flip_sign { -v } else { v });
            let error = if let Err(e) = &check {
                Some(e.clone())
            } else if date.is_none() {
                Some("Date not recognised".to_owned())
            } else if value.is_none_or(|v| v == 0) {
                Some("No amount".to_owned())
            } else if description.is_empty() {
                Some("No description".to_owned())
            } else {
                None
            };
            let status = match (&error, &date, value) {
                (Some(_), _, _) => RowStatus::Error,
                (None, Some(d), Some(v)) => match seen.get_mut(&key(d, v, &description)) {
                    Some(n) if *n > 0 => {
                        *n -= 1;
                        RowStatus::Duplicate
                    }
                    _ => RowStatus::New,
                },
                _ => RowStatus::Error,
            };
            Candidate {
                line: i + 2,
                date,
                description,
                category,
                amount: value,
                status,
                error,
            }
        })
        .collect();

    let count = |s: RowStatus| candidates.iter().filter(|c| c.status == s).count();
    Ok(Preview {
        new: count(RowStatus::New),
        duplicates: count(RowStatus::Duplicate),
        errors: count(RowStatus::Error),
        headers,
        mapping,
        saved: from_settings,
        rows: candidates,
    })
}

/// Writes every new row of `preview` to its month's ledger note, one write
/// per month. Returns the result and each write's record for the log.
pub fn import(
    vault: &Path,
    preview: &Preview,
    account: Option<&str>,
) -> Result<(ImportResult, Vec<(String, WriteRecord)>), String> {
    let account = account.map(cell).unwrap_or_default();
    let mut by_month: BTreeMap<String, Vec<Vec<Value<'static>>>> = BTreeMap::new();
    for c in preview.rows.iter().filter(|c| c.status == RowStatus::New) {
        let (Some(date), Some(amount)) = (&c.date, c.amount) else {
            continue;
        };
        by_month.entry(date[..7].to_owned()).or_default().push(vec![
            (DATE_HEADERS, date.clone()),
            (DESCRIPTION_HEADERS, c.description.clone()),
            (CATEGORY_HEADERS, c.category.clone().unwrap_or_default()),
            (AMOUNT_HEADERS, format_pence(amount)),
            (ACCOUNT_HEADERS, account.clone()),
        ]);
    }
    let mut records = Vec::new();
    let mut imported = 0;
    for (month, rows) in &by_month {
        let rel = format!("Money/Ledger/{month}.md");
        let front = format!("type: ledger\nmonth: {month}");
        let record =
            write::append_rows(vault, &rel, &front, LEDGER_COLUMNS, rows).map_err(|e| {
                let done = if imported > 0 {
                    format!(" {imported} rows were saved before this; importing again skips them.")
                } else {
                    String::new()
                };
                format!("Could not save {rel}: {e}.{done}")
            })?;
        imported += rows.len();
        records.push((rel, record));
    }
    Ok((
        ImportResult {
            imported,
            duplicates: preview.duplicates,
            errors: preview.errors,
            files: records.iter().map(|(r, _)| r.clone()).collect(),
        },
        records,
    ))
}

/// Cleans a bank name for use as a settings key.
pub fn bank_name(name: &str) -> Result<String, String> {
    let name = cell(name);
    if name.is_empty() || name.chars().count() > MAX_BANK_CHARS {
        return Err("Give the bank a name of up to 60 characters.".into());
    }
    Ok(name)
}

/// Remembers `mapping` for `bank`, keeping at most `MAX_BANKS` banks.
pub fn remember(mappings: &mut BTreeMap<String, Mapping>, bank: &str, mapping: &Mapping) {
    if mappings.len() >= MAX_BANKS && !mappings.contains_key(bank) {
        return;
    }
    mappings.insert(bank.to_owned(), mapping.clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const STATEMENT: &str = "\u{feff}Date,Description,Paid out,Paid in,Balance\r\n\
        31/10/2026,\"CORNER GROCER, LONDON\",12.50,,100.00\r\n\
        30/10/2026,\"Payroll \"\"Oct\"\"\",,2400.00,112.50\r\n\
        30/10/2026,Coffee,3.20,,\r\n\
        30/10/2026,Coffee,3.20,,\r\n\
        \r\n\
        29/10/2026,Nothing,,,\r\n\
        32/10/2026,Bad date,1.00,,\r\n";

    #[test]
    fn parses_quotes_crlf_bom_and_blank_lines() {
        let rows = parse_csv(STATEMENT).expect("parse");
        assert_eq!(rows.len(), 7);
        assert_eq!(rows[0][0], "Date");
        assert_eq!(rows[1][1], "CORNER GROCER, LONDON");
        assert_eq!(rows[2][1], "Payroll \"Oct\"");
        assert_eq!(rows[6], vec!["32/10/2026", "Bad date", "1.00", "", ""]);
        assert!(parse_csv("a,\"b").is_err());
        assert!(parse_csv(&"x,".repeat(MAX_COLUMNS + 1)).is_err());
        assert!(parse_csv(&"x\n".repeat(MAX_ROWS + 2)).is_err());
        assert!(parse_csv(&"x".repeat(MAX_FIELD_CHARS + 1)).is_err());
        assert!(parse_csv(&" ".repeat(MAX_CSV_BYTES + 1)).is_err());
    }

    #[test]
    fn dates_and_amounts_follow_the_bank() {
        assert_eq!(
            parse_date("31/10/2026", DateFormat::Dmy).as_deref(),
            Some("2026-10-31")
        );
        assert_eq!(
            parse_date("31-10-26", DateFormat::Dmy).as_deref(),
            Some("2026-10-31")
        );
        assert_eq!(
            parse_date("10/31/2026", DateFormat::Mdy).as_deref(),
            Some("2026-10-31")
        );
        assert_eq!(
            parse_date("2026-10-31T09:15:00", DateFormat::Ymd).as_deref(),
            Some("2026-10-31")
        );
        for bad in ["31/13/2026", "2026/10", "1/1/1", "", "today"] {
            assert_eq!(parse_date(bad, DateFormat::Dmy), None, "{bad}");
        }
        assert_eq!(amount("(12.50)"), Some(-1250));
        assert_eq!(amount("£1,200.00"), Some(120_000));
        assert_eq!(amount(""), None);
    }

    #[test]
    fn guesses_uk_and_iso_statements() {
        let rows = parse_csv(STATEMENT).expect("parse");
        let m = guess(&rows[0], &rows[1..]);
        assert_eq!(m.date, "Date");
        assert_eq!(m.date_format, DateFormat::Dmy);
        assert_eq!(m.description, "Description");
        assert_eq!(
            (m.amount, m.money_out.as_deref(), m.money_in.as_deref()),
            (None, Some("Paid out"), Some("Paid in"))
        );
        let iso =
            parse_csv("Transaction Date,Merchant,Amount\n2026-10-01,Shop,-1\n").expect("parse");
        let m = guess(&iso[0], &iso[1..]);
        assert_eq!(
            (m.date_format, m.description.as_str(), m.amount.as_deref()),
            (DateFormat::Ymd, "Merchant", Some("Amount"))
        );
    }

    fn vault() -> (tempfile::TempDir, std::path::PathBuf, Index) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        (dir, root, Index::open_in_memory().expect("index"))
    }

    #[test]
    fn preview_then_import_then_reimport_adds_nothing() {
        let (_dir, root, mut index) = vault();
        let p = preview(&index, STATEMENT, None, None).expect("preview");
        assert_eq!((p.new, p.duplicates, p.errors), (4, 0, 2));
        assert_eq!(p.rows[0].amount, Some(-1250));
        assert_eq!(p.rows[1].amount, Some(240_000));
        assert_eq!(p.rows[1].description, "Payroll \"Oct\"");
        assert_eq!(p.rows[4].error.as_deref(), Some("No amount"));
        assert_eq!(p.rows[5].error.as_deref(), Some("Date not recognised"));
        assert_eq!(p.rows[5].line, 7, "rows are numbered without blank lines");

        let (result, records) = import(&root, &p, Some("Current")).expect("import");
        assert_eq!(result.imported, 4);
        assert_eq!(result.files, vec!["Money/Ledger/2026-10.md"]);
        assert_eq!(records.len(), 1);
        let text = fs::read_to_string(root.join("Money/Ledger/2026-10.md")).expect("read");
        assert!(text.contains("| 2026-10-31 | CORNER GROCER, LONDON |  | -12.50 | Current |"));
        assert_eq!(
            text.matches("| Coffee |").count(),
            2,
            "same-day repeats in one file are kept"
        );

        index.sync(&root).expect("sync");
        let again = preview(&index, STATEMENT, Some(p.mapping.clone()), None).expect("again");
        assert_eq!((again.new, again.duplicates), (0, 4));
        let (result, _) = import(&root, &again, None).expect("noop");
        assert_eq!(result.imported, 0);
    }

    #[test]
    fn signed_amounts_flipped_signs_and_saved_mappings() {
        let (_dir, _root, index) = vault();
        let csv =
            "When,What,Value,Type\n2026-10-01,Shop,12.00,Food\n2026-10-02,Refund,-5.00,Food\n";
        let mapping = Mapping {
            date: "When".into(),
            date_format: DateFormat::Ymd,
            description: "What".into(),
            amount: Some("Value".into()),
            money_out: None,
            money_in: None,
            category: Some("Type".into()),
            flip_sign: true,
        };
        let p = preview(&index, csv, None, Some(&mapping)).expect("preview");
        assert!(p.saved);
        assert_eq!(p.rows[0].amount, Some(-1200));
        assert_eq!(p.rows[1].amount, Some(500));
        assert_eq!(p.rows[0].category.as_deref(), Some("Food"));

        let mut wrong = mapping.clone();
        wrong.description = "Missing".into();
        let p = preview(&index, csv, Some(wrong), None).expect("preview");
        assert_eq!(p.errors, 2, "a bad mapping marks every row");
        assert_eq!(
            p.rows[0].error.as_deref(),
            Some("Choose the description column.")
        );
        let p = preview(
            &index,
            csv,
            None,
            Some(&Mapping {
                date: "Nope".into(),
                ..mapping
            }),
        )
        .expect("p");
        assert!(
            !p.saved,
            "a saved mapping that no longer fits falls back to a guess"
        );
    }

    #[test]
    fn bank_names_and_remembered_mappings_are_capped() {
        assert_eq!(
            bank_name("  Monzo | Joint ").as_deref(),
            Ok("Monzo / Joint")
        );
        assert!(bank_name(" ").is_err() && bank_name(&"b".repeat(61)).is_err());
        let m = guess(&["Date".into()], &[]);
        let mut all = BTreeMap::new();
        for i in 0..MAX_BANKS + 5 {
            remember(&mut all, &format!("Bank {i}"), &m);
        }
        assert_eq!(all.len(), MAX_BANKS);
    }
}
