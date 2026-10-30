use super::*;
use proptest::prelude::*;
use serde_json::json;
use std::time::{Duration, SystemTime};

const HOUR_MS: i64 = 3_600_000;

fn set_mtime(path: &Path, ms: i64) {
    let t = SystemTime::UNIX_EPOCH + Duration::from_millis(u64::try_from(ms).expect("positive"));
    fs::File::options()
        .write(true)
        .open(path)
        .expect("open")
        .set_modified(t)
        .expect("set mtime");
}

/// Writes `files` (relative path, mtime ms, text) into a temp folder.
fn folder_with(files: &[(&str, i64, String)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    for (rel, ms, text) in files {
        let full = dir.path().join(rel);
        fs::create_dir_all(full.parent().expect("parent")).expect("mkdir");
        fs::write(&full, text).expect("write");
        set_mtime(&full, *ms);
    }
    dir
}

fn import_dir(dir: &Path) -> Imported {
    let canonical = fs::canonicalize(dir).expect("canonical");
    let listing = list(&canonical).expect("list");
    import(&canonical, &listing)
}

fn import_files(files: &[(&str, i64, String)]) -> Imported {
    let dir = folder_with(files);
    import_dir(dir.path())
}

fn export(metrics: &Value) -> String {
    json!({"data": {"metrics": metrics, "workouts": []}}).to_string()
}

fn one_metric(name: &str, units: &str, points: &Value) -> String {
    export(&json!([{"name": name, "units": units, "data": points}]))
}

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/health")
}

/// Copies the fixture and fixes the mtimes so "newest" is deterministic.
fn fixture_copy() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("temp dir");
    for entry in fs::read_dir(fixture_dir()).expect("fixture") {
        let entry = entry.expect("entry");
        fs::copy(entry.path(), dir.path().join(entry.file_name())).expect("copy");
    }
    let at = |name: &str, ms: i64| set_mtime(&dir.path().join(name), ms);
    at(
        "HealthAutoExport-2026-10-19_2026-10-25.json",
        1_000 * HOUR_MS,
    );
    at(
        "HealthAutoExport-2026-10-23_2026-10-29.json",
        1_010 * HOUR_MS,
    );
    at("wrong-shape.json", 1_005 * HOUR_MS);
    at("not-json.json", 1_005 * HOUR_MS);
    dir
}

const TODAY: &str = "2026-10-29";

// --- units and ranges -------------------------------------------------------

#[test]
fn units_are_converted() {
    let day = |d: &str| format!("{d} 00:00:00 +0100");
    let metrics = json!([
        {"name": "active_energy", "units": "kJ", "data": [{"date": day("2026-10-01"), "qty": 4184.0}]},
        {"name": "weight_body_mass", "units": "lb", "data": [{"date": day("2026-10-01"), "qty": 200.0}]},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, export(&metrics))]);
    let d = &got.days["2026-10-01"];
    assert!((d.energy.expect("energy") - 1000.0).abs() < 1e-6);
    assert!((d.weight().expect("weight") - 90.718_474).abs() < 1e-3);

    let w = json!({"data": {"workouts": [{
        "id": "x", "name": "Ride", "start": "2026-10-02 08:00:00 +0100", "duration": 3600,
        "activeEnergy": {"qty": 418.4, "units": "kJ"},
        "distance": {"qty": 10.0, "units": "mi"}
    }]}});
    let got = import_files(&[("w.json", HOUR_MS, w.to_string())]);
    let wk = &got.workouts[0];
    assert_eq!(wk.active_energy, Some(100));
    assert_eq!(wk.distance_km, Some(16.09));
    assert_eq!(wk.duration_min, Some(60));
}

#[test]
fn unknown_units_drop_the_value() {
    let p = json!([{"date": "2026-10-01 00:00:00 +0100", "qty": 100.0}]);
    for (name, units) in [
        ("active_energy", "furlongs"),
        ("active_energy", ""),
        ("weight_body_mass", "stone"),
    ] {
        let got = import_files(&[("a.json", HOUR_MS, one_metric(name, units, &p))]);
        assert!(got.days.is_empty(), "{name} in {units} should be dropped");
    }
    let w = json!({"data": {"workouts": [{
        "id": "x", "start": "2026-10-02 08:00:00 +0100", "duration": 60,
        "activeEnergyBurned": {"qty": 5, "units": "btu"},
        "distance": {"qty": 5, "units": "furlongs"}
    }]}});
    let got = import_files(&[("w.json", HOUR_MS, w.to_string())]);
    assert_eq!(got.workouts[0].active_energy, None);
    assert_eq!(got.workouts[0].distance_km, None);
    assert_eq!(got.workouts[0].name, "Workout");
}

#[test]
fn out_of_range_values_are_dropped() {
    let day = "2026-10-01 00:00:00 +0100";
    let cases = [
        ("step_count", "count", 200_001.0),
        ("step_count", "count", -1.0),
        ("active_energy", "kcal", 20_001.0),
        ("resting_heart_rate", "count/min", 19.0),
        ("resting_heart_rate", "count/min", 251.0),
        ("heart_rate_variability", "ms", 0.5),
        ("heart_rate_variability", "ms", 501.0),
        ("weight_body_mass", "kg", 19.9),
        ("weight_body_mass", "kg", 400.1),
    ];
    for (name, units, qty) in cases {
        let p = json!([{"date": day, "qty": qty}]);
        let got = import_files(&[("a.json", HOUR_MS, one_metric(name, units, &p))]);
        assert!(got.days.is_empty(), "{name} {qty} should be dropped");
    }
    let edges = [
        ("step_count", "count", 200_000.0),
        ("resting_heart_rate", "count/min", 20.0),
        ("heart_rate_variability", "ms", 500.0),
        ("weight_body_mass", "kg", 400.0),
    ];
    for (name, units, qty) in edges {
        let p = json!([{"date": day, "qty": qty}]);
        let got = import_files(&[("a.json", HOUR_MS, one_metric(name, units, &p))]);
        assert_eq!(got.days.len(), 1, "{name} {qty} is in range");
    }
    // Sleep stages over 24 h are ignored; a workout over 24 h has no duration.
    let p = json!([{"date": day, "totalSleep": 25.0, "core": 30.0}]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("sleep_analysis", "hr", &p))]);
    assert!(got.days.is_empty());
    let w = json!({"data": {"workouts": [{"id": "l", "start": day, "duration": 86_401}]}});
    let got = import_files(&[("w.json", HOUR_MS, w.to_string())]);
    assert_eq!(got.workouts[0].duration_min, None);
}

#[test]
fn points_without_a_valid_date_are_dropped() {
    let p = json!([
        {"date": "yesterday", "qty": 5},
        {"date": "2026-13-45 00:00:00", "qty": 5},
        {"qty": 5},
        {"date": 20261001, "qty": 5},
        {"date": "é2026-10-0", "qty": 5},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("step_count", "count", &p))]);
    assert!(got.days.is_empty());
}

// --- sleep ------------------------------------------------------------------

