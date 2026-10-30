//! Sample data mode: date tokens across calendar boundaries, the path guard
//! over everything the demo writes, and the on-disk lifecycle (enter twice,
//! leave) never touching the owner's own files.

use std::fs;
use std::path::{Path, PathBuf};

use lifeos_app_lib::sample::{self, SampleError};
use lifeos_app_lib::vault::guard;
use proptest::prelude::*;

fn day(s: &str) -> i64 {
    sample::parse_date(s).expect("date")
}

fn render(template: &str, today: &str) -> String {
    sample::render(template, day(today)).expect("render")
}

fn files_under(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).expect("read_dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .expect("read_dir")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn tokens_cross_month_and_year_boundaries() {
    // 2027-01-03 is a Sunday, in ISO week 53 of 2026.
    assert_eq!(render("{{d-0}}", "2027-01-03"), "2027-01-03");
    assert_eq!(render("{{d-14}}", "2027-01-03"), "2026-12-20");
    assert_eq!(render("{{d-3}}", "2027-01-03"), "2026-12-31");
    assert_eq!(render("{{d+30}}", "2027-01-03"), "2027-02-02");
    assert_eq!(render("{{wk-0}}", "2027-01-03"), "2026-W53");
    assert_eq!(render("{{wk-1}}", "2027-01-03"), "2026-W52");
    assert_eq!(render("{{wk-2}}", "2027-01-03"), "2026-W51");
    // The Monday after starts week 1 of 2027.
    assert_eq!(render("{{wk-0}}", "2027-01-04"), "2027-W01");
    assert_eq!(render("{{wk-1}}", "2027-01-04"), "2026-W53");
    // 2025-12-29 is a Monday that already belongs to 2026-W01.
    assert_eq!(render("{{wk-0}}", "2025-12-29"), "2026-W01");
    assert_eq!(render("{{wk-0}}", "2024-12-30"), "2025-W01");
}

#[test]
fn tokens_handle_month_ends_and_leap_days() {
    assert_eq!(render("{{d+1}}", "2028-02-28"), "2028-02-29");
    assert_eq!(render("{{d+1}}", "2027-02-28"), "2027-03-01");
    assert_eq!(render("{{d+1}}", "2026-12-31"), "2027-01-01");
    assert_eq!(render("{{d-1}}", "2027-03-01"), "2027-02-28");
    assert_eq!(render("{{d-56}}", "2028-03-01"), "2028-01-05");
    // 2028 is a leap year, so 365 days back from its last day is its first.
    assert_eq!(render("{{d-365}}", "2028-12-31"), "2028-01-01");
    assert_eq!(render("{{d-365}}", "2027-12-31"), "2026-12-31");
}

#[test]
fn bad_tokens_and_dates_are_refused_not_passed_through() {
    let today = day("2026-10-30");
    for bad in [
        "{{d-}}",
        "{{d-x}}",
        "{{d--1}}",
        "{{d-99999}}",
        "{{d-3651}}",
        "{{wk-}}",
        "{{today}}",
        "{{../etc}}",
        "{{}}",
    ] {
        assert!(
            matches!(sample::render(bad, today), Err(SampleError::BadToken(_))),
            "{bad}"
        );
    }
    assert_eq!(
        sample::render("{{d-1", today),
        Err(SampleError::Unterminated)
    );
    for bad in [
        "2027-02-29",
        "2026-13-01",
        "2026-00-10",
        "1969-12-31",
        "x",
        "",
    ] {
        assert!(sample::parse_date(bad).is_err(), "{bad}");
    }
}

#[test]
fn demo_renders_cleanly_across_a_year_boundary() {
    for date in ["2027-01-03", "2028-02-29", "2026-12-31"] {
        let notes = sample::render_all(date).expect(date);
        for (path, text) in &notes {
            assert!(
                !text.contains("{{") && !path.contains("{{"),
                "{date} {path}"
            );
        }
        sample::applications(date).expect(date);
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(48))]

    /// Whatever the local date is, every demo path is a plain relative
    /// markdown path the guard accepts.
    #[test]
    fn every_rendered_path_passes_the_guard(y in 1971i32..2199, m in 1u32..=12, d in 1u32..=28) {
        let date = format!("{y:04}-{m:02}-{d:02}");
        let notes = sample::render_all(&date).expect("render");
        let mut seen = std::collections::HashSet::new();
        for (path, _) in &notes {
            let checked = guard::check_relative(path).expect(path);
            prop_assert!(!checked.is_absolute());
            prop_assert!(path.ends_with(".md"), "{}", path);
            prop_assert!(!path.contains(".."), "{}", path);
            prop_assert!(!path.contains(':') && !path.starts_with('/') && !path.starts_with('\\'));
            prop_assert!(seen.insert(path.clone()), "duplicate {}", path);
        }
    }

    /// Nothing the demo writes lands outside the sample root.
    #[test]
    fn written_files_stay_under_the_sample_root(y in 1971i32..2199, m in 1u32..=12, d in 1u32..=28) {
        let date = format!("{y:04}-{m:02}-{d:02}");
        let data = tempfile::tempdir().expect("dir");
        let root = sample::write_vault(data.path(), &date).expect("write");
        prop_assert_eq!(&root, &sample::vault_dir(data.path()));
        let expected = sample::render_all(&date).expect("render").len();
        let files = files_under(data.path());
        prop_assert_eq!(files.len(), expected);
        for file in files {
            prop_assert!(file.starts_with(&root), "{}", file.display());
        }
    }

    /// Any text is either rendered or refused; a rendered result has no token left.
    #[test]
    fn render_never_leaves_a_token_behind(s in "[a-z{}+\\- 0-9]{0,40}") {
        if let Ok(out) = sample::render(&s, day("2026-10-30")) {
            prop_assert!(!out.contains("{{"), "{}", out);
        }
    }
}

