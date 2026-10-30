//! Data for the Health page (requirements §3.7): a read-only importer for
//! Health Auto Export JSON files (threat model T16, T17), plus the view the
//! UI draws. Nothing here ever writes to the export folder.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::fitness::{shift_days, workouts as vault_workouts};
use crate::index::Index;
use crate::vault::note::is_iso_date;

/// Largest export file the app will read (threat model T16).
pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// Most files read per import; the newest are kept.
pub const MAX_FILES: usize = 2000;
/// Deepest sub-folder searched below the chosen folder.
pub const MAX_DEPTH: usize = 3;
/// Most points read per metric, and workouts, per file.
pub const MAX_POINTS: usize = 200_000;
/// Files looked at while walking; further ones are only counted.
const MAX_CANDIDATES: usize = 100_000;
const WINDOW_DAYS: i64 = 90;
const STALE_AFTER_MS: i64 = 48 * 60 * 60 * 1000;
const MAX_WORKOUTS: usize = 300;
const MAX_BAD_LISTED: usize = 50;
const MAX_NAME_CHARS: usize = 120;
const DEFAULT_STEPS_GOAL: i64 = 8000;
const DEFAULT_ENERGY_GOAL: i64 = 500;
const DEFAULT_SLEEP_GOAL: f64 = 8.0;
const PLAN_PATH: &str = "Fitness/Plan.md";

const KJ_PER_KCAL: f64 = 4.184;
const KG_PER_LB: f64 = 0.453_592_37;
const KM_PER_MILE: f64 = 1.609_344;

// ---------------------------------------------------------------------------
// Listing

/// One export file found in the folder, before it is read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    /// Path below the folder, with forward slashes.
    pub rel: String,
    pub len: u64,
    /// Modification time in milliseconds since the Unix epoch.
    pub mtime_ms: i64,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Listing {
    /// Newest first (by mtime, then name).
    pub files: Vec<FileEntry>,
    /// Files found beyond the cap and not read.
    pub skipped: usize,
}

fn mtime_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

/// True for symlinks, junctions and mount points. Cloud Files placeholders
/// (iCloud for Windows) are reparse points too but are not name surrogates,
/// so they are allowed.
fn is_link(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

/// Lists the `.json` files under `folder`, up to `MAX_DEPTH` folders deep.
/// Hidden names, links and junctions are skipped. At most `MAX_FILES` are
/// kept, newest first; the rest are counted in `skipped`.
pub fn list(folder: &Path) -> io::Result<Listing> {
    let mut found = Vec::new();
    let mut overflow = 0usize;
    walk(folder, "", 0, &mut found, &mut overflow)?;
    found.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms).then_with(|| b.rel.cmp(&a.rel)));
    let mut skipped = overflow;
    if found.len() > MAX_FILES {
        skipped += found.len() - MAX_FILES;
        found.truncate(MAX_FILES);
    }
    Ok(Listing {
        files: found,
        skipped,
    })
}

fn walk(
    dir: &Path,
    prefix: &str,
    depth: usize,
    out: &mut Vec<FileEntry>,
    overflow: &mut usize,
) -> io::Result<()> {
    for item in fs::read_dir(dir)? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(item.path()) else {
            continue;
        };
        if is_link(&meta) {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        if meta.is_dir() {
            if depth < MAX_DEPTH {
                // An unreadable sub-folder does not stop the rest.
                let _ = walk(&item.path(), &rel, depth + 1, out, overflow);
            }
        } else if meta.is_file() && has_json_extension(&name) {
            if out.len() >= MAX_CANDIDATES {
                *overflow += 1;
            } else {
                out.push(FileEntry {
                    rel,
                    len: meta.len(),
                    mtime_ms: mtime_ms(&meta),
                });
            }
        }
    }
    Ok(())
}

fn has_json_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("json"))
}

// ---------------------------------------------------------------------------
// Reading one file