#[test]
fn sleep_accepts_both_spellings_and_the_stage_fallback() {
    let d = |n: u32| format!("2026-10-0{n} 00:00:00 +0100");
    let p = json!([
        {"date": d(1), "totalSleep": 7.1, "asleep": 0, "core": 4.2, "deep": 1.1, "rem": 1.8, "awake": 0.4},
        {"date": d(2), "asleep": 6.5, "core": 3.0, "deep": 1.0, "rem": 1.5, "awake": 0.2},
        {"date": d(3), "totalSleep": 0, "asleep": 0, "core": 4.0, "deep": 1.0, "rem": 1.5},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("sleep_analysis", "hr", &p))]);
    let s = |day: &str| got.days[day].sleep.clone().expect("sleep");
    assert!((s("2026-10-01").total - 7.1).abs() < 1e-9);
    assert!((s("2026-10-02").total - 6.5).abs() < 1e-9);
    assert!((s("2026-10-03").total - 6.5).abs() < 1e-9);
    assert!((s("2026-10-01").deep - 1.1).abs() < 1e-9);
}

#[test]
fn sleep_stages_add_up_across_points_of_one_day() {
    let p = json!([
        {"date": "2026-10-01 01:00:00 +0100", "totalSleep": 3.0, "core": 2.0, "deep": 1.0},
        {"date": "2026-10-01 13:00:00 +0100", "totalSleep": 1.0, "core": 1.0},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("sleep_analysis", "hr", &p))]);
    let s = got.days["2026-10-01"].sleep.clone().expect("sleep");
    assert!((s.total - 4.0).abs() < 1e-9);
    assert!((s.core - 3.0).abs() < 1e-9);
}

// --- aggregation ------------------------------------------------------------

#[test]
fn a_day_sums_steps_and_energy_averages_hr_and_keeps_the_last_weight() {
    let d = |t: &str| format!("2026-10-01 {t} +0100");
    let metrics = json!([
        {"name": "step_count", "units": "count", "data": [
            {"date": d("08:00:00"), "qty": 1000}, {"date": d("12:00:00"), "qty": 2500.4}]},
        {"name": "active_energy", "units": "kcal", "data": [
            {"date": d("08:00:00"), "qty": 100}, {"date": d("12:00:00"), "qty": 150.5}]},
        {"name": "resting_heart_rate", "units": "count/min", "data": [
            {"date": d("08:00:00"), "qty": 50}, {"date": d("12:00:00"), "qty": 55}]},
        {"name": "heart_rate_variability", "units": "ms", "data": [
            {"date": d("08:00:00"), "qty": 40}, {"date": d("12:00:00"), "qty": 50}]},
        {"name": "weight_body_mass", "units": "kg", "data": [
            {"date": d("20:00:00"), "qty": 81.5}, {"date": d("07:00:00"), "qty": 82.5}]},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, export(&metrics))]);
    let view = health(&got, None, "2026-10-01", HOUR_MS).expect("health");
    let day = view.days.last().expect("today");
    assert_eq!(day.steps, Some(3500));
    assert_eq!(day.active_energy, Some(251));
    assert_eq!(day.resting_hr, Some(52.5));
    assert_eq!(day.hrv, Some(45.0));
    assert_eq!(day.weight, Some(81.5));
    assert_eq!(day.weight_source, Some("health"));
}

#[test]
fn the_newest_file_wins_on_overlapping_days_and_nothing_is_counted_twice() {
    let dir = fixture_copy();
    let got = import_dir(dir.path());
    assert_eq!(got.file_count, 4);
    // Days 23..25 are in both files; the newer file (base 2000) wins.
    assert_eq!(got.days["2026-10-24"].steps, Some(2024.0));
    assert_eq!(got.days["2026-10-20"].steps, Some(1020.0));
    assert_eq!(got.days["2026-10-28"].steps, Some(2028.0));
    // Seven plus seven days, three shared.
    assert_eq!(got.days.len(), 11);
    // The shared run appears once.
    assert_eq!(
        got.workouts
            .iter()
            .filter(|w| w.name == "Outdoor Run")
            .count(),
        1
    );
    assert_eq!(got.workouts.len(), 2);
    // kJ and lb in the newer file were converted.
    let d = &got.days["2026-10-24"];
    assert!((d.energy.expect("energy") - 424.0).abs() < 0.01);
    assert!((d.weight().expect("weight") - 82.4).abs() < 0.01);
}

#[test]
fn an_unusable_newer_value_does_not_hide_a_valid_older_one() {
    let steps = |qty: f64| {
        json!({"data": {"metrics": [{"name": "step_count", "units": "count",
            "data": [{"date": "2026-10-24 00:00:00 +0000", "qty": qty}]}]}})
        .to_string()
    };
    let got = import_files(&[
        ("old.json", 1_000 * HOUR_MS, steps(4321.0)),
        ("new.json", 2_000 * HOUR_MS, steps(999_999.0)),
    ]);
    assert_eq!(got.days["2026-10-24"].steps, Some(4321.0));
}

#[test]
fn bad_files_are_recorded_by_name_and_do_not_stop_the_rest() {
    let dir = fixture_copy();
    let got = import_dir(dir.path());
    let mut bad: Vec<(&str, &str)> = got
        .bad_files
        .iter()
        .map(|b| (b.name.as_str(), b.reason.as_str()))
        .collect();
    bad.sort_unstable();
    assert_eq!(
        bad,
        [
            ("not-json.json", "not valid JSON"),
            ("wrong-shape.json", "unexpected layout")
        ]
    );
    assert!(!got.days.is_empty());
}

#[test]
fn same_timestamp_in_an_older_file_is_ignored() {
    let p = |qty: i64| json!([{"date": "2026-10-01 00:00:00 +0100", "qty": qty}]);
    let got = import_files(&[
        (
            "old.json",
            HOUR_MS,
            one_metric("step_count", "count", &p(1000)),
        ),
        (
            "new.json",
            2 * HOUR_MS,
            one_metric("step_count", "count", &p(2000)),
        ),
    ]);
    assert_eq!(got.days["2026-10-01"].steps, Some(2000.0));
    // Equal mtimes: the name decides, the later name wins.
    let got = import_files(&[
        (
            "a.json",
            HOUR_MS,
            one_metric("step_count", "count", &p(1000)),
        ),
        (
            "b.json",
            HOUR_MS,
            one_metric("step_count", "count", &p(2000)),
        ),
    ]);
    assert_eq!(got.days["2026-10-01"].steps, Some(2000.0));
}

// --- the view ---------------------------------------------------------------

#[test]
fn view_covers_ninety_days_ending_today_with_nulls() {
    let dir = fixture_copy();
    let got = import_dir(dir.path());
    let v = health(&got, None, TODAY, 1_010 * HOUR_MS).expect("health");
    assert_eq!(v.days.len(), 90);
    assert_eq!(v.days[89].date, TODAY);
    assert_eq!(v.days[0].date, "2026-08-01");
    assert_eq!(v.days[0].steps, None);
    assert_eq!(v.days[0].sleep, None);
    assert_eq!(v.days[89].steps, Some(2029));
    assert_eq!(v.latest_data.as_deref(), Some("2026-10-29"));
    assert_eq!(v.file_count, 4);
    assert_eq!(v.bad_file_count, 2);
    assert_eq!(v.goals, Goals::default());
}

