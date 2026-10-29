//! Scans the synthetic fixture vault end to end.

use std::path::Path;

use lifeos_app_lib::vault::{note::Note, scan};

fn fixture() -> Vec<lifeos_app_lib::vault::Entry> {
    scan(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault")).expect("scan")
}

#[test]
fn reads_every_note_and_skips_hidden_archived_and_non_markdown() {
    let paths: Vec<String> = fixture().into_iter().map(|e| e.path).collect();
    assert_eq!(
        paths,
        [
            "Daily/2026-01-12.md",
            "Daily/2026-01-13.md",
            "Fitness/Log/2026-01-13-pull-a.md",
            "Inbox.md",
            "Jobs/Companies/Example Security Ltd.md",
            "Jobs/Companies/Sample Bank.md",
            "Projects/home-lab.md",
            "Weekly/2026-W02.md",
        ]
    );
}

#[test]
fn types_each_note() {
    let entries = fixture();
    let kind = |p: &str| {
        let e = entries.iter().find(|e| e.path == p).expect("present");
        match &e.note {
            Some(Note::Daily(_)) => "daily",
            Some(Note::Workout(_)) => "workout",
            Some(Note::Company(_)) => "company",
            Some(Note::Weekly(_)) => "weekly",
            Some(Note::Project(_)) => "project",
            Some(Note::Other) => "other",
            None => "error",
        }
    };
    assert_eq!(kind("Daily/2026-01-13.md"), "daily");
    assert_eq!(kind("Fitness/Log/2026-01-13-pull-a.md"), "workout");
    assert_eq!(kind("Jobs/Companies/Example Security Ltd.md"), "company");
    assert_eq!(kind("Weekly/2026-W02.md"), "weekly");
    assert_eq!(kind("Projects/home-lab.md"), "project");
    assert_eq!(kind("Inbox.md"), "other");
}

#[test]
fn bad_note_is_recorded_not_fatal() {
    let entries = fixture();
    let bad = entries
        .iter()
        .find(|e| e.path == "Jobs/Companies/Sample Bank.md")
        .expect("present");
    assert!(bad.note.is_none());
    assert!(bad.error.as_deref().is_some_and(|e| e.contains("stage")));
}
