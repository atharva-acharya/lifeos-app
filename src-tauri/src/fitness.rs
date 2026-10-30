//! Data for the Fitness page (requirements §3.3), read from the index.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use crate::index::Index;
use crate::vault::note::{ExerciseSet, parse_exercise};

/// Days of daily notes shown, counting today.
const WINDOW_DAYS: i64 = 90;
const MAX_WORKOUTS: i64 = 500;
const DEFAULT_STEPS_GOAL: i64 = 8000;
const DEFAULT_PROTEIN_GOAL: i64 = 170;
const PLAN_PATH: &str = "Fitness/Plan.md";

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fitness {
    /// Oldest first.
    pub days: Vec<Day>,
    pub plan: Option<PlanView>,
    /// Newest first.
    pub workouts: Vec<WorkoutView>,
    pub lifts: Vec<Lift>,
    /// Notes under `Daily/` or `Fitness/` the app could not read.
    pub parse_errors: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub weight: Option<f64>,
    pub steps: Option<i64>,
    pub protein_g: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub start_weight: Option<f64>,
    pub target_weight: Option<f64>,
    pub steps_goal: i64,
    pub protein_goal: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutView {
    pub path: String,
    pub date: Option<String>,
    pub day: Option<String>,
    pub week: Option<i64>,
    pub deload: bool,
    pub duration_min: Option<i64>,
    pub exercises: Vec<ExerciseSet>,
}

/// One exercise across sessions; deload sessions are left out.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lift {
    pub name: String,
    /// Oldest first.
    pub sessions: Vec<LiftSession>,
}

/// The heaviest set of one session (ties go to more reps).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftSession {
    pub date: String,
    pub kg: f64,
    pub reps: Option<i64>,
}

/// Builds the Fitness view; `today` is the owner's local date (YYYY-MM-DD).
pub fn fitness(index: &Index, today: &str) -> rusqlite::Result<Fitness> {
    let workouts = workouts(index)?;
    Ok(Fitness {
        days: days(index, today)?,
        plan: plan(index)?,
        lifts: lifts(&workouts),
        workouts,
        parse_errors: index.conn().query_row(
            "SELECT COUNT(*) FROM notes WHERE kind = 'error'
             AND (path LIKE ?1 OR path LIKE ?2)",
            params!["Daily/%", "Fitness/%"],
            |r| r.get(0),
        )?,
    })
}