#[test]
fn stale_after_48_hours() {
    let got = import_files(&[(
        "a.json",
        1_000 * HOUR_MS,
        one_metric(
            "step_count",
            "count",
            &json!([{"date": "2026-10-29", "qty": 5}]),
        ),
    )]);
    let v47 = health(&got, None, TODAY, 1_047 * HOUR_MS).expect("health");
    assert!(!v47.stale);
    let v49 = health(&got, None, TODAY, 1_049 * HOUR_MS).expect("health");
    assert!(v49.stale);
    assert_eq!(v49.last_export, Some(1_000 * HOUR_MS));

    let empty = health(&Imported::default(), None, TODAY, 5).expect("health");
    assert!(empty.stale);
    assert_eq!(empty.last_export, None);
    assert_eq!(empty.rings_day, None);
    assert_eq!(empty.days.len(), 90);
}

#[test]
fn rings_use_today_else_the_latest_day_with_data() {
    let p = |d: &str| json!([{"date": format!("{d} 00:00:00 +0100"), "qty": 4000}]);
    let got = import_files(&[(
        "a.json",
        HOUR_MS,
        one_metric("step_count", "count", &p("2026-10-27")),
    )]);
    let v = health(&got, None, TODAY, HOUR_MS).expect("health");
    let r = v.rings_day.expect("rings");
    assert!(!r.is_today);
    assert_eq!(r.day.date, "2026-10-27");
    assert_eq!(r.day.steps, Some(4000));

    let got = import_files(&[(
        "a.json",
        HOUR_MS,
        one_metric("step_count", "count", &p(TODAY)),
    )]);
    let r = health(&got, None, TODAY, HOUR_MS)
        .expect("health")
        .rings_day
        .expect("rings");
    assert!(r.is_today);

    // A day with only heart rate does not count; neither do future days.
    let metrics = json!([
        {"name": "resting_heart_rate", "units": "count/min", "data": [{"date": "2026-10-29", "qty": 55}]},
        {"name": "step_count", "units": "count", "data": [
            {"date": "2026-10-30", "qty": 9}, {"date": "2026-10-26", "qty": 7}]},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, export(&metrics))]);
    let r = health(&got, None, TODAY, HOUR_MS)
        .expect("health")
        .rings_day
        .expect("rings");
    assert_eq!(r.day.date, "2026-10-26");
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
fn weight_falls_back_to_the_vault_day() {
    let index = vault_with(&[
        (
            "Daily/a.md",
            "---\ntype: daily\ndate: 2026-10-28\nweight: 83.2\n---\n",
        ),
        (
            "Daily/b.md",
            "---\ntype: daily\ndate: 2026-10-29\nweight: 99.9\n---\n",
        ),
    ]);
    let p = json!([{"date": "2026-10-29 07:00:00 +0100", "qty": 81.0}]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("weight_body_mass", "kg", &p))]);
    let v = health(&got, Some(&index), TODAY, HOUR_MS).expect("health");
    let n = v.days.len();
    assert_eq!(v.days[n - 1].weight, Some(81.0));
    assert_eq!(v.days[n - 1].weight_source, Some("health"));
    assert_eq!(v.days[n - 2].weight, Some(83.2));
    assert_eq!(v.days[n - 2].weight_source, Some("vault"));
    assert_eq!(v.days[n - 3].weight, None);
    assert_eq!(v.days[n - 3].weight_source, None);
}