#[test]
fn the_sample_index_is_never_the_real_index() {
    let data = Path::new("data");
    assert_ne!(sample::index_path(data), data.join("index.db"));
    assert_eq!(sample::index_path(data).parent(), Some(data));
    assert!(sample::vault_dir(data).starts_with(sample::sample_dir(data)));
}

const SETTINGS_BYTES: &[u8] =
    b"{\r\n  \"vaultPath\": \"C:\\\\Users\\\\someone\\\\Vault\",\r\n  \"unknown\":  [1,2 ,3]\r\n}  ";

fn seed_real_profile(data: &Path) {
    fs::write(data.join("settings.json"), SETTINGS_BYTES).expect("settings");
    fs::write(data.join("index.db"), b"real index bytes").expect("index");
    fs::write(data.join("applications.json"), b"{\"rows\":[]}").expect("apps");
}

#[test]
fn enter_then_leave_leaves_the_real_profile_byte_for_byte() {
    let data = tempfile::tempdir().expect("dir");
    seed_real_profile(data.path());
    let before = names_in(data.path());

    let (_root, index) = sample::build(data.path(), "2026-10-30").expect("enter");
    assert!(sample::index_path(data.path()).exists());
    drop(index); // the command drops the index before cleanup
    sample::cleanup(data.path()).expect("leave");

    assert_eq!(
        fs::read(data.path().join("settings.json")).expect("settings"),
        SETTINGS_BYTES
    );
    assert_eq!(
        fs::read(data.path().join("index.db")).expect("index"),
        b"real index bytes"
    );
    assert_eq!(
        fs::read(data.path().join("applications.json")).expect("cache"),
        b"{\"rows\":[]}"
    );
    assert_eq!(names_in(data.path()), before);
}

#[test]
fn entering_twice_in_a_row_rebuilds_without_leftovers() {
    let data = tempfile::tempdir().expect("dir");
    seed_real_profile(data.path());

    let (root, index) = sample::build(data.path(), "2026-10-30").expect("first");
    fs::write(
        root.join("Daily").join("stale.md"),
        "---\ntype: daily\n---\n",
    )
    .expect("stale");
    drop(index);
    let (root, index) = sample::build(data.path(), "2027-01-03").expect("second");
    assert!(!root.join("Daily").join("stale.md").exists());
    // Only the second date's notes are there.
    assert!(root.join("Daily").join("2027-01-03.md").exists());
    assert!(!root.join("Daily").join("2026-10-30.md").exists());
    drop(index);

    sample::cleanup(data.path()).expect("leave");
    let mut expected = vec!["applications.json", "index.db", "settings.json"];
    expected.sort_unstable();
    assert_eq!(names_in(data.path()), expected);
}

#[test]
fn leaving_without_ever_entering_or_without_a_real_vault_is_a_clean_no_op() {
    let data = tempfile::tempdir().expect("dir");
    sample::cleanup(data.path()).expect("nothing to remove");
    assert!(names_in(data.path()).is_empty());

    // No settings.json at all (first run): enter and leave must not create one.
    let (_root, index) = sample::build(data.path(), "2026-10-30").expect("enter");
    drop(index);
    sample::cleanup(data.path()).expect("leave");
    assert!(names_in(data.path()).is_empty());
    sample::cleanup(data.path()).expect("twice");
}

#[test]
fn leaving_removes_sqlite_sidecar_files_too() {
    let data = tempfile::tempdir().expect("dir");
    let (_root, index) = sample::build(data.path(), "2026-10-30").expect("enter");
    drop(index);
    let index_file = sample::index_path(data.path());
    for suffix in ["-wal", "-shm"] {
        let mut name = index_file.clone().into_os_string();
        name.push(suffix);
        fs::write(PathBuf::from(name), b"x").expect("sidecar");
    }
    sample::cleanup(data.path()).expect("leave");
    assert!(names_in(data.path()).is_empty());
}