fn days(index: &Index, today: &str) -> rusqlite::Result<Vec<Day>> {
    let start = shift_days(today, 1 - WINDOW_DAYS);
    let rows = index
        .conn()
        .prepare(
            "SELECT date, weight, steps, protein_g FROM daily
             WHERE date >= ?1 AND date <= ?2 ORDER BY date, path",
        )?
        .query_map(params![start, today], |r| {
            Ok(Day {
                date: r.get(0)?,
                weight: r.get(1)?,
                steps: r.get(2)?,
                protein_g: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // Two notes for one date: the first by path wins.
    let mut seen = HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|d| seen.insert(d.date.clone()))
        .collect())
}

fn plan(index: &Index) -> rusqlite::Result<Option<PlanView>> {
    index
        .conn()
        .query_row(
            "SELECT name, start, end, start_weight, target_weight, steps_goal, protein_goal
             FROM plan ORDER BY path = ?1 DESC, path LIMIT 1",
            params![PLAN_PATH],
            |r| {
                Ok(PlanView {
                    name: r.get(0)?,
                    start: r.get(1)?,
                    end: r.get(2)?,
                    start_weight: r.get(3)?,
                    target_weight: r.get(4)?,
                    steps_goal: r.get::<_, Option<i64>>(5)?.unwrap_or(DEFAULT_STEPS_GOAL),
                    protein_goal: r.get::<_, Option<i64>>(6)?.unwrap_or(DEFAULT_PROTEIN_GOAL),
                })
            },
        )
        .optional()
}

fn workouts(index: &Index) -> rusqlite::Result<Vec<WorkoutView>> {
    index
        .conn()
        .prepare(
            "SELECT path, date, day, week, deload, duration_min, exercises FROM workout
             ORDER BY date IS NULL, date DESC, path DESC LIMIT ?1",
        )?
        .query_map(params![MAX_WORKOUTS], |r| {
            let lines: String = r.get::<_, Option<String>>(6)?.unwrap_or_default();
            let lines: Vec<String> = serde_json::from_str(&lines).unwrap_or_default();
            Ok(WorkoutView {
                path: r.get(0)?,
                date: r.get(1)?,
                day: r.get(2)?,
                week: r.get(3)?,
                deload: r.get::<_, Option<bool>>(4)?.unwrap_or(false),
                duration_min: r.get(5)?,
                exercises: lines.iter().map(|l| parse_exercise(l)).collect(),
            })
        })?
        .collect()
}

/// Case- and spacing-insensitive identity of an exercise name.
fn lift_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Top set per session for every exercise, from `workouts` (newest first).
/// Deload and undated sessions are left out.
fn lifts(workouts: &[WorkoutView]) -> Vec<Lift> {
    // Oldest session first, so the last name seen is the newest spelling.
    let mut sessions: Vec<&WorkoutView> = workouts
        .iter()
        .filter(|w| !w.deload && w.date.is_some())
        .collect();
    sessions.sort_by(|a, b| (&a.date, &a.path).cmp(&(&b.date, &b.path)));

    let mut by_key: BTreeMap<String, Lift> = BTreeMap::new();
    for w in sessions {
        let Some(date) = &w.date else { continue };
        let mut tops: BTreeMap<String, (&ExerciseSet, f64)> = BTreeMap::new();
        for e in &w.exercises {
            let Some(kg) = e.kg else { continue };
            let better = tops.get(&lift_key(&e.name)).is_none_or(|(best, best_kg)| {
                kg > *best_kg || (kg == *best_kg && e.reps.unwrap_or(0) > best.reps.unwrap_or(0))
            });
            if better {
                tops.insert(lift_key(&e.name), (e, kg));
            }
        }
        for (key, (e, kg)) in tops {
            let lift = by_key.entry(key).or_insert_with(|| Lift {
                name: String::new(),
                sessions: Vec::new(),
            });
            lift.name.clone_from(&e.name);
            lift.sessions.push(LiftSession {
                date: date.clone(),
                kg,
                reps: e.reps,
            });
        }
    }
    let mut out: Vec<(String, Lift)> = by_key.into_iter().collect();
    out.sort_by(|(ka, a), (kb, b)| b.sessions.len().cmp(&a.sessions.len()).then(ka.cmp(kb)));
    out.into_iter().map(|(_, l)| l).collect()
}

/// Days since 1970-01-01 for a civil date (proleptic Gregorian).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `date` (YYYY-MM-DD) moved by `delta` days. An unreadable date comes back as is.
fn shift_days(date: &str, delta: i64) -> String {
    let part = |range: std::ops::Range<usize>| date.get(range).and_then(|p| p.parse::<i64>().ok());
    let (Some(y), Some(m), Some(d)) = (part(0..4), part(5..7), part(8..10)) else {
        return date.to_owned();
    };
    let (y, m, d) = civil_from_days(days_from_civil(y, m, d) + delta);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn fixture_index() -> Index {
        let mut index = Index::open_in_memory().expect("open");
        index
            .sync(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault"))
            .expect("sync");
        index
    }

    fn vault_with(files: &[(&str, &str)]) -> Index {
        let dir = tempfile::tempdir().expect("temp dir");
        for (path, text) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().expect("parent")).expect("mkdir");
            fs::write(full, text).expect("write");
        }
        let mut index = Index::open_in_memory().expect("open");
        index.sync(dir.path()).expect("sync");
        index
    }

    #[test]
    fn date_arithmetic_crosses_months_years_and_leap_days() {
        assert_eq!(shift_days("2026-01-20", -89), "2025-10-23");
        assert_eq!(shift_days("2026-03-01", -1), "2026-02-28");
        assert_eq!(shift_days("2024-03-01", -1), "2024-02-29");
        assert_eq!(shift_days("2025-12-31", 1), "2026-01-01");
        assert_eq!(shift_days("nonsense", 5), "nonsense");
    }

    #[test]
    fn days_are_the_window_ending_today_oldest_first() {
        let f = fitness(&fixture_index(), "2026-01-13").expect("fitness");
        let dates: Vec<&str> = f.days.iter().map(|d| d.date.as_str()).collect();
        // Nothing after today and nothing from September.
        assert_eq!(
            dates,
            ["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13"]
        );
        assert_eq!(f.days[3].weight, Some(83.9));
        assert_eq!(f.days[3].steps, Some(10450));
        assert_eq!(f.days[3].protein_g, Some(165));
    }

    #[test]
    fn window_is_ninety_days_inclusive() {
        let index = vault_with(&[
            (
                "Daily/a.md",
                "---\ntype: daily\ndate: 2026-01-01\nsteps: 1\n---\n",
            ),
            (
                "Daily/b.md",
                "---\ntype: daily\ndate: 2026-03-31\nsteps: 2\n---\n",
            ),
            (
                "Daily/c.md",
                "---\ntype: daily\ndate: 2025-12-31\nsteps: 3\n---\n",
            ),
        ]);
        // 2026-03-31 minus 89 days is 2026-01-01.
        let f = fitness(&index, "2026-03-31").expect("fitness");
        let dates: Vec<&str> = f.days.iter().map(|d| d.date.as_str()).collect();
        assert_eq!(dates, ["2026-01-01", "2026-03-31"]);
    }

    #[test]
    fn duplicate_dates_keep_the_first_note_by_path() {
        let f = fitness(&fixture_index(), "2026-01-14").expect("fitness");
        let day = f.days.iter().find(|d| d.date == "2026-01-14").expect("day");
        assert_eq!(day.weight, Some(83.8));
        assert_eq!(f.days.iter().filter(|d| d.date == "2026-01-14").count(), 1);
    }

    #[test]
    fn plan_comes_from_fitness_plan_with_defaults_for_missing_goals() {
        let f = fitness(&fixture_index(), "2026-01-13").expect("fitness");
        let plan = f.plan.expect("plan");
        assert_eq!(plan.name.as_deref(), Some("Synthetic Arc"));
        assert_eq!(plan.start.as_deref(), Some("2026-01-05"));
        assert_eq!(plan.end.as_deref(), Some("2026-03-30"));
        assert_eq!(plan.start_weight, Some(85.0));
        assert_eq!(plan.target_weight, Some(80.0));
        assert_eq!((plan.steps_goal, plan.protein_goal), (8500, 160));

        let index = vault_with(&[(
            "Fitness/Plan.md",
            "---\ntype: plan\nstart: 2026-01-05\n---\n",
        )]);
        let plan = fitness(&index, "2026-01-13")
            .expect("fitness")
            .plan
            .expect("plan");
        assert_eq!(plan.target_weight, None);
        assert_eq!((plan.steps_goal, plan.protein_goal), (8000, 170));
    }

    #[test]
    fn plan_prefers_the_standard_path_else_first_by_path() {
        let note = |name: &str| format!("---\ntype: plan\nname: {name}\n---\n");
        let index = vault_with(&[
            ("A/plan.md", &note("other")),
            ("Fitness/Plan.md", &note("standard")),
        ]);
        let name = fitness(&index, "2026-01-13")
            .expect("fitness")
            .plan
            .expect("plan")
            .name;
        assert_eq!(name.as_deref(), Some("standard"));

        let index = vault_with(&[
            ("B/plan.md", &note("second")),
            ("A/plan.md", &note("first")),
        ]);
        let name = fitness(&index, "2026-01-13")
            .expect("fitness")
            .plan
            .expect("plan")
            .name;
        assert_eq!(name.as_deref(), Some("first"));

        let index = vault_with(&[("Inbox.md", "# nothing\n")]);
        assert_eq!(fitness(&index, "2026-01-13").expect("fitness").plan, None);
    }

    #[test]
    fn workouts_are_newest_first_with_parsed_exercises() {
        let f = fitness(&fixture_index(), "2026-01-13").expect("fitness");
        let dates: Vec<_> = f.workouts.iter().map(|w| w.date.as_deref()).collect();
        assert_eq!(
            dates,
            [
                Some("2026-01-20"),
                Some("2026-01-13"),
                Some("2026-01-12"),
                Some("2026-01-06")
            ]
        );
        assert!(f.workouts[0].deload);
        let push = &f.workouts[2];
        assert_eq!(push.day.as_deref(), Some("Push A"));
        assert_eq!(push.exercises[0].kg, Some(62.5));
        assert_eq!(push.exercises[1].sets, Some(3));
        // The malformed line stays in the history, without numbers.
        assert_eq!(push.exercises[2].name, "Plank until failure");
        assert_eq!(push.exercises[2].kg, None);
    }

    #[test]
    fn undated_workouts_sort_last_and_only_500_are_kept() {
        let mut files = vec![(
            "Fitness/Log/undated.md".to_owned(),
            "---\ntype: workout\nday: Legs\nexercises:\n  - Squat 3 x 5 @ 100\n---\n".to_owned(),
        )];
        for i in 0..505 {
            let (m, d) = (i / 28 % 12 + 1, i % 28 + 1);
            files.push((
                format!("Fitness/Log/{i:04}.md"),
                format!("---\ntype: workout\ndate: 2026-{m:02}-{d:02}\n---\n"),
            ));
        }
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let f = fitness(&vault_with(&refs), "2026-01-13").expect("fitness");
        assert_eq!(f.workouts.len(), 500);
        // Dated workouts fill the list, so the undated one is cut first.
        assert!(f.workouts.iter().all(|w| w.date.is_some()));

        let few = vault_with(&[
            ("a.md", "---\ntype: workout\n---\n"),
            ("b.md", "---\ntype: workout\ndate: 2026-01-01\n---\n"),
        ]);
        let f = fitness(&few, "2026-01-13").expect("fitness");
        assert_eq!(f.workouts[0].date.as_deref(), Some("2026-01-01"));
        assert_eq!(f.workouts[1].date, None);
        assert!(!f.workouts[1].deload);
    }

    #[test]
    fn lifts_group_names_take_top_sets_and_skip_deloads() {
        let f = fitness(&fixture_index(), "2026-01-13").expect("fitness");
        let names: Vec<&str> = f.lifts.iter().map(|l| l.name.as_str()).collect();
        // Most sessions first, then by name.
        assert_eq!(
            names,
            ["Deadlift", "Lat pulldown", "Bench press", "Overhead press"]
        );
        let deadlift = &f.lifts[0];
        assert_eq!(deadlift.sessions.len(), 2);
        // 110 x 5 and 110 x 8 tie on weight; more reps wins. Names differ
        // only by case and spacing. The deload (80 kg) is left out.
        assert_eq!(
            deadlift.sessions[0],
            LiftSession {
                date: "2026-01-06".to_owned(),
                kg: 110.0,
                reps: Some(8)
            }
        );
        assert_eq!(deadlift.sessions[1].kg, 120.0);
        let pulldown = &f.lifts[1];
        assert_eq!(
            pulldown.sessions.iter().map(|s| s.kg).collect::<Vec<_>>(),
            [50.0, 55.0]
        );
    }

    #[test]
    fn newest_spelling_names_the_lift() {
        let index = vault_with(&[
            (
                "a.md",
                "---\ntype: workout\ndate: 2026-01-01\nexercises:\n  - bench  PRESS 3 x 5 @ 50\n---\n",
            ),
            (
                "b.md",
                "---\ntype: workout\ndate: 2026-01-02\nexercises:\n  - Bench Press 3 x 5 @ 52.5\n---\n",
            ),
        ]);
        let f = fitness(&index, "2026-01-13").expect("fitness");
        assert_eq!(f.lifts.len(), 1);
        assert_eq!(f.lifts[0].name, "Bench Press");
        assert_eq!(f.lifts[0].sessions.len(), 2);
    }

    #[test]
    fn parse_errors_count_only_daily_and_fitness_notes() {
        let index = vault_with(&[
            ("Daily/bad.md", "---\ntype: daily\nsteps: lots\n---\n"),
            ("Fitness/Log/bad.md", "---\ntype: workout\nday: Rest\n---\n"),
            ("Jobs/bad.md", "---\ntype: company\nstage: ghosted\n---\n"),
            ("Daily/ok.md", "---\ntype: daily\nsteps: 5\n---\n"),
        ]);
        assert_eq!(
            fitness(&index, "2026-01-13").expect("fitness").parse_errors,
            2
        );
        // The fixture's one unreadable note is a company note.
        assert_eq!(
            fitness(&fixture_index(), "2026-01-13")
                .expect("fitness")
                .parse_errors,
            0
        );
    }

    #[test]
    fn empty_vault_gives_an_empty_view() {
        let f = fitness(&vault_with(&[("Inbox.md", "hi\n")]), "2026-01-13").expect("fitness");
        assert_eq!(f, Fitness::default());
    }
}