/// Why a file could not be used. Never contains file content.
fn read_file(canonical_folder: &Path, file: &FileEntry) -> Result<Vec<u8>, String> {
    if file.len > MAX_FILE_BYTES {
        return Err("larger than 32 MB, not read".to_owned());
    }
    // No link or junction on any component, and the real path stays inside.
    let mut current = canonical_folder.to_path_buf();
    for part in file.rel.split('/') {
        current.push(part);
        let meta = fs::symlink_metadata(&current).map_err(|_| "could not be read".to_owned())?;
        if is_link(&meta) {
            return Err("goes through a link".to_owned());
        }
    }
    let real = fs::canonicalize(&current).map_err(|_| "could not be read".to_owned())?;
    if !real.starts_with(canonical_folder) {
        return Err("is outside the folder".to_owned());
    }
    let handle = fs::File::open(&real).map_err(|_| "could not be read".to_owned())?;
    // The size can change after listing; never read more than the cap.
    let mut bytes = Vec::new();
    handle
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not be read".to_owned())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("larger than 32 MB, not read".to_owned());
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Parsing: typed, lenient about values, strict about layout

fn lenient_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        Some(Value::Number(n)) => n.as_f64(),
        _ => None,
    })
}

fn lenient_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Option::<Value>::deserialize(d)? {
        Some(Value::String(s)) => Some(s),
        _ => None,
    })
}

#[derive(Debug, Default, Deserialize)]
struct RawExport {
    data: Option<RawData>,
}

#[derive(Debug, Default, Deserialize)]
struct RawData {
    #[serde(default)]
    metrics: Option<Vec<RawMetric>>,
    #[serde(default)]
    workouts: Option<Vec<RawWorkout>>,
}

