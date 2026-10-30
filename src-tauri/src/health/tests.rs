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