#[test]
fn goals_come_from_the_plan_with_defaults() {
    let plan = "---\ntype: plan\nsteps_goal: 9000\nactive_energy_goal: 650\nsleep_goal: 7.5\n---\n";
    let index = vault_with(&[("Fitness/Plan.md", plan)]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(
        v.goals,
        Goals {
            steps: 9000,
            active_energy: 650,
            sleep_hours: 7.5
        }
    );
    let index = vault_with(&[(
        "Fitness/Plan.md",
        "---\ntype: plan\nsteps_goal: 9000\n---\n",
    )]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(v.goals.steps, 9000);
    assert_eq!(v.goals.active_energy, 500);
    assert!((v.goals.sleep_hours - 8.0).abs() < f64::EPSILON);
    let index = vault_with(&[("Inbox.md", "# x\n")]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(v.goals, Goals::default());
}

#[test]
fn workouts_merge_newest_first_with_sources() {
    let index = vault_with(&[
        (
            "Fitness/Log/a.md",
            "---\ntype: workout\ndate: 2026-10-28\nday: Pull A\nduration_min: 62\n---\n",
        ),
        (
            "Fitness/Log/b.md",
            "---\ntype: workout\ndate: 2026-10-20\n---\n",
        ),
        (
            "Fitness/Log/c.md",
            "---\ntype: workout\nday: Undated\n---\n",
        ),
    ]);
    let w = json!({"data": {"workouts": [
        {"id": "r1", "name": "Outdoor Run", "start": "2026-10-29 07:00:00 +0100", "duration": 1800,
         "activeEnergyBurned": {"qty": 310, "units": "kcal"}, "distance": {"qty": 5.1, "units": "km"}},
        {"id": "r2", "name": "Walk", "start": "2026-10-28 09:00:00 +0100", "duration": 600},
    ]}});
    let got = import_files(&[("w.json", HOUR_MS, w.to_string())]);
    let v = health(&got, Some(&index), TODAY, HOUR_MS).expect("health");
    let seq: Vec<(&str, &str, &str)> = v
        .workouts
        .iter()
        .map(|w| (w.source, w.date.as_str(), w.name.as_str()))
        .collect();
    assert_eq!(
        seq,
        [
            ("health", "2026-10-29", "Outdoor Run"),
            ("health", "2026-10-28", "Walk"),
            ("vault", "2026-10-28", "Pull A"),
            ("vault", "2026-10-20", "Workout"),
        ]
    );
    assert_eq!(v.workouts[0].active_energy, Some(310));
    assert_eq!(v.workouts[0].distance_km, Some(5.1));
    assert!(v.workouts[2].path.is_some());
    assert!(v.workouts[0].path.is_none());
}

#[test]
fn merged_workouts_are_capped() {
    let mut imported = Imported::default();
    for i in 0..400 {
        imported.workouts.push(HealthWorkout {
            date: format!("2026-01-{:02}", 1 + i % 28),
            start: format!("2026-01-{:02} 08:{:02}:00", 1 + i % 28, i % 60),
            name: format!("W{i}"),
            duration_min: None,
            active_energy: None,
            distance_km: None,
        });
    }
    let v = health(&imported, None, TODAY, 0).expect("health");
    assert_eq!(v.workouts.len(), MAX_WORKOUTS);
    assert!(v.workouts.windows(2).all(|w| w[0].date >= w[1].date));
}

#[test]
fn bad_file_list_is_capped_but_counted() {
    let mut imported = Imported::default();
    for i in 0..80 {
        imported.bad_files.push(BadFile {
            name: format!("f{i}.json"),
            reason: "not valid JSON".to_owned(),
        });
    }
    let v = health(&imported, None, TODAY, 0).expect("health");
    assert_eq!(v.bad_files.len(), 50);
    assert_eq!(v.bad_file_count, 80);
}

// --- listing ----------------------------------------------------------------

#[test]
fn listing_finds_json_up_to_three_folders_deep() {
    let dir = folder_with(&[
        ("a.json", HOUR_MS, "{}".into()),
        ("B.JSON", HOUR_MS, "{}".into()),
        ("x/b.json", HOUR_MS, "{}".into()),
        ("x/y/z/deep3.json", HOUR_MS, "{}".into()),
        ("x/y/z/w/deep4.json", HOUR_MS, "{}".into()),
        (".hidden.json", HOUR_MS, "{}".into()),
        (".cache/c.json", HOUR_MS, "{}".into()),
        ("notes.txt", HOUR_MS, "x".into()),
        ("data.json.bak", HOUR_MS, "x".into()),
    ]);
    let listing = list(dir.path()).expect("list");
    let mut names: Vec<&str> = listing.files.iter().map(|f| f.rel.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["B.JSON", "a.json", "x/b.json", "x/y/z/deep3.json"]);
    assert_eq!(listing.skipped, 0);
}

#[test]
fn listing_keeps_the_newest_two_thousand() {
    let dir = tempfile::tempdir().expect("temp dir");
    for i in 0..(MAX_FILES + 5) {
        let p = dir.path().join(format!("f{i:05}.json"));
        fs::write(&p, "{}").expect("write");
        set_mtime(&p, 1_000 * HOUR_MS + i64::try_from(i).expect("fits") * 1000);
    }
    let listing = list(dir.path()).expect("list");
    assert_eq!(listing.files.len(), MAX_FILES);
    assert_eq!(listing.skipped, 5);
    assert_eq!(listing.files[0].rel, format!("f{:05}.json", MAX_FILES + 4));
    assert!(
        listing
            .files
            .iter()
            .all(|f| f.rel.as_str() >= "f00005.json")
    );
}

#[test]
fn listing_a_missing_folder_is_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    assert!(list(&dir.path().join("nope")).is_err());
}

#[cfg(windows)]
fn junction(link: &Path, real: &Path) {
    let out = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(real)
        .output()
        .expect("run mklink");
    assert!(out.status.success(), "mklink failed");
}

#[cfg(windows)]
#[test]
fn junctions_are_neither_listed_nor_read() {
    let outside = folder_with(&[("secret.json", HOUR_MS, "{\"data\":{}}".into())]);
    let dir = folder_with(&[("ok.json", HOUR_MS, "{\"data\":{}}".into())]);
    junction(&dir.path().join("link"), outside.path());
    let canonical = fs::canonicalize(dir.path()).expect("canonical");
    let listing = list(&canonical).expect("list");
    assert_eq!(listing.files.len(), 1);
    // Even if a listing named it, the read re-check refuses.
    let sneaky = FileEntry {
        rel: "link/secret.json".to_owned(),
        len: 10,
        mtime_ms: 0,
    };
    assert_eq!(
        read_file(&canonical, &sneaky),
        Err("goes through a link".to_owned())
    );
}

// --- T16: limits and hostile input -----------------------------------------

#[test]
fn a_file_over_32_mb_is_rejected_without_being_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("huge.json");
    let f = fs::File::create(&path).expect("create");
    f.set_len(MAX_FILE_BYTES + 1).expect("sparse");
    drop(f);
    let got = import_dir(dir.path());
    assert_eq!(got.file_count, 1);
    assert_eq!(
        got.bad_files,
        [BadFile {
            name: "huge.json".to_owned(),
            reason: "larger than 32 MB, not read".to_owned()
        }]
    );
    // Exactly at the cap is read (and fails as JSON, not as too large).
    let f = fs::File::options().write(true).open(&path).expect("open");
    f.set_len(MAX_FILE_BYTES).expect("sparse");
    drop(f);
    let got = import_dir(dir.path());
    assert_eq!(got.bad_files[0].reason, "not valid JSON");
}

#[test]
fn more_than_200k_points_are_capped_per_metric() {
    let mut text =
        String::from(r#"{"data":{"metrics":[{"name":"step_count","units":"count","data":["#);
    for i in 0..=MAX_POINTS {
        if i > 0 {
            text.push(',');
        }
        text.push_str(r#"{"date":"2026-10-01 00:00:00 +0100","qty":1}"#);
    }
    text.push_str("]}]}}");
    let export = parse_export(text.as_bytes()).expect("parses");
    assert_eq!(export.point_count("step_count"), MAX_POINTS);
}

#[test]
fn very_deep_nesting_is_a_bad_file_not_a_crash() {
    let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    assert!(parse_export(deep.as_bytes()).is_err());
    let nested = format!(
        r#"{{"data":{{"metrics":{}1{}}}}}"#,
        "[".repeat(50_000),
        "]".repeat(50_000)
    );
    assert!(parse_export(nested.as_bytes()).is_err());
}

#[test]
fn odd_but_valid_layouts_are_tolerated() {
    for text in [
        r#"{"data":{}}"#,
        r#"{"data":[]}"#,
        r#"{"data":{"metrics":null,"workouts":null}}"#,
        r#"{"data":{"metrics":[{}]}}"#,
        r#"{"data":{"metrics":[{"name":5,"units":[],"data":[{"date":1,"qty":"x"}]}]}}"#,
        r#"{"data":{"metrics":[{"name":"step_count","units":"count","data":null}]}}"#,
        r#"{"data":{"workouts":[{"start":"2026-10-01","duration":1e308}]}}"#,
    ] {
        assert!(parse_export(text.as_bytes()).is_ok(), "{text}");
    }
    for text in [
        "",
        "null",
        "[]",
        "5",
        r#"{"data":{"metrics":{}}}"#,
        r#"{"data":[1,2,3]}"#,
        r#"{"x":1}"#,
    ] {
        assert!(parse_export(text.as_bytes()).is_err(), "{text}");
    }
}

const KEYS: &[&str] = &[
    "data",
    "metrics",
    "workouts",
    "name",
    "units",
    "qty",
    "date",
    "totalSleep",
    "asleep",
    "core",
    "deep",
    "rem",
    "awake",
    "id",
    "start",
    "duration",
    "activeEnergyBurned",
    "activeEnergy",
    "distance",
    "step_count",
    "sleep_analysis",
    "weight_body_mass",
    "x",
];

fn any_json() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(|n| json!(n)),
        any::<u64>().prop_map(|n| json!(n)),
        any::<f64>().prop_map(|f| json!(f)),
        prop_oneof![Just(1e300), Just(-1e300), Just(f64::MAX), Just(5e-324)].prop_map(|f| json!(f)),
        "\\PC{0,24}".prop_map(Value::String),
        "20[0-9]{2}-[0-1][0-9]-[0-3][0-9] [0-2][0-9]:00:00 \\+0100".prop_map(Value::String),
        prop::sample::select(vec!["kcal", "kJ", "kg", "lb", "km", "mi", "hr", "count"])
            .prop_map(|s| Value::String(s.to_owned())),
    ];
    leaf.prop_recursive(7, 96, 6, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..6).prop_map(Value::Array),
            prop::collection::vec((prop::sample::select(KEYS.to_vec()), inner.clone()), 0..6)
                .prop_map(|kv| Value::Object(
                    kv.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
                )),
            prop::collection::vec(("[a-zA-Z]{1,8}", inner), 0..4)
                .prop_map(|kv| Value::Object(kv.into_iter().collect())),
        ]
    })
}