#[derive(Debug, Default, Deserialize)]
struct RawMetric {
    #[serde(default, deserialize_with = "lenient_text")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    units: Option<String>,
    #[serde(default)]
    data: Option<Vec<RawPoint>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPoint {
    #[serde(default, deserialize_with = "lenient_text")]
    date: Option<String>,
    #[serde(default, deserialize_with = "lenient_number")]
    qty: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    total_sleep: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    asleep: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    core: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    deep: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    rem: Option<f64>,
    #[serde(default, deserialize_with = "lenient_number")]
    awake: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWorkout {
    #[serde(default, deserialize_with = "lenient_text")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient_text")]
    start: Option<String>,
    #[serde(default, deserialize_with = "lenient_number")]
    duration: Option<f64>,
    #[serde(default)]
    active_energy_burned: Option<Value>,
    #[serde(default)]
    active_energy: Option<Value>,
    #[serde(default)]
    distance: Option<Value>,
}

/// A parsed export with the per-metric point cap applied.
#[derive(Debug, Default)]
pub struct Export {
    metrics: Vec<RawMetric>,
    workouts: Vec<RawWorkout>,
}

impl Export {
    /// Number of points kept for the metric called `name` (all copies).
    pub fn point_count(&self, name: &str) -> usize {
        self.metrics
            .iter()
            .filter(|m| m.name.as_deref() == Some(name))
            .map(|m| m.data.as_ref().map_or(0, Vec::len))
            .sum()
    }
}

/// Parses one export file. Never panics; the error is a short fixed reason.
pub fn parse_export(bytes: &[u8]) -> Result<Export, String> {
    // Some editors and tools prefix UTF-8 files with a byte order mark.
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let raw: RawExport = serde_json::from_slice(bytes).map_err(|e| {
        match e.classify() {
            serde_json::error::Category::Data => "unexpected layout",
            serde_json::error::Category::Io => "could not be read",
            _ => "not valid JSON",
        }
        .to_owned()
    })?;
    let data = raw.data.ok_or_else(|| "unexpected layout".to_owned())?;
    let mut metrics = data.metrics.unwrap_or_default();
    for m in &mut metrics {
        if let Some(points) = &mut m.data {
            points.truncate(MAX_POINTS);
        }
    }
    let mut workouts = data.workouts.unwrap_or_default();
    workouts.truncate(MAX_POINTS);
    Ok(Export { metrics, workouts })
}

// ---------------------------------------------------------------------------
// Values: ranges and units

fn within(v: Option<f64>, lo: f64, hi: f64) -> Option<f64> {
    v.filter(|x| x.is_finite() && (lo..=hi).contains(x))
}

fn energy_kcal(qty: Option<f64>, units: Option<&str>) -> Option<f64> {
    let q = qty.filter(|q| q.is_finite())?;
    let kcal = match units?.trim().to_ascii_lowercase().as_str() {
        "kcal" => q,
        "kj" => q / KJ_PER_KCAL,
        _ => return None,
    };
    within(Some(kcal), 0.0, 20_000.0)
}

fn weight_kg(qty: Option<f64>, units: Option<&str>) -> Option<f64> {
    let q = qty.filter(|q| q.is_finite())?;
    let kg = match units?.trim().to_ascii_lowercase().as_str() {
        "kg" => q,
        "lb" => q * KG_PER_LB,
        _ => return None,
    };
    within(Some(kg), 20.0, 400.0)
}

fn distance_km(qty: Option<f64>, units: Option<&str>) -> Option<f64> {
    let q = qty.filter(|q| q.is_finite())?;
    let km = match units?.trim().to_ascii_lowercase().as_str() {
        "km" => q,
        "mi" => q * KM_PER_MILE,
        _ => return None,
    };
    within(Some(km), 0.0, 5000.0)
}

/// `{qty, units}` object inside a workout.
fn qty_units(v: Option<&Value>) -> (Option<f64>, Option<String>) {
    let Some(Value::Object(o)) = v else {
        return (None, None);
    };
    (
        o.get("qty").and_then(Value::as_f64),
        o.get("units").and_then(Value::as_str).map(str::to_owned),
    )
}

/// The local date: the first ten characters of the timestamp, if they are a
/// real calendar date (so no 2026-02-30).
fn local_date(ts: &str) -> Option<&str> {
    ts.get(..10)
        .filter(|d| is_iso_date(d))
        .filter(|d| crate::fitness::shift_days(d, 0) == *d)
}

fn clean_name(s: &str) -> String {
    let cleaned: String = s.chars().filter(|c| !c.is_control()).collect();
    cleaned.trim().chars().take(MAX_NAME_CHARS).collect()
}

// ---------------------------------------------------------------------------
// Aggregation

#[derive(Debug, Default, Clone, PartialEq)]
pub struct SleepAcc {
    pub total: f64,
    pub core: f64,
    pub deep: f64,
    pub rem: f64,
    pub awake: f64,
}

/// Everything imported for one local date.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DayAcc {
    pub steps: Option<f64>,
    pub energy: Option<f64>,
    hr_sum: f64,
    hr_n: u32,
    hrv_sum: f64,
    hrv_n: u32,
    /// (timestamp, kg): the latest reading of the day wins.
    weight: Option<(String, f64)>,
    pub sleep: Option<SleepAcc>,
}

impl DayAcc {
    pub fn resting_hr(&self) -> Option<f64> {
        (self.hr_n > 0).then(|| self.hr_sum / f64::from(self.hr_n))
    }
    pub fn hrv(&self) -> Option<f64> {
        (self.hrv_n > 0).then(|| self.hrv_sum / f64::from(self.hrv_n))
    }
    pub fn weight(&self) -> Option<f64> {
        self.weight.as_ref().map(|(_, kg)| *kg)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HealthWorkout {
    pub date: String,
    pub start: String,
    pub name: String,
    pub duration_min: Option<i64>,
    pub active_energy: Option<i64>,
    pub distance_km: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadFile {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Default, Clone)]
pub struct Imported {
    pub file_count: usize,
    pub skipped_files: usize,
    pub newest_file_ms: Option<i64>,
    pub bad_files: Vec<BadFile>,
    pub days: BTreeMap<String, DayAcc>,
    pub workouts: Vec<HealthWorkout>,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Steps,
    Energy,
    RestingHr,
    Hrv,
    Weight,
    Sleep,
    Workout,
}

fn kind_of(name: &str) -> Option<Kind> {
    Some(match name {
        "step_count" => Kind::Steps,
        "active_energy" => Kind::Energy,
        "resting_heart_rate" => Kind::RestingHr,
        "heart_rate_variability" => Kind::Hrv,
        "weight_body_mass" => Kind::Weight,
        "sleep_analysis" => Kind::Sleep,
        _ => return None,
    })
}

fn add(slot: &mut Option<f64>, v: f64) {
    *slot = Some(slot.unwrap_or(0.0) + v);
}

impl Imported {
    /// Adds one file's points. Files must arrive newest first: a point or
    /// workout already seen (same metric and timestamp, or same workout)
    /// belongs to a newer file and is not counted again.
    fn ingest(&mut self, export: &Export, seen: &mut HashSet<(Kind, String)>) {
        for metric in &export.metrics {
            let Some(kind) = metric.name.as_deref().and_then(kind_of) else {
                continue;
            };
            let units = metric.units.as_deref();
            for p in metric.data.iter().flatten() {
                let Some(ts) = p.date.as_deref() else {
                    continue;
                };
                let Some(date) = local_date(ts) else { continue };
                // Only a usable value claims the timestamp, so an out-of-range
                // value in a newer file does not hide a valid older one.
                let key = (kind, ts.to_owned());
                if seen.contains(&key) {
                    continue;
                }
                if self.add_point(kind, date, ts, p, units) {
                    seen.insert(key);
                }
            }
        }
        for w in &export.workouts {
            self.add_workout(w, seen);
        }
    }

    /// Adds one point to its day; returns whether its value was usable.
    fn add_point(
        &mut self,
        kind: Kind,
        date: &str,
        ts: &str,
        p: &RawPoint,
        units: Option<&str>,
    ) -> bool {
        let day = self.days.entry(date.to_owned()).or_default();
        let mut used = false;
        match kind {
            Kind::Steps => {
                if let Some(v) = within(p.qty, 0.0, 200_000.0) {
                    add(&mut day.steps, v);
                    used = true;
                }
            }
            Kind::Energy => {
                if let Some(v) = energy_kcal(p.qty, units) {
                    add(&mut day.energy, v);
                    used = true;
                }
            }
            Kind::RestingHr => {
                if let Some(v) = within(p.qty, 20.0, 250.0) {
                    day.hr_sum += v;
                    day.hr_n += 1;
                    used = true;
                }
            }
            Kind::Hrv => {
                if let Some(v) = within(p.qty, 1.0, 500.0) {
                    day.hrv_sum += v;
                    day.hrv_n += 1;
                    used = true;
                }
            }
            Kind::Weight => {
                if let Some(v) = weight_kg(p.qty, units) {
                    let newer = day.weight.as_ref().is_none_or(|(t, _)| ts >= t.as_str());
                    if newer {
                        day.weight = Some((ts.to_owned(), v));
                    }
                    used = true;
                }
            }
            Kind::Sleep => {
                let stage = |v: Option<f64>| within(v, 0.0, 24.0).unwrap_or(0.0);
                let (core, deep, rem, awake) =
                    (stage(p.core), stage(p.deep), stage(p.rem), stage(p.awake));
                let mut total = stage(p.total_sleep);
                if total <= 0.0 {
                    total = stage(p.asleep);
                }
                if total <= 0.0 {
                    total = core + deep + rem;
                }
                if total > 0.0 || awake > 0.0 {
                    let s = day.sleep.get_or_insert_with(SleepAcc::default);
                    s.total += total;
                    s.core += core;
                    s.deep += deep;
                    s.rem += rem;
                    s.awake += awake;
                    used = true;
                }
            }
            Kind::Workout => {}
        }
        // A date that only collected rejected values is not a day with data.
        let empty = *day == DayAcc::default();
        if empty {
            self.days.remove(date);
        }
        used
    }

    fn add_workout(&mut self, w: &RawWorkout, seen: &mut HashSet<(Kind, String)>) {
        let Some(start) = w.start.as_deref() else {
            return;
        };
        let Some(date) = local_date(start) else {
            return;
        };
        let name = w
            .name
            .as_deref()
            .map(clean_name)
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "Workout".to_owned());
        let key = match w.id.as_deref().filter(|i| !i.is_empty()) {
            Some(id) => format!("id:{id}"),
            None => format!("{name}|{start}"),
        };
        if !seen.insert((Kind::Workout, key)) {
            return;
        }
        let (e_qty, e_units) =
            qty_units(w.active_energy_burned.as_ref().or(w.active_energy.as_ref()));
        let (d_qty, d_units) = qty_units(w.distance.as_ref());
        self.workouts.push(HealthWorkout {
            date: date.to_owned(),
            start: start.to_owned(),
            name,
            duration_min: within(w.duration, 0.0, 86_400.0).map(|s| round_i64(s / 60.0)),
            active_energy: energy_kcal(e_qty, e_units.as_deref()).map(round_i64),
            distance_km: distance_km(d_qty, d_units.as_deref()).map(|k| round_to(k, 2)),
        });
    }
}

#[allow(clippy::cast_possible_truncation)]
fn round_i64(v: f64) -> i64 {
    v.round() as i64
}

fn round_to(v: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (v * f).round() / f
}

/// Reads every listed file (newest first) into one `Imported`. A bad file
/// is recorded and skipped, never fatal. `canonical_folder` must be canonical.
pub fn import(canonical_folder: &Path, listing: &Listing) -> Imported {
    let mut out = Imported {
        file_count: listing.files.len(),
        skipped_files: listing.skipped,
        newest_file_ms: listing.files.iter().map(|f| f.mtime_ms).max(),
        ..Imported::default()
    };
    let mut seen = HashSet::new();
    for file in &listing.files {
        let name = file.rel.rsplit('/').next().unwrap_or(&file.rel);
        let result = read_file(canonical_folder, file).and_then(|bytes| parse_export(&bytes));
        match result {
            Ok(export) => out.ingest(&export, &mut seen),
            Err(reason) => out.bad_files.push(BadFile {
                name: clean_name(name),
                reason,
            }),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Cache

type Signature = (PathBuf, Vec<(String, u64, i64)>, usize);

/// The last import, kept until the folder's file list changes.
#[derive(Default)]
pub struct HealthState(Mutex<Option<(Signature, Arc<Imported>)>>);

impl HealthState {
    pub fn clear(&self) {
        *self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }

    /// Imports `folder`, or returns the cached import if nothing changed.
    pub fn load(&self, folder: &Path) -> io::Result<Arc<Imported>> {
        let canonical = fs::canonicalize(folder)?;
        let listing = list(&canonical)?;
        let signature: Signature = (
            canonical.clone(),
            listing
                .files
                .iter()
                .map(|f| (f.rel.clone(), f.len, f.mtime_ms))
                .collect(),
            listing.skipped,
        );
        let mut guard = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((sig, imported)) = guard.as_ref()
            && *sig == signature
        {
            return Ok(Arc::clone(imported));
        }
        let imported = Arc::new(import(&canonical, &listing));
        *guard = Some((signature, Arc::clone(&imported)));
        Ok(imported)
    }
}

// ---------------------------------------------------------------------------
// The view

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    /// Newest export file's modification time, ms since the Unix epoch.
    pub last_export: Option<i64>,
    /// Newest day that has any value.
    pub latest_data: Option<String>,
    pub stale: bool,
    /// The 90 days ending today, oldest first.
    pub days: Vec<HealthDay>,
    pub rings_day: Option<RingsDay>,
    pub goals: Goals,
    /// Newest first.
    pub workouts: Vec<WorkoutRow>,
    pub bad_files: Vec<BadFile>,
    pub bad_file_count: usize,
    pub skipped_files: usize,
    pub file_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDay {
    pub date: String,
    pub steps: Option<i64>,
    pub active_energy: Option<i64>,
    pub resting_hr: Option<f64>,
    pub hrv: Option<f64>,
    pub sleep: Option<SleepView>,
    pub weight: Option<f64>,
    /// "health" or "vault".
    pub weight_source: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SleepView {
    pub total: f64,
    pub core: f64,
    pub deep: f64,
    pub rem: f64,
    pub awake: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RingsDay {
    pub is_today: bool,
    #[serde(flatten)]
    pub day: HealthDay,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goals {
    pub steps: i64,
    pub active_energy: i64,
    pub sleep_hours: f64,
}

impl Default for Goals {
    fn default() -> Self {
        Self {
            steps: DEFAULT_STEPS_GOAL,
            active_energy: DEFAULT_ENERGY_GOAL,
            sleep_hours: DEFAULT_SLEEP_GOAL,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkoutRow {
    /// "health" or "vault".
    pub source: &'static str,
    pub date: String,
    pub name: String,
    pub duration_min: Option<i64>,
    pub active_energy: Option<i64>,
    pub distance_km: Option<f64>,
    pub path: Option<String>,
}

fn day_view(date: &str, acc: Option<&DayAcc>, vault_weight: Option<f64>) -> HealthDay {
    let health_weight = acc.and_then(DayAcc::weight);
    let (weight, weight_source) = match (health_weight, vault_weight) {
        (Some(w), _) => (Some(round_to(w, 1)), Some("health")),
        (None, Some(w)) => (Some(w), Some("vault")),
        (None, None) => (None, None),
    };
    HealthDay {
        date: date.to_owned(),
        steps: acc.and_then(|a| a.steps).map(round_i64),
        active_energy: acc.and_then(|a| a.energy).map(round_i64),
        resting_hr: acc.and_then(DayAcc::resting_hr).map(|v| round_to(v, 1)),
        hrv: acc.and_then(DayAcc::hrv).map(|v| round_to(v, 1)),
        sleep: acc.and_then(|a| a.sleep.as_ref()).map(|s| SleepView {
            total: round_to(s.total, 2),
            core: round_to(s.core, 2),
            deep: round_to(s.deep, 2),
            rem: round_to(s.rem, 2),
            awake: round_to(s.awake, 2),
        }),
        weight,
        weight_source,
    }
}

fn has_ring_data(acc: &DayAcc) -> bool {
    acc.steps.is_some() || acc.energy.is_some() || acc.sleep.is_some()
}

fn goals(index: &Index) -> rusqlite::Result<Goals> {
    let row = index
        .conn()
        .query_row(
            "SELECT steps_goal, active_energy_goal, sleep_goal
             FROM plan ORDER BY path = ?1 DESC, path LIMIT 1",
            params![PLAN_PATH],
            |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                ))
            },
        )
        .optional()?;
    let d = Goals::default();
    Ok(row.map_or(d, |(steps, energy, sleep)| Goals {
        steps: steps.unwrap_or(d.steps),
        active_energy: energy.unwrap_or(d.active_energy),
        sleep_hours: sleep.unwrap_or(d.sleep_hours),
    }))
}

/// Builds the Health view. `today` is the owner's local date (YYYY-MM-DD),
/// `now_ms` the current time; `index` is the vault, if one is connected.
pub fn health(
    imported: &Imported,
    index: Option<&Index>,
    today: &str,
    now_ms: i64,
) -> rusqlite::Result<Health> {
    let mut vault_weight: HashMap<String, f64> = HashMap::new();
    let mut goals_out = Goals::default();
    let mut rows: Vec<WorkoutRow> = Vec::new();
    if let Some(index) = index {
        for d in crate::fitness::days(index, today)? {
            if let Some(w) = d.weight {
                vault_weight.entry(d.date).or_insert(w);
            }
        }
        goals_out = goals(index)?;
        for w in vault_workouts(index)? {
            let Some(date) = w.date else { continue };
            rows.push(WorkoutRow {
                source: "vault",
                date,
                name: w.day.unwrap_or_else(|| "Workout".to_owned()),
                duration_min: w.duration_min,
                active_energy: None,
                distance_km: None,
                path: Some(w.path),
            });
        }
    }

    let start = shift_days(today, 1 - WINDOW_DAYS);
    let days: Vec<HealthDay> = (0..WINDOW_DAYS)
        .map(|i| {
            let date = shift_days(&start, i);
            day_view(
                &date,
                imported.days.get(&date),
                vault_weight.get(&date).copied(),
            )
        })
        .collect();

    let rings_day = if imported.days.get(today).is_some_and(has_ring_data) {
        Some(RingsDay {
            is_today: true,
            day: day_view(today, imported.days.get(today), None),
        })
    } else {
        imported
            .days
            .iter()
            .rev()
            .find(|(date, a)| date.as_str() <= today && has_ring_data(a))
            .map(|(date, acc)| RingsDay {
                is_today: false,
                day: day_view(date, Some(acc), None),
            })
    };

    // Health workouts first so a stable sort keeps them ahead of vault ones on ties.
    let mut merged: Vec<(String, WorkoutRow)> = imported
        .workouts
        .iter()
        .map(|w| {
            (
                w.start.clone(),
                WorkoutRow {
                    source: "health",
                    date: w.date.clone(),
                    name: w.name.clone(),
                    duration_min: w.duration_min,
                    active_energy: w.active_energy,
                    distance_km: w.distance_km,
                    path: None,
                },
            )
        })
        .collect();
    merged.extend(rows.into_iter().map(|r| (r.date.clone(), r)));
    merged.sort_by(|(ka, a), (kb, b)| {
        b.date
            .cmp(&a.date)
            .then_with(|| kb.cmp(ka))
            .then(a.source.cmp(b.source))
    });
    merged.truncate(MAX_WORKOUTS);

    let last_export = imported.newest_file_ms;
    Ok(Health {
        last_export,
        latest_data: imported.days.keys().next_back().cloned(),
        stale: last_export.is_none_or(|t| now_ms.saturating_sub(t) > STALE_AFTER_MS),
        days,
        rings_day,
        goals: goals_out,
        workouts: merged.into_iter().map(|(_, r)| r).collect(),
        bad_file_count: imported.bad_files.len(),
        bad_files: imported
            .bad_files
            .iter()
            .take(MAX_BAD_LISTED)
            .cloned()
            .collect(),
        skipped_files: imported.skipped_files,
        file_count: imported.file_count,
    })
}

#[cfg(test)]
mod tests;
