//! First-run setup checklist (design: onboarding). Items are computed live
//! from settings and the index; only the skip and dismiss choices are stored.

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::index::Index;
use crate::settings::{Onboarding, Settings};

/// Checklist items in display order. Anything else the UI sends is refused.
pub const ITEM_IDS: &[&str] = &["vault", "daily", "plan", "sheet", "projects", "health"];
const PLAN_PATH: &str = "Fitness/Plan.md";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OnboardingError {
    #[error("unknown setup item")]
    UnknownItem,
    #[error("the vault folder is required and cannot be skipped")]
    Required,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupItem {
    pub id: &'static str,
    pub title: &'static str,
    pub required: bool,
    pub done: bool,
    /// Skipped and not done. A done item is never shown as skipped.
    pub skipped: bool,
    /// Extra progress, for example "2 of 3 fields".
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub items: Vec<SetupItem>,
    pub dismissed: bool,
    pub total: usize,
    pub set_up: usize,
    pub skipped: usize,
    /// Every item is done or skipped.
    pub complete: bool,
}

fn title(id: &str) -> &'static str {
    match id {
        "vault" => "Vault folder",
        "daily" => "Daily notes",
        "plan" => "Fitness plan",
        "sheet" => "Google Sheet",
        "health" => "Health export",
        _ => "Projects",
    }
}

fn has_rows(index: &Index, sql: &str) -> bool {
    index
        .conn()
        .query_row(sql, [], |r| r.get::<_, i64>(0))
        .is_ok_and(|n| n > 0)
}

/// How many of target weight, steps goal and protein goal the plan note sets.
fn plan_fields(index: &Index) -> rusqlite::Result<Option<i64>> {
    index
        .conn()
        .query_row(
            "SELECT (target_weight IS NOT NULL) + (steps_goal IS NOT NULL) + (protein_goal IS NOT NULL)
             FROM plan ORDER BY path = ?1 DESC, path LIMIT 1",
            params![PLAN_PATH],
            |r| r.get(0),
        )
        .optional()
}

/// Builds the checklist. `index` is `None` while no vault is open.
pub fn compute(settings: &Settings, google_connected: bool, index: Option<&Index>) -> Setup {
    let google_ready =
        settings.google.as_ref().is_some_and(|g| g.is_complete()) && google_connected;
    let daily = index.is_some_and(|i| has_rows(i, "SELECT COUNT(*) FROM daily"));
    let projects = index.is_some_and(|i| has_rows(i, "SELECT COUNT(*) FROM project"));
    let plan = index.and_then(|i| plan_fields(i).ok().flatten());

    let items: Vec<SetupItem> = ITEM_IDS
        .iter()
        .map(|&id| {
            let (done, detail) = match id {
                "vault" => (settings.vault_path.is_some(), None),
                "daily" => (daily, None),
                "plan" => match plan {
                    Some(3) => (true, None),
                    Some(n) => (false, Some(format!("{n} of 3 fields"))),
                    None => (false, None),
                },
                "sheet" => (google_ready, None),
                "health" => (settings.health_path.is_some(), None),
                _ => (projects, None),
            };
            SetupItem {
                id,
                title: title(id),
                required: id == "vault",
                done,
                skipped: !done && settings.onboarding.skipped.iter().any(|s| s == id),
                detail,
            }
        })
        .collect();
    let set_up = items.iter().filter(|i| i.done).count();
    let skipped = items.iter().filter(|i| i.skipped).count();
    Setup {
        total: items.len(),
        set_up,
        skipped,
        complete: set_up + skipped == items.len(),
        dismissed: settings.onboarding.dismissed,
        items,
    }
}

fn check(id: &str) -> Result<(), OnboardingError> {
    if !ITEM_IDS.contains(&id) {
        return Err(OnboardingError::UnknownItem);
    }
    if id == "vault" {
        return Err(OnboardingError::Required);
    }
    Ok(())
}

pub fn skip(onboarding: &mut Onboarding, id: &str) -> Result<(), OnboardingError> {
    check(id)?;
    if !onboarding.skipped.iter().any(|s| s == id) {
        onboarding.skipped.push(id.to_owned());
    }
    Ok(())
}