fn assert_sane(imported: &Imported) {
    for (date, d) in &imported.days {
        assert!(is_iso_date(date));
        for v in [d.steps, d.energy, d.resting_hr(), d.hrv(), d.weight()]
            .into_iter()
            .flatten()
        {
            assert!(v.is_finite() && v >= 0.0);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn arbitrary_bytes_never_panic(bytes in prop::collection::vec(any::<u8>(), 0..512)) {
        let _ = parse_export(&bytes);
    }

    #[test]
    fn arbitrary_json_is_parsed_or_recorded_bad(v in any_json()) {
        let bytes = serde_json::to_vec(&v).expect("serialises");
        match parse_export(&bytes) {
            Ok(export) => {
                let mut imported = Imported::default();
                imported.ingest(&export, &mut HashSet::new());
                assert_sane(&imported);
                let view = health(&imported, None, TODAY, 0).expect("health");
                prop_assert_eq!(view.days.len(), 90);
            }
            Err(reason) => prop_assert!(!reason.is_empty()),
        }
    }

    #[test]
    fn arbitrary_files_on_disk_are_never_fatal(v in any_json()) {
        let bytes = serde_json::to_vec(&v).expect("serialises");
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join("x.json"), &bytes).expect("write");
        let got = import_dir(dir.path());
        prop_assert_eq!(got.file_count, 1);
        prop_assert!(got.bad_files.len() <= 1);
        assert_sane(&got);
    }
}

// --- cache ------------------------------------------------------------------

#[test]
fn the_import_is_cached_until_the_file_list_changes() {
    let dir = folder_with(&[(
        "a.json",
        HOUR_MS,
        one_metric(
            "step_count",
            "count",
            &json!([{"date": "2026-10-01", "qty": 5}]),
        ),
    )]);
    let state = HealthState::default();
    let first = state.load(dir.path()).expect("load");
    let second = state.load(dir.path()).expect("load");
    assert!(Arc::ptr_eq(&first, &second));

    let b = dir.path().join("b.json");
    fs::write(
        &b,
        one_metric(
            "step_count",
            "count",
            &json!([{"date": "2026-10-02", "qty": 6}]),
        ),
    )
    .expect("write");
    let third = state.load(dir.path()).expect("load");
    assert!(!Arc::ptr_eq(&first, &third));
    assert_eq!(third.days.len(), 2);

    state.clear();
    let fourth = state.load(dir.path()).expect("load");
    assert!(!Arc::ptr_eq(&third, &fourth));
}

#[test]
fn importing_never_changes_the_folder() {
    let dir = fixture_copy();
    let snapshot = |p: &Path| {
        let mut out: Vec<(String, u64, i64)> = fs::read_dir(p)
            .expect("read_dir")
            .map(|e| {
                let e = e.expect("entry");
                let m = e.metadata().expect("meta");
                (
                    e.file_name().to_string_lossy().into_owned(),
                    m.len(),
                    mtime_ms(&m),
                )
            })
            .collect();
        out.sort();
        out
    };
    let before = snapshot(dir.path());
    let _ = import_dir(dir.path());
    assert_eq!(snapshot(dir.path()), before);
}

// --- hardening: hostile JSON ------------------------------------------------

#[test]
fn a_byte_order_mark_is_ignored() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(br#"{"data":{"metrics":[]}}"#);
    assert!(parse_export(&bytes).is_ok());
}

#[test]
fn impossible_calendar_dates_are_not_days() {
    assert_eq!(local_date("2026-02-30 00:00:00 +0000"), None);
    assert_eq!(local_date("2026-04-31 00:00:00 +0000"), None);
    assert_eq!(local_date("2028-02-29 00:00:00 +0000"), Some("2028-02-29"));
    assert_eq!(local_date("2027-02-29 00:00:00 +0000"), None);
}

#[test]
fn byte_order_mark_empty_truncated_and_non_utf8_files_are_bad_not_fatal() {
    let good = r#"{"data":{"metrics":[]}}"#;
    let mut with_bom = vec![0xEF, 0xBB, 0xBF];
    with_bom.extend_from_slice(good.as_bytes());
    let mut bad_utf8 = br#"{"data":{"metrics":[{"name":""#.to_vec();
    bad_utf8.extend_from_slice(&[0xFF, 0xFE, 0xC0, 0x80]);
    bad_utf8.extend_from_slice(br#""}]}}"#);
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("empty", Vec::new()),
        ("whitespace", b"   \n\t ".to_vec()),
        ("truncated", good.as_bytes()[..good.len() - 3].to_vec()),
        ("bad-utf8", bad_utf8),
        ("nul", vec![0; 64]),
        (
            "nan-token",
            br#"{"data":{"metrics":[{"data":[{"qty":NaN}]}]}}"#.to_vec(),
        ),
        (
            "inf-token",
            br#"{"data":{"workouts":[{"duration":Infinity}]}}"#.to_vec(),
        ),
        (
            "huge-exponent",
            br#"{"data":{"workouts":[{"duration":1e999}]}}"#.to_vec(),
        ),
        ("trailing-garbage", br#"{"data":{}} x"#.to_vec()),
    ];
    for (label, bytes) in cases {
        let result = std::panic::catch_unwind(|| parse_export(&bytes));
        let parsed = result.unwrap_or_else(|_| panic!("{label} panicked"));
        let reason = parsed.expect_err(label);
        assert!(
            ["not valid JSON", "unexpected layout", "could not be read"].contains(&reason.as_str()),
            "{label}: {reason}"
        );
    }
}

#[test]
fn duplicate_keys_are_a_bad_file_with_a_fixed_reason() {
    let r = parse_export(br#"{"data":{},"data":{}}"#);
    assert_eq!(r.err().as_deref(), Some("unexpected layout"));
}

#[test]
fn wrong_typed_and_string_numbers_are_ignored_not_coerced() {
    let day = "2026-10-01 00:00:00 +0100";
    let p = json!([
        {"date": day, "qty": "NaN"},
        {"date": "2026-10-02 00:00:00 +0100", "qty": "Infinity"},
        {"date": "2026-10-03 00:00:00 +0100", "qty": "5000"},
        {"date": "2026-10-04 00:00:00 +0100", "qty": [5000]},
        {"date": "2026-10-05 00:00:00 +0100", "qty": null},
        {"date": "2026-10-06 00:00:00 +0100", "qty": true},
        {"date": "2026-10-07 00:00:00 +0100", "qty": -0.0},
        {"date": "2026-10-08 00:00:00 +0100", "qty": 1e308},
        {"date": "2026-10-09 00:00:00 +0100", "qty": -5000},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("step_count", "count", &p))]);
    // Only the negative zero is a valid step count.
    assert_eq!(got.days.keys().collect::<Vec<_>>(), ["2026-10-07"]);
    assert_eq!(got.days["2026-10-07"].steps, Some(-0.0));
    assert!(got.bad_files.is_empty());
}

#[test]
fn negative_sleep_and_energy_never_leave_a_day_with_negative_totals() {
    let p =
        json!([{"date": "2026-10-01 00:00:00 +0100", "totalSleep": -3, "core": -1, "awake": -2}]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("sleep_analysis", "hr", &p))]);
    assert!(got.days.is_empty());
    let p = json!([{"date": "2026-10-01 00:00:00 +0100", "qty": -1}]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("active_energy", "kcal", &p))]);
    assert!(got.days.is_empty());
}

