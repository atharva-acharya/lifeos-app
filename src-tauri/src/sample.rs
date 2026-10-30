//! Sample data mode: a synthetic demo vault so a new owner can see every page
//! filled before pointing the app at their own notes.
//!
//! The templates live in `demo/` and are embedded in the binary. Dates are
//! tokens (`{{d-14}}`) rendered against the owner's local date, so charts are
//! always current. The demo vault is written to its own folder and indexed
//! into its own database file; it never shares either with the real vault
//! (threat model T23).

use std::fs;
use std::path::{Path, PathBuf};

use crate::applications::{self, Cache};
use crate::index::{Index, IndexError};
use crate::sample_templates::{APPLICATIONS, TEMPLATES};
use crate::vault::guard::{self, GuardError};
use crate::vault::note::is_iso_date;

/// Most days a token may reach back or forward.
const MAX_OFFSET: i64 = 3650;
const SAMPLE_DIR: &str = "sample";
const VAULT_DIR: &str = "vault";
const HEALTH_DIR: &str = "health";
pub const INDEX_FILE: &str = "index-sample.db";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SampleError {
    #[error("date must look like 2026-10-29")]
    BadDate,
    #[error("unknown token {{{{{0}}}}} in the sample data")]
    BadToken(String),
    #[error("a token in the sample data is not closed")]
    Unterminated,
    #[error("sample note path refused: {0}")]
    Guard(#[from] GuardError),
    #[error("could not write the sample data: {0}")]
    Io(String),
    #[error("the sample folder goes through a link or junction")]
    Link,
    #[error("sample index error: {0}")]
    Index(String),
}

impl From<std::io::Error> for SampleError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.kind().to_string())
    }
}

impl From<IndexError> for SampleError {
    fn from(e: IndexError) -> Self {
        Self::Index(e.to_string())
    }
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Parses `YYYY-MM-DD` into a day number, refusing dates that do not exist.
pub fn parse_date(s: &str) -> Result<i64, SampleError> {
    if !is_iso_date(s) {
        return Err(SampleError::BadDate);
    }
    let num = |r: std::ops::Range<usize>| s[r].parse::<i64>().map_err(|_| SampleError::BadDate);
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let days = days_from_civil(y, m, d);
    if !(1970..=2200).contains(&y) || civil_from_days(days) != (y, m, d) {
        return Err(SampleError::BadDate);
    }
    Ok(days)
}

fn iso(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// ISO 8601 week label such as `2026-W43`.
fn iso_week(days: i64) -> String {
    let weekday = (days + 3).rem_euclid(7); // Monday = 0
    let thursday = days - weekday + 3;
    let (year, _, _) = civil_from_days(thursday);
    let week = (thursday - days_from_civil(year, 1, 1)) / 7 + 1;
    format!("{year:04}-W{week:02}")
}

fn offset(digits: &str) -> Option<i64> {
    if digits.is_empty() || digits.len() > 4 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n <= MAX_OFFSET)
}

fn token(name: &str, today: i64) -> Result<String, SampleError> {
    let bad = || SampleError::BadToken(name.to_owned());
    if let Some(rest) = name.strip_prefix("wk-") {
        return Ok(iso_week(today - 7 * offset(rest).ok_or_else(bad)?));
    }
    if let Some(rest) = name.strip_prefix("d-") {
        return Ok(iso(today - offset(rest).ok_or_else(bad)?));
    }
    if let Some(rest) = name.strip_prefix("d+") {
        return Ok(iso(today + offset(rest).ok_or_else(bad)?));
    }
    Err(bad())
}

/// Replaces every `{{token}}` in `template`. An unknown or unclosed token is
/// an error, never left in the output.
pub fn render(template: &str, today: i64) -> Result<String, SampleError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find("}}").ok_or(SampleError::Unterminated)?;
        out.push_str(&token(&after[..end], today)?);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Every demo note as a vault-relative path and its text. Each path is
/// checked by the path guard before it is returned.
pub fn render_all(today: &str) -> Result<Vec<(String, String)>, SampleError> {
    let today = parse_date(today)?;
    TEMPLATES
        .iter()
        .map(|(path, text)| {
            let path = render(path, today)?;
            guard::check_relative(&path)?;
            Ok((path, render(text, today)?))
        })
        .collect()
}

/// The synthetic applications cache, as it would look after a fetch today.
pub fn applications(today: &str) -> Result<Cache, SampleError> {
    let text = render(APPLICATIONS, parse_date(today)?)?;
    let mut cache: Cache =
        serde_json::from_str(&text).map_err(|e| SampleError::Io(e.to_string()))?;
    cache.fetched_at = applications::now_ms();
    Ok(cache)
}

pub fn sample_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(SAMPLE_DIR)
}