pub fn unskip(onboarding: &mut Onboarding, id: &str) -> Result<(), OnboardingError> {
    check(id)?;
    onboarding.skipped.retain(|s| s != id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::google::GoogleConfig;

    fn fixture_index() -> Index {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault");
        let mut index = Index::open_in_memory().expect("index");
        index.sync(&root).expect("sync");
        index
    }

    fn item<'a>(s: &'a Setup, id: &str) -> &'a SetupItem {
        s.items.iter().find(|i| i.id == id).expect("item")
    }

    fn with_vault() -> Settings {
        Settings {
            vault_path: Some(PathBuf::from("vault")),
            ..Settings::default()
        }
    }

    #[test]
    fn blank_profile_has_nothing_done() {
        let s = compute(&Settings::default(), false, None);
        assert_eq!((s.set_up, s.skipped, s.total), (0, 0, 6));
        assert!(!s.complete);
        assert!(item(&s, "vault").required);
        assert!(s.items.iter().all(|i| !i.done && i.detail.is_none()));
    }

    #[test]
    fn fixture_vault_marks_notes_items_done() {
        let index = fixture_index();
        let s = compute(&with_vault(), false, Some(&index));
        assert!(item(&s, "vault").done);
        assert!(item(&s, "daily").done);
        assert!(item(&s, "plan").done);
        assert!(item(&s, "projects").done);
        assert!(!item(&s, "sheet").done);
        assert_eq!((s.set_up, s.skipped), (4, 0));
        assert!(!item(&s, "health").done);
    }

    #[test]
    fn health_is_done_once_its_folder_is_set() {
        let mut settings = with_vault();
        assert!(!item(&compute(&settings, false, None), "health").done);
        settings.health_path = Some(PathBuf::from("health"));
        let s = compute(&settings, false, None);
        assert!(item(&s, "health").done);
        assert!(!item(&s, "health").required);
        assert_eq!((s.set_up, s.total), (2, 6));
    }

    #[test]
    fn partial_plan_reports_fields() {
        let mut index = Index::open_in_memory().expect("index");
        let dir = tempfile::tempdir().expect("dir");
        std::fs::create_dir_all(dir.path().join("Fitness")).expect("mkdir");
        std::fs::write(
            dir.path().join("Fitness/Plan.md"),
            "---\ntype: plan\ntarget_weight: 80\nsteps_goal: 9000\n---\n",
        )
        .expect("write");
        index.sync(dir.path()).expect("sync");
        let s = compute(&with_vault(), false, Some(&index));
        let plan = item(&s, "plan");
        assert!(!plan.done);
        assert_eq!(plan.detail.as_deref(), Some("2 of 3 fields"));
        assert!(!item(&s, "daily").done);
        assert!(!item(&s, "projects").done);
    }

    #[test]
    fn sheet_needs_config_and_connection() {
        let mut settings = with_vault();
        settings.google = Some(GoogleConfig {
            client_id: "x.apps.googleusercontent.com".to_owned(),
            client_secret: "GOCSPX-secret".to_owned(),
            sheet_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab".to_owned(),
        });
        assert!(!item(&compute(&settings, false, None), "sheet").done);
        assert!(item(&compute(&settings, true, None), "sheet").done);
        assert!(!item(&compute(&with_vault(), true, None), "sheet").done);
    }

    #[test]
    fn skip_and_unskip_round_trip() {
        let mut settings = with_vault();
        skip(&mut settings.onboarding, "plan").expect("skip");
        skip(&mut settings.onboarding, "plan").expect("skip again");
        assert_eq!(settings.onboarding.skipped, ["plan"]);
        let s = compute(&settings, false, None);
        assert!(item(&s, "plan").skipped);
        assert_eq!((s.set_up, s.skipped), (1, 1));

        unskip(&mut settings.onboarding, "plan").expect("unskip");
        assert!(settings.onboarding.skipped.is_empty());
        assert_eq!(compute(&settings, false, None).skipped, 0);
    }

    #[test]
    fn done_items_are_not_shown_as_skipped() {
        let index = fixture_index();
        let mut settings = with_vault();
        skip(&mut settings.onboarding, "daily").expect("skip");
        let s = compute(&settings, false, Some(&index));
        assert!(item(&s, "daily").done && !item(&s, "daily").skipped);
        assert_eq!(s.skipped, 0);
    }

    #[test]
    fn everything_handled_completes_the_checklist() {
        let index = fixture_index();
        let mut settings = with_vault();
        skip(&mut settings.onboarding, "sheet").expect("skip");
        assert!(!compute(&settings, false, Some(&index)).complete);
        skip(&mut settings.onboarding, "health").expect("skip");
        assert!(compute(&settings, false, Some(&index)).complete);
    }

    #[test]
    fn unknown_and_required_items_are_refused() {
        let mut o = Onboarding::default();
        assert_eq!(skip(&mut o, "nope"), Err(OnboardingError::UnknownItem));
        assert_eq!(skip(&mut o, ""), Err(OnboardingError::UnknownItem));
        assert_eq!(skip(&mut o, "Health"), Err(OnboardingError::UnknownItem));
        assert_eq!(skip(&mut o, "vault"), Err(OnboardingError::Required));
        assert_eq!(unskip(&mut o, "../x"), Err(OnboardingError::UnknownItem));
        assert!(o.skipped.is_empty());
    }

    #[test]
    fn choices_survive_a_save() {
        let dir = tempfile::tempdir().expect("dir");
        let mut settings = with_vault();
        skip(&mut settings.onboarding, "projects").expect("skip");
        settings.onboarding.dismissed = true;
        crate::settings::save(dir.path(), &settings).expect("save");
        let loaded = crate::settings::load(dir.path()).expect("load");
        assert_eq!(loaded.onboarding, settings.onboarding);
        // A settings file from before onboarding still loads.
        std::fs::write(dir.path().join("settings.json"), r#"{"vaultPath":null}"#).expect("write");
        assert_eq!(
            crate::settings::load(dir.path()).expect("load").onboarding,
            Onboarding::default()
        );
    }
}