#[test]
fn timestamps_that_are_not_iso_never_panic_on_char_boundaries() {
    let stamps = [
        "é2026-10-0",
        "2026-10-0é",
        "2026-10-01é",
        "日本語2026-10-01",
        "2026-10-日",
        "2026年10月01日 00:00",
        "🙂🙂🙂🙂",
        "\u{202E}2026-10-01",
        "２０２６-１０-０１",
        "2026-10-01\u{0}",
        "",
        "2026",
        "0000-00-00 00:00:00",
    ];
    let points: Vec<Value> = stamps
        .iter()
        .map(|s| json!({"date": s, "qty": 10, "totalSleep": 1.0}))
        .collect();
    let metrics = json!([
        {"name": "step_count", "units": "count", "data": points},
        {"name": "sleep_analysis", "units": "hr", "data": points},
    ]);
    let workouts: Vec<Value> = stamps
        .iter()
        .map(|s| json!({"id": s, "name": s, "start": s, "duration": 60}))
        .collect();
    let text = json!({"data": {"metrics": metrics, "workouts": workouts}}).to_string();
    let got = import_files(&[("a.json", HOUR_MS, text)]);
    assert!(got.bad_files.is_empty());
    // Only a real calendar date in the first ten characters is kept, and a
    // non-ASCII tail after it does not matter.
    assert_eq!(got.days.keys().collect::<Vec<_>>(), ["2026-10-01"]);
    // "2026-10-01é" and "2026-10-01<NUL>" are two different workouts.
    assert_eq!(got.workouts.len(), 2);
    assert!(got.workouts.iter().all(|w| w.date == "2026-10-01"));
    assert_eq!(local_date("2026-10-0é"), None);
    assert_eq!(local_date("2026-10-01é"), Some("2026-10-01"));
}

#[test]
fn the_date_is_the_local_one_across_week_and_year_boundaries() {
    let p = json!([
        {"date": "2025-12-31 23:59:59 -0800", "qty": 1},
        {"date": "2026-01-01 00:00:00 +0100", "qty": 2},
        {"date": "2024-02-29 12:00:00 +0000", "qty": 4},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("step_count", "count", &p))]);
    assert_eq!(got.days["2025-12-31"].steps, Some(1.0));
    assert_eq!(got.days["2026-01-01"].steps, Some(2.0));
    assert_eq!(got.days["2024-02-29"].steps, Some(4.0));
}

#[test]
fn the_window_is_contiguous_across_a_year_end_and_a_leap_day() {
    for today in ["2027-01-01", "2024-03-01", "2026-12-31", "2028-02-29"] {
        let v = health(&Imported::default(), None, today, 0).expect("health");
        assert_eq!(v.days.len(), 90, "{today}");
        assert_eq!(v.days[89].date, today);
        for pair in v.days.windows(2) {
            assert_eq!(shift_days(&pair[0].date, 1), pair[1].date, "{today}");
        }
        assert!(v.days.iter().all(|d| is_iso_date(&d.date)));
    }
    let v = health(&Imported::default(), None, "2024-03-01", 0).expect("health");
    assert_eq!(v.days[88].date, "2024-02-29");
    let v = health(&Imported::default(), None, "2027-01-01", 0).expect("health");
    assert!(v.days.iter().any(|d| d.date == "2026-12-31"));
}

#[test]
fn units_are_matched_case_insensitively_and_trimmed() {
    let day = "2026-10-01 00:00:00 +0100";
    let metrics = json!([
        {"name": "active_energy", "units": " KJ ", "data": [{"date": day, "qty": 4184}]},
        {"name": "weight_body_mass", "units": "LB", "data": [{"date": day, "qty": 220.462_262}]},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, export(&metrics))]);
    let d = &got.days["2026-10-01"];
    assert!((d.energy.expect("energy") - 1000.0).abs() < 1e-6);
    assert!((d.weight().expect("weight") - 100.0).abs() < 1e-3);
}

#[test]
fn conversions_apply_the_range_after_converting() {
    // 20 kg is the lower edge: 44.0925 lb is just above, 44.0 lb just below.
    assert!(weight_kg(Some(44.1), Some("lb")).is_some());
    assert!(weight_kg(Some(44.0), Some("lb")).is_none());
    // 20,000 kcal is the upper edge: in kJ it is 83,680.
    assert!(energy_kcal(Some(83_680.0), Some("kJ")).is_some());
    assert!(energy_kcal(Some(83_681.0), Some("kJ")).is_none());
    assert!(energy_kcal(Some(f64::NAN), Some("kcal")).is_none());
    assert!(energy_kcal(Some(f64::INFINITY), Some("kcal")).is_none());
    assert!(energy_kcal(Some(1.0), None).is_none());
    assert!(distance_km(Some(5000.0), Some("km")).is_some());
    assert!(distance_km(Some(5000.1), Some("km")).is_none());
    assert!(distance_km(Some(3106.0), Some("mi")).is_some());
    assert!(distance_km(Some(3107.0), Some("mi")).is_none());
    assert!(distance_km(Some(-1.0), Some("km")).is_none());
    assert!(distance_km(Some(0.0), Some("km")).is_some());
    assert!(weight_kg(Some(1e308), Some("lb")).is_none());
}

#[test]
fn workout_names_lose_control_characters_and_are_capped_but_markup_is_kept_as_text() {
    let long = "x".repeat(500);
    let multibyte = "é".repeat(500);
    let w = json!({"data": {"workouts": [
        {"id": "1", "name": "<b>Run</b>\u{0007}\n\t&amp;", "start": "2026-10-01 08:00:00"},
        {"id": "2", "name": long, "start": "2026-10-01 09:00:00"},
        {"id": "3", "name": multibyte, "start": "2026-10-01 10:00:00"},
        {"id": "4", "name": "   ", "start": "2026-10-01 11:00:00"},
        {"id": "5", "name": 42, "start": "2026-10-01 12:00:00"},
    ]}});
    let got = import_files(&[("w.json", HOUR_MS, w.to_string())]);
    let names: Vec<&str> = got.workouts.iter().map(|w| w.name.as_str()).collect();
    assert_eq!(names[0], "<b>Run</b>&amp;");
    assert_eq!(names[1].chars().count(), MAX_NAME_CHARS);
    assert_eq!(names[2].chars().count(), MAX_NAME_CHARS);
    assert_eq!(names[3], "Workout");
    assert_eq!(names[4], "Workout");
}

#[test]
fn workouts_dedupe_by_id_or_by_name_and_start() {
    let one = |id: Option<&str>, name: &str, start: &str, dur: i64| {
        let mut o = json!({"name": name, "start": start, "duration": dur});
        if let Some(id) = id {
            o["id"] = json!(id);
        }
        o
    };
    let old = json!({"data": {"workouts": [
        one(Some("a"), "Run", "2026-10-01 08:00:00", 600),
        one(None, "Swim", "2026-10-02 08:00:00", 600),
        one(Some(""), "Walk", "2026-10-03 08:00:00", 600),
    ]}});
    let new = json!({"data": {"workouts": [
        one(Some("a"), "Run (edited)", "2026-10-01 08:00:00", 1200),
        one(None, "Swim", "2026-10-02 08:00:00", 1200),
        one(Some(""), "Walk", "2026-10-03 08:00:00", 1200),
        one(None, "Swim", "2026-10-02 09:00:00", 1200),
    ]}});
    let got = import_files(&[
        ("old.json", HOUR_MS, old.to_string()),
        ("new.json", 2 * HOUR_MS, new.to_string()),
    ]);
    assert_eq!(got.workouts.len(), 4);
    // The newest file wins for each duplicate.
    assert!(got.workouts.iter().all(|w| w.duration_min == Some(20)));
}