pub fn vault_dir(data_dir: &Path) -> PathBuf {
    sample_dir(data_dir).join(VAULT_DIR)
}

pub fn index_path(data_dir: &Path) -> PathBuf {
    data_dir.join(INDEX_FILE)
}

fn index_files(data_dir: &Path) -> [PathBuf; 3] {
    let base = index_path(data_dir);
    let sibling = |suffix: &str| {
        let mut name = base.clone().into_os_string();
        name.push(suffix);
        PathBuf::from(name)
    };
    [base.clone(), sibling("-wal"), sibling("-shm")]
}

/// Deletes the sample folder and its index. The index must already be closed.
pub fn cleanup(data_dir: &Path) -> Result<(), SampleError> {
    for file in index_files(data_dir) {
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    match fs::remove_dir_all(sample_dir(data_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Wipes and re-creates the demo vault under `data_dir`, writing only paths
/// the guard accepted.
pub fn write_vault(data_dir: &Path, today: &str) -> Result<PathBuf, SampleError> {
    let notes = render_all(today)?;
    cleanup(data_dir)?;
    let root = vault_dir(data_dir);
    fs::create_dir_all(&root)?;
    refuse_link(&sample_dir(data_dir))?;
    write_notes(&root, &notes)?;
    Ok(root)
}

/// Refuses a link, junction or other reparse point at `path`.
fn refuse_link(path: &Path) -> Result<(), SampleError> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() || guard::is_reparse_point(&meta) {
        return Err(SampleError::Link);
    }
    Ok(())
}

/// Writes each note under `root`, creating folders as needed. Every folder on
/// the way is checked for links after it is created, and files are created
/// new, so nothing already there (or planted meanwhile) is followed or
/// overwritten.
fn write_notes(root: &Path, notes: &[(String, String)]) -> Result<(), SampleError> {
    use std::io::Write;

    refuse_link(root)?;
    for (rel, text) in notes {
        let path = guard::check_relative(rel)?;
        let dest = root.join(&path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
            let mut current = root.to_path_buf();
            for part in parent.strip_prefix(root).unwrap_or(parent).components() {
                current.push(part);
                refuse_link(&current)?;
            }
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)?;
        file.write_all(text.as_bytes())?;
    }
    Ok(())
}

/// The synthetic Health export folder, next to the demo vault.
pub fn health_dir(data_dir: &Path) -> PathBuf {
    sample_dir(data_dir).join(HEALTH_DIR)
}

/// One synthetic Health Auto Export file: 90 days of readings ending today,
/// a weight every week and an outdoor run every fifth day. Pure arithmetic on
/// the day number, so the same date always gives the same data.
fn health_export(today: i64) -> serde_json::Value {
    use serde_json::json;

    let stamp = |age: i64, time: &str| format!("{} {time} +0000", iso(today - age));
    let ages = || 0..90_i64;
    let wobble = |age: i64, modulus: i64| (age * 37 + 11).rem_euclid(modulus);
    let points = |value: &dyn Fn(i64) -> serde_json::Value| -> Vec<serde_json::Value> {
        ages()
            .map(|age| {
                let mut point = value(age);
                point["date"] = json!(stamp(age, "00:00:00"));
                point
            })
            .collect()
    };
    let weights: Vec<serde_json::Value> = ages()
        .filter(|age| age % 7 == 0)
        .map(|age| json!({ "date": stamp(age, "06:30:00"), "qty": 82.0 - 0.1 * (90 - age) as f64 / 7.0 }))
        .collect();
    let workouts: Vec<serde_json::Value> = ages()
        .filter(|age| age % 5 == 1)
        .map(|age| {
            json!({
                "id": format!("sample-run-{age}"),
                "name": "Outdoor Run",
                "start": stamp(age, "07:00:00"),
                "end": stamp(age, "07:30:00"),
                "duration": 1800,
                "activeEnergyBurned": { "qty": 280 + wobble(age, 60), "units": "kcal" },
                "distance": { "qty": 4.5 + wobble(age, 20) as f64 / 10.0, "units": "km" },
            })
        })
        .collect();
    json!({
        "data": {
            "metrics": [
                {
                    "name": "step_count",
                    "units": "count",
                    "data": points(&|age| json!({ "qty": 5500 + wobble(age, 5000) })),
                },
                {
                    "name": "active_energy",
                    "units": "kcal",
                    "data": points(&|age| json!({ "qty": 300 + wobble(age, 350) })),
                },
                {
                    "name": "resting_heart_rate",
                    "units": "count/min",
                    "data": points(&|age| json!({ "qty": 50 + wobble(age, 6) })),
                },
                {
                    "name": "heart_rate_variability",
                    "units": "ms",
                    "data": points(&|age| json!({ "qty": 38 + wobble(age, 14) })),
                },
                {
                    "name": "weight_body_mass",
                    "units": "kg",
                    "data": weights,
                },
                {
                    "name": "sleep_analysis",
                    "units": "hr",
                    "data": points(&|age| json!({
                        "totalSleep": 6.5 + wobble(age, 16) as f64 / 10.0,
                        "core": 4.0,
                        "deep": 1.1,
                        "rem": 1.6,
                        "awake": 0.4,
                    })),
                },
            ],
            "workouts": workouts,
        }
    })
}

/// Writes the synthetic Health export under `sample/health`. Both folders
/// are checked for links after they are created, and the file is created new.
pub fn write_health(data_dir: &Path, today: &str) -> Result<PathBuf, SampleError> {
    use std::io::Write;

    let today = parse_date(today)?;
    let dir = health_dir(data_dir);
    fs::create_dir_all(&dir)?;
    refuse_link(&sample_dir(data_dir))?;
    refuse_link(&dir)?;
    let text =
        serde_json::to_string(&health_export(today)).map_err(|e| SampleError::Io(e.to_string()))?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join("export-sample.json"))?;
    file.write_all(text.as_bytes())?;
    Ok(dir)
}

/// Writes the demo vault and indexes it into the separate sample index.
pub fn build(data_dir: &Path, today: &str) -> Result<(PathBuf, Index), SampleError> {
    let root = write_vault(data_dir, today)?;
    write_health(data_dir, today)?;
    let mut index = Index::open(&index_path(data_dir))?;
    index.sync(&root)?;
    Ok((root, index))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-10-30";

    fn day(s: &str) -> i64 {
        parse_date(s).expect("date")
    }

    #[test]
    fn date_arithmetic_round_trips() {
        assert_eq!(day("1970-01-01"), 0);
        assert_eq!(iso(day("2026-10-30") - 14), "2026-10-16");
        assert_eq!(iso(day("2026-03-01") - 1), "2026-02-28");
        assert_eq!(iso(day("2024-03-01") - 1), "2024-02-29");
        assert_eq!(iso(day("2026-12-31") + 1), "2027-01-01");
    }

    #[test]
    fn impossible_dates_are_refused() {
        for bad in [
            "2026-02-30",
            "2026-13-01",
            "26-10-30",
            "",
            "2026-10-3x",
            "1800-01-01",
        ] {
            assert_eq!(parse_date(bad), Err(SampleError::BadDate), "{bad}");
        }
    }

    #[test]
    fn iso_weeks_match_the_calendar() {
        assert_eq!(iso_week(day("2026-10-30")), "2026-W44");
        assert_eq!(iso_week(day("2026-01-01")), "2026-W01");
        assert_eq!(iso_week(day("2021-01-03")), "2020-W53");
        assert_eq!(iso_week(day("2024-12-30")), "2025-W01");
    }

    #[test]
    fn tokens_are_rendered_relative_to_the_given_date() {
        let t = day(TODAY);
        assert_eq!(
            render("a {{d-0}} b {{d-14}} c {{d+5}} d {{wk-1}}", t).expect("render"),
            "a 2026-10-30 b 2026-10-16 c 2026-11-04 d 2026-W43"
        );
        assert_eq!(render("no tokens", t).expect("render"), "no tokens");
    }

    #[test]
    fn bad_tokens_are_errors() {
        let t = day(TODAY);
        for bad in [
            "{{x}}",
            "{{d}}",
            "{{d-}}",
            "{{d-x}}",
            "{{d--1}}",
            "{{d-99999}}",
            "{{ d-1 }}",
            "{{D-1}}",
            "{{}}",
        ] {
            assert!(
                matches!(render(bad, t), Err(SampleError::BadToken(_))),
                "{bad}"
            );
        }
        assert_eq!(render("{{d-1", t), Err(SampleError::Unterminated));
    }

    #[test]
    fn every_demo_path_passes_the_guard_and_is_unique() {
        let notes = render_all(TODAY).expect("render");
        assert!(notes.len() > 80);
        let mut seen = std::collections::HashSet::new();
        for (path, text) in &notes {
            guard::check_relative(path).unwrap_or_else(|e| panic!("{path}: {e}"));
            assert!(seen.insert(path.clone()), "duplicate {path}");
            assert!(!text.contains("{{"), "{path} has an unrendered token");
        }
    }

    #[test]
    fn rendering_needs_a_valid_date() {
        assert_eq!(render_all("tomorrow").err(), Some(SampleError::BadDate));
        assert_eq!(applications("nope").err(), Some(SampleError::BadDate));
    }

    #[test]
    fn demo_vault_indexes_with_no_errors_and_covers_every_page() {
        let dir = tempfile::tempdir().expect("dir");
        let (root, index) = build(dir.path(), TODAY).expect("build");
        assert_eq!(root, vault_dir(dir.path()));
        let count = |table: &str| -> i64 {
            index
                .conn()
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .expect("count")
        };
        assert_eq!(count("daily"), 60);
        assert_eq!(count("workout"), 15);
        assert_eq!(count("company"), 6);
        assert_eq!(count("project"), 2);
        assert_eq!(count("plan"), 1);
        assert_eq!(count("weekly"), 1);
        assert!(count("outreach") >= 5);
        assert_eq!(count("ledger"), 20);
        assert_eq!(count("budget"), 6);
        let errors: i64 = index
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM notes WHERE error IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .expect("errors");
        assert_eq!(errors, 0);

        let today = crate::today::today(&index, TODAY).expect("today");
        assert_eq!(today.date, TODAY);
        assert!(today.weight.is_some());
        assert!(today.project.is_some());
        assert!(!today.follow_ups.is_empty());
        let fitness = crate::fitness::fitness(&index, TODAY).expect("fitness");
        assert!(fitness.days.len() > 50);
        assert!(!fitness.lifts.is_empty());
    }

    #[test]
    fn sample_index_is_a_different_file_from_the_real_one() {
        let dir = tempfile::tempdir().expect("dir");
        let real = dir.path().join("index.db");
        assert_ne!(index_path(dir.path()), real);
        let (_root, index) = build(dir.path(), TODAY).expect("build");
        assert!(index_path(dir.path()).exists());
        assert!(!real.exists());
        assert!(!vault_dir(dir.path()).starts_with(dir.path().join("Daily")));
        drop(index);
    }

    #[test]
    fn existing_files_are_never_overwritten() {
        let dir = tempfile::tempdir().expect("dir");
        let notes = vec![("Daily/a.md".to_owned(), "new".to_owned())];
        fs::create_dir_all(dir.path().join("Daily")).expect("mkdir");
        fs::write(dir.path().join("Daily/a.md"), "old").expect("seed");
        assert!(matches!(
            write_notes(dir.path(), &notes),
            Err(SampleError::Io(_))
        ));
        assert_eq!(
            fs::read_to_string(dir.path().join("Daily/a.md")).expect("read"),
            "old"
        );
    }

    #[test]
    fn bad_paths_are_refused_before_writing() {
        let dir = tempfile::tempdir().expect("dir");
        let notes = vec![("../escape.md".to_owned(), "x".to_owned())];
        assert!(matches!(
            write_notes(dir.path(), &notes),
            Err(SampleError::Guard(_))
        ));
        assert!(!dir.path().join("../escape.md").exists());
    }

    /// Makes `link` point at `target` (a junction on Windows, else a symlink).
    fn make_link(target: &Path, link: &Path) {
        #[cfg(windows)]
        {
            let out = std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .expect("run mklink");
            assert!(out.status.success(), "mklink failed");
        }
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(target, link).expect("symlink");
    }

    #[test]
    fn a_planted_link_inside_the_vault_is_refused() {
        let dir = tempfile::tempdir().expect("dir");
        let outside = tempfile::tempdir().expect("outside");
        let root = dir.path().join("vault");
        fs::create_dir_all(&root).expect("root");
        make_link(outside.path(), &root.join("Daily"));
        let notes = vec![("Daily/a.md".to_owned(), "x".to_owned())];
        assert_eq!(write_notes(&root, &notes), Err(SampleError::Link));
        assert!(!outside.path().join("a.md").exists());
    }

    #[test]
    fn a_link_as_the_vault_root_is_refused() {
        let dir = tempfile::tempdir().expect("dir");
        let outside = tempfile::tempdir().expect("outside");
        let root = dir.path().join("vault");
        make_link(outside.path(), &root);
        let notes = vec![("a.md".to_owned(), "x".to_owned())];
        assert_eq!(write_notes(&root, &notes), Err(SampleError::Link));
        assert!(!outside.path().join("a.md").exists());
    }

    #[test]
    fn rebuilding_wipes_leftovers() {
        let dir = tempfile::tempdir().expect("dir");
        let root = write_vault(dir.path(), TODAY).expect("write");
        fs::write(root.join("stale.md"), "x").expect("stale");
        let root = write_vault(dir.path(), TODAY).expect("rewrite");
        assert!(!root.join("stale.md").exists());
        assert!(root.join("Daily").join(format!("{TODAY}.md")).exists());
    }

    #[test]
    fn cleanup_removes_the_folder_and_index_but_nothing_else() {
        let dir = tempfile::tempdir().expect("dir");
        fs::write(dir.path().join("index.db"), "real").expect("real index");
        fs::write(dir.path().join("settings.json"), "{}").expect("settings");
        let (_root, index) = build(dir.path(), TODAY).expect("build");
        drop(index);
        cleanup(dir.path()).expect("cleanup");
        assert!(!sample_dir(dir.path()).exists());
        assert!(!index_path(dir.path()).exists());
        assert!(dir.path().join("index.db").exists());
        assert!(dir.path().join("settings.json").exists());
        cleanup(dir.path()).expect("cleanup is repeatable");
    }

    fn sample_health(data: &Path, today: &str) -> crate::health::Health {
        let folder = write_health(data, today).expect("write health");
        let state = crate::health::HealthState::default();
        let imported = state.load(&folder).expect("load");
        let now = applications::now_ms();
        crate::health::health(&imported, None, today, now).expect("health")
    }

    #[test]
    fn sample_health_is_dated_from_today_and_parses_cleanly() {
        let dir = tempfile::tempdir().expect("dir");
        let health = sample_health(dir.path(), TODAY);
        assert_eq!(health.file_count, 1);
        assert_eq!(health.bad_file_count, 0);
        assert!(!health.stale);
        assert_eq!(health.latest_data.as_deref(), Some(TODAY));
        assert_eq!(health.days.len(), 90);
        assert_eq!(health.days[89].date, TODAY);
        assert!(health.days[89].steps.is_some());
        assert!(health.days[89].sleep.is_some());
        assert!(health.days.iter().any(|d| d.weight.is_some()));
        assert!(!health.workouts.is_empty());
        assert!(health.workouts.iter().all(|w| w.source == "health"));
    }

    #[test]
    fn sample_health_follows_the_given_date_across_a_year_boundary() {
        let dir = tempfile::tempdir().expect("dir");
        let health = sample_health(dir.path(), "2027-01-02");
        assert_eq!(health.latest_data.as_deref(), Some("2027-01-02"));
        assert_eq!(health.days[0].date, iso(day("2027-01-02") - 89));
        assert!(health.days[0].date.starts_with("2026-"));
    }

    #[test]
    fn sample_health_lives_under_the_sample_folder_and_is_cleaned_up() {
        let dir = tempfile::tempdir().expect("dir");
        let folder = write_health(dir.path(), TODAY).expect("write");
        assert_eq!(folder, health_dir(dir.path()));
        assert!(folder.starts_with(sample_dir(dir.path())));
        // Writing again over the same folder is refused, never merged.
        assert!(write_health(dir.path(), TODAY).is_err());
        cleanup(dir.path()).expect("cleanup");
        assert!(!folder.exists());
    }

    #[test]
    fn sample_health_refuses_a_bad_date() {
        let dir = tempfile::tempdir().expect("dir");
        assert_eq!(
            write_health(dir.path(), "2026-02-30"),
            Err(SampleError::BadDate)
        );
        assert!(!health_dir(dir.path()).exists());
    }

    #[test]
    fn applications_cache_is_synthetic_and_dated_from_today() {
        let cache = applications(TODAY).expect("apps");
        assert!(cache.rows.len() >= 10);
        assert!(cache.fetched_at > 0);
        assert!(cache.missing_columns.is_empty());
        for row in &cache.rows {
            let applied = row.applied.as_deref().expect("applied");
            assert!(is_iso_date(applied) && applied <= TODAY, "{applied}");
        }
    }
}