#[test]
fn a_repeated_timestamp_inside_one_file_counts_once() {
    let p = json!([
        {"date": "2026-10-01 00:00:00 +0100", "qty": 100},
        {"date": "2026-10-01 00:00:00 +0100", "qty": 100},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("step_count", "count", &p))]);
    assert_eq!(got.days["2026-10-01"].steps, Some(100.0));
}

#[test]
fn equal_mtimes_give_the_same_result_whatever_the_directory_order() {
    let p = |qty: i64| json!([{"date": "2026-10-01 00:00:00 +0100", "qty": qty}]);
    let files: Vec<(String, i64)> = (0..6).map(|i| (format!("f{i}.json"), i * 100)).collect();
    let spec: Vec<(&str, i64, String)> = files
        .iter()
        .map(|(n, q)| {
            (
                n.as_str(),
                HOUR_MS,
                one_metric("step_count", "count", &p(*q)),
            )
        })
        .collect();
    let got = import_files(&spec);
    // The last name sorts first (newest) and wins.
    assert_eq!(got.days["2026-10-01"].steps, Some(500.0));
    let again = import_files(&spec);
    assert_eq!(again.days, got.days);
}

#[test]
fn many_bad_files_are_all_counted_and_named_by_file_only() {
    let mut spec: Vec<(String, i64, String)> = Vec::new();
    for i in 0..60 {
        spec.push((
            format!("sub/dir/bad{i:02}&'.json"),
            HOUR_MS,
            "nope".to_owned(),
        ));
    }
    let refs: Vec<(&str, i64, String)> = spec
        .iter()
        .map(|(n, m, t)| (n.as_str(), *m, t.clone()))
        .collect();
    let got = import_files(&refs);
    assert_eq!(got.bad_files.len(), 60);
    assert!(got.bad_files.iter().all(|b| !b.name.contains('/')));
    assert!(got.bad_files.iter().all(|b| !b.reason.contains("nope")));
    let v = health(&got, None, TODAY, HOUR_MS).expect("health");
    assert_eq!(v.bad_files.len(), 50);
    assert_eq!(v.bad_file_count, 60);
    assert_eq!(v.file_count, 60);
}

#[test]
fn clean_name_keeps_markup_as_inert_text() {
    assert_eq!(
        clean_name("<img src=x onerror=1>\n.json"),
        "<img src=x onerror=1>.json"
    );
    assert_eq!(clean_name("\u{0}\u{1b}[31mred"), "[31mred");
    assert_eq!(clean_name(""), "");
}

// --- hardening: the folder guard --------------------------------------------

#[test]
fn a_path_that_resolves_outside_the_folder_is_rejected() {
    let outside = folder_with(&[("secret.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    let dir = folder_with(&[("ok.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    let canonical = fs::canonicalize(dir.path()).expect("canonical");
    let out_name = outside
        .path()
        .file_name()
        .expect("name")
        .to_string_lossy()
        .into_owned();
    let entry = |rel: &str| FileEntry {
        rel: rel.to_owned(),
        len: 10,
        mtime_ms: 0,
    };
    let sneaky = entry(&format!("../{out_name}/secret.json"));
    // `..` leaves the folder; the temp parent is shared, so go up explicitly.
    let up = canonical.parent().expect("parent").join(&out_name).exists();
    let result = read_file(&canonical, &sneaky);
    if up {
        assert_eq!(result, Err("is outside the folder".to_owned()));
    } else {
        assert!(result.is_err());
    }
    assert!(read_file(&canonical, &entry("../../../../../../../../nothing.json")).is_err());
    assert!(read_file(&canonical, &entry("ok.json")).is_ok());
    assert!(read_file(&canonical, &entry("gone.json")).is_err());
    assert!(read_file(&canonical, &entry("")).is_err());
    // An absolute path in the listing must not replace the folder.
    let abs = outside.path().join("secret.json");
    let abs = abs.to_string_lossy().replace('\\', "/");
    assert!(read_file(&canonical, &entry(&abs)).is_err());
}

#[test]
fn a_file_larger_than_listed_is_still_capped_when_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("grew.json");
    let f = fs::File::create(&path).expect("create");
    f.set_len(MAX_FILE_BYTES + 10).expect("sparse");
    drop(f);
    let canonical = fs::canonicalize(dir.path()).expect("canonical");
    let lying = FileEntry {
        rel: "grew.json".to_owned(),
        len: 5,
        mtime_ms: 0,
    };
    assert_eq!(
        read_file(&canonical, &lying),
        Err("larger than 32 MB, not read".to_owned())
    );
}

#[test]
fn a_file_removed_after_listing_is_a_bad_file() {
    let dir = folder_with(&[("a.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    let canonical = fs::canonicalize(dir.path()).expect("canonical");
    let listing = list(&canonical).expect("list");
    fs::remove_file(dir.path().join("a.json")).expect("remove");
    let got = import(&canonical, &listing);
    assert_eq!(got.bad_files.len(), 1);
    assert_eq!(got.bad_files[0].reason, "could not be read");
}

#[test]
fn a_folder_named_like_a_json_file_is_not_listed_or_read() {
    let dir = tempfile::tempdir().expect("temp dir");
    fs::create_dir(dir.path().join("looks.json")).expect("mkdir");
    fs::write(dir.path().join("looks.json").join("in.json"), "{}").expect("write");
    let listing = list(dir.path()).expect("list");
    let rels: Vec<&str> = listing.files.iter().map(|f| f.rel.as_str()).collect();
    assert_eq!(rels, ["looks.json/in.json"]);
}

#[cfg(windows)]
#[test]
fn a_junction_to_a_folder_inside_a_subfolder_is_not_followed() {
    let outside = folder_with(&[("secret.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    let dir = folder_with(&[("sub/ok.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    junction(&dir.path().join("sub").join("link"), outside.path());
    let got = import_dir(dir.path());
    assert_eq!(got.file_count, 1);
    assert!(got.bad_files.is_empty());
}

#[cfg(any(unix, windows))]
fn file_symlink(link: &Path, real: &Path) -> bool {
    #[cfg(unix)]
    let r = std::os::unix::fs::symlink(real, link);
    #[cfg(windows)]
    let r = std::os::windows::fs::symlink_file(real, link);
    r.is_ok()
}

#[cfg(any(unix, windows))]
#[test]
fn a_file_symlink_inside_the_folder_is_not_followed() {
    let outside = folder_with(&[("secret.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    let dir = folder_with(&[("ok.json", HOUR_MS, r#"{"data":{}}"#.into())]);
    if !file_symlink(
        &dir.path().join("link.json"),
        &outside.path().join("secret.json"),
    ) {
        // Creating symlinks needs a privilege on Windows; nothing to check.
        return;
    }
    let canonical = fs::canonicalize(dir.path()).expect("canonical");
    let listing = list(&canonical).expect("list");
    let rels: Vec<&str> = listing.files.iter().map(|f| f.rel.as_str()).collect();
    assert_eq!(rels, ["ok.json"]);
    let sneaky = FileEntry {
        rel: "link.json".to_owned(),
        len: 5,
        mtime_ms: 0,
    };
    assert_eq!(
        read_file(&canonical, &sneaky),
        Err("goes through a link".to_owned())
    );
}

// --- hardening: staleness, rings, goals -------------------------------------

#[test]
fn staleness_flips_just_after_exactly_48_hours() {
    let got = import_files(&[("a.json", 1_000 * HOUR_MS, "{\"data\":{}}".into())]);
    let t = 1_000 * HOUR_MS;
    let at = |now: i64| health(&got, None, TODAY, now).expect("health").stale;
    assert!(!at(t + 48 * HOUR_MS - 1));
    assert!(!at(t + 48 * HOUR_MS));
    assert!(at(t + 48 * HOUR_MS + 1));
    // A file dated in the future (clock skew) is not stale.
    assert!(!at(t - 5 * HOUR_MS));
    assert!(!at(i64::MIN));
    assert!(!at(t));
}

#[test]
fn staleness_uses_the_newest_file_even_if_it_is_bad() {
    let got = import_files(&[
        ("old.json", 1_000 * HOUR_MS, "{\"data\":{}}".into()),
        ("new.json", 1_100 * HOUR_MS, "garbage".into()),
    ]);
    let v = health(&got, None, TODAY, 1_101 * HOUR_MS).expect("health");
    assert!(!v.stale);
    assert_eq!(v.last_export, Some(1_100 * HOUR_MS));
}

#[test]
fn rings_fall_back_when_today_has_only_non_ring_data() {
    let metrics = json!([
        {"name": "heart_rate_variability", "units": "ms", "data": [{"date": "2026-10-29", "qty": 40}]},
        {"name": "sleep_analysis", "units": "hr", "data": [{"date": "2026-10-27", "awake": 0.5}]},
    ]);
    let got = import_files(&[("a.json", HOUR_MS, export(&metrics))]);
    let v = health(&got, None, TODAY, HOUR_MS).expect("health");
    let r = v.rings_day.expect("rings");
    assert!(!r.is_today);
    assert_eq!(r.day.date, "2026-10-27");
    assert_eq!(r.day.sleep.expect("sleep").total, 0.0);
    // The newest day with any value is today, even though the rings are not.
    assert_eq!(v.latest_data.as_deref(), Some("2026-10-29"));
}

#[test]
fn rings_day_older_than_the_window_is_still_offered() {
    let p = json!([{"date": "2025-01-01 00:00:00", "qty": 10}]);
    let got = import_files(&[("a.json", HOUR_MS, one_metric("step_count", "count", &p))]);
    let v = health(&got, None, TODAY, HOUR_MS).expect("health");
    assert_eq!(v.rings_day.expect("rings").day.date, "2025-01-01");
    assert!(v.days.iter().all(|d| d.steps.is_none()));
}

#[test]
fn out_of_range_or_wrong_typed_plan_goals_fall_back_to_defaults() {
    for plan in [
        "steps_goal: 0\nactive_energy_goal: 0\nsleep_goal: 0.5",
        "steps_goal: 100001\nactive_energy_goal: 10001\nsleep_goal: 16.5",
        "steps_goal: -5\nactive_energy_goal: -1\nsleep_goal: -8",
        "steps_goal: lots\nactive_energy_goal: many\nsleep_goal: long",
        "steps_goal: [1]\nactive_energy_goal: 1.5\nsleep_goal: .nan",
        "sleep_goal: .inf",
    ] {
        let text = format!("---\ntype: plan\n{plan}\n---\n");
        let index = vault_with(&[("Fitness/Plan.md", &text)]);
        let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
        assert_eq!(v.goals, Goals::default(), "{plan}");
    }
}

#[test]
fn plan_goal_edges_are_accepted_and_each_field_falls_back_alone() {
    let text = "---\ntype: plan\nsteps_goal: 100000\nactive_energy_goal: 1\nsleep_goal: 16\n---\n";
    let index = vault_with(&[("Fitness/Plan.md", text)]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(v.goals.steps, 100_000);
    assert_eq!(v.goals.active_energy, 1);
    assert!((v.goals.sleep_hours - 16.0).abs() < f64::EPSILON);

    let text = "---\ntype: plan\nsteps_goal: 0\nactive_energy_goal: 700\nsleep_goal: 1\n---\n";
    let index = vault_with(&[("Fitness/Plan.md", text)]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(v.goals.steps, 8000);
    assert_eq!(v.goals.active_energy, 700);
    assert!((v.goals.sleep_hours - 1.0).abs() < f64::EPSILON);
}

#[test]
fn the_fitness_plan_note_wins_over_other_plans() {
    let index = vault_with(&[
        ("A/Plan.md", "---\ntype: plan\nsteps_goal: 1111\n---\n"),
        (
            "Fitness/Plan.md",
            "---\ntype: plan\nsteps_goal: 2222\n---\n",
        ),
    ]);
    let v = health(&Imported::default(), Some(&index), TODAY, 0).expect("health");
    assert_eq!(v.goals.steps, 2222);
}

// --- hardening: properties --------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn local_date_never_panics_and_only_returns_a_valid_prefix(s in "\\PC{0,30}") {
        if let Some(d) = local_date(&s) {
            prop_assert!(is_iso_date(d));
            prop_assert!(s.starts_with(d));
            prop_assert_eq!(d.len(), 10);
        }
    }

    #[test]
    fn local_date_survives_multibyte_prefixes(
        pre in "[é日🙂]{0,3}",
        d in "20[0-9]{2}-[0-1][0-9]-[0-3][0-9]",
        post in "[é日🙂 :0-9+]{0,8}",
    ) {
        let s = format!("{pre}{d}{post}");
        let got = local_date(&s);
        if pre.is_empty() {
            prop_assert_eq!(
                got.is_some(),
                is_iso_date(&d) && crate::fitness::shift_days(&d, 0) == d
            );
        } else {
            prop_assert!(got.is_none());
        }
    }

    #[test]
    fn converted_values_are_always_finite_and_in_range(
        q in prop_oneof![any::<f64>(), -1e12f64..1e12],
        units in prop::sample::select(vec!["kcal", "kJ", "kg", "lb", "km", "mi", "", "x"]),
    ) {
        if let Some(v) = energy_kcal(Some(q), Some(units)) {
            prop_assert!(v.is_finite() && (0.0..=20_000.0).contains(&v));
        }
        if let Some(v) = weight_kg(Some(q), Some(units)) {
            prop_assert!(v.is_finite() && (20.0..=400.0).contains(&v));
        }
        if let Some(v) = distance_km(Some(q), Some(units)) {
            prop_assert!(v.is_finite() && (0.0..=5000.0).contains(&v));
        }
    }

    #[test]
    fn arbitrary_listed_paths_never_panic_and_never_escape(rel in "[a-zA-Z0-9_./\\\\:~ -]{0,40}") {
        let dir = tempfile::tempdir().expect("temp dir");
        let canonical = fs::canonicalize(dir.path()).expect("canonical");
        let entry = FileEntry { rel, len: 1, mtime_ms: 0 };
        // The folder is empty, so nothing can be read at all.
        prop_assert!(read_file(&canonical, &entry).is_err());
    }

    #[test]
    fn the_view_is_total_for_any_today_and_now(
        y in 1u32..=9999, m in 1u32..=12, d in 1u32..=31, now in any::<i64>(),
    ) {
        let today = format!("{y:04}-{m:02}-{d:02}");
        if is_iso_date(&today) {
            let v = health(&Imported::default(), None, &today, now).expect("health");
            prop_assert_eq!(v.days.len(), 90);
        }
    }
}
