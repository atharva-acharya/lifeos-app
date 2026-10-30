//! Data for the Health page (requirements §3.7): a read-only importer for
//! Health Auto Export JSON files (threat model T16, T17), plus the view the
//! UI draws. Nothing here ever writes to the export folder.

use std::collections::hash_map::RandomState;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::fs;
use std::hash::{BuildHasher, Hash};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use rusqlite::{OptionalExtension, params};
use serde::de::{self, DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::value::RawValue;

use crate::fitness::{shift_days, workouts as vault_workouts};
use crate::index::Index;
use crate::vault::note::is_iso_date;

/// Largest export file the app will read (threat model T16).
pub const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// Most files read per import; the newest are kept.
pub const MAX_FILES: usize = 2000;
/// Deepest sub-folder searched below the chosen folder.
pub const MAX_DEPTH: usize = 3;
/// Most points kept per kind of metric in one file (all entries of the kind
/// together).
pub const MAX_POINTS: usize = 200_000;
/// Most points kept over all files; older files beyond it are not read.
pub const MAX_TOTAL_POINTS: usize = 2_000_000;
/// Most workouts kept per file and over all files.
pub const MAX_FILE_WORKOUTS: usize = 10_000;
pub const MAX_TOTAL_WORKOUTS: usize = 10_000;
/// Most entries read from a file's `metrics` list.
pub const MAX_METRICS: usize = 64;
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

//
// The caps are applied while the JSON is read (threat model T16): a list
// keeps at most its cap and every further item is skipped without being
// built, so a file of millions of tiny items never costs more memory than
// the items that are kept. Points without a real calendar date can never be
// used, so they are not kept and do not count against a cap.

/// A JSON value reduced to what the importer can use; arrays and objects
/// are walked and dropped.
enum Leaf {
    Num(f64),
    Text(String),
    Other,
}

impl Leaf {
    fn num(self) -> Option<f64> {
        match self {
            Leaf::Num(n) => Some(n),
            _ => None,
        }
    }
    fn text(self) -> Option<String> {
        match self {
            Leaf::Text(s) => Some(s),
            _ => None,
        }
    }
}

fn skip_seq<'de, A: SeqAccess<'de>>(mut seq: A) -> Result<(), A::Error> {
    while seq.next_element::<IgnoredAny>()?.is_some() {}
    Ok(())
}

fn skip_map<'de, A: MapAccess<'de>>(mut map: A) -> Result<(), A::Error> {
    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
    Ok(())
}

#[allow(clippy::cast_precision_loss)]
fn int_to_f64(v: i64) -> f64 {
    v as f64
}

#[allow(clippy::cast_precision_loss)]
fn uint_to_f64(v: u64) -> f64 {
    v as f64
}

struct LeafVisitor;

impl<'de> Visitor<'de> for LeafVisitor {
    type Value = Leaf;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }
    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Leaf, E> {
        Ok(Leaf::Other)
    }
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Leaf, E> {
        Ok(Leaf::Num(int_to_f64(v)))
    }
    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Leaf, E> {
        Ok(Leaf::Num(uint_to_f64(v)))
    }
    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Leaf, E> {
        Ok(Leaf::Num(v))
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Leaf, E> {
        Ok(Leaf::Text(v.to_owned()))
    }
    fn visit_unit<E: de::Error>(self) -> Result<Leaf, E> {
        Ok(Leaf::Other)
    }
    fn visit_none<E: de::Error>(self) -> Result<Leaf, E> {
        Ok(Leaf::Other)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Leaf, A::Error> {
        skip_seq(seq).map(|()| Leaf::Other)
    }
    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Leaf, A::Error> {
        skip_map(map).map(|()| Leaf::Other)
    }
}

impl<'de> Deserialize<'de> for Leaf {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(LeafVisitor)
    }
}

/// `{qty, units}` inside a workout.
#[derive(Debug, Default, Clone)]
struct QtyUnits {
    qty: Option<f64>,
    units: Option<String>,
}

/// A workout field that is either a plain value or a `{qty, units}` object.
enum Lenient {
    Other,
    Object(QtyUnits),
}

impl Lenient {
    fn into_object(self) -> Option<QtyUnits> {
        match self {
            Lenient::Object(q) => Some(q),
            Lenient::Other => None,
        }
    }
}

struct LenientVisitor;

impl<'de> Visitor<'de> for LenientVisitor {
    type Value = Lenient;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("any JSON value")
    }
    fn visit_bool<E: de::Error>(self, _: bool) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_i64<E: de::Error>(self, _: i64) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_u64<E: de::Error>(self, _: u64) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_f64<E: de::Error>(self, _: f64) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_str<E: de::Error>(self, _: &str) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_none<E: de::Error>(self) -> Result<Lenient, E> {
        Ok(Lenient::Other)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Lenient, A::Error> {
        skip_seq(seq).map(|()| Lenient::Other)
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Lenient, A::Error> {
        let mut out = QtyUnits::default();
        while let Some(key) = map.next_key::<Key>()? {
            match key {
                Key::Qty => out.qty = map.next_value::<Leaf>()?.num(),
                Key::Units => out.units = map.next_value::<Leaf>()?.text(),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(Lenient::Object(out))
    }
}

impl<'de> Deserialize<'de> for Lenient {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(LenientVisitor)
    }
}

/// Every object key the importer looks at; anything else is `Other`.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Key {
    Data,
    Metrics,
    Workouts,
    Name,
    Units,
    Id,
    Start,
    Date,
    Qty,
    TotalSleep,
    Asleep,
    Core,
    Deep,
    Rem,
    Awake,
    Duration,
    ActiveEnergyBurned,
    ActiveEnergy,
    Distance,
    Other,
}

struct KeyVisitor;

impl Visitor<'_> for KeyVisitor {
    type Value = Key;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a key")
    }
    fn visit_str<E: de::Error>(self, v: &str) -> Result<Key, E> {
        Ok(match v {
            "data" => Key::Data,
            "metrics" => Key::Metrics,
            "workouts" => Key::Workouts,
            "name" => Key::Name,
            "units" => Key::Units,
            "id" => Key::Id,
            "start" => Key::Start,
            "date" => Key::Date,
            "qty" => Key::Qty,
            "totalSleep" => Key::TotalSleep,
            "asleep" => Key::Asleep,
            "core" => Key::Core,
            "deep" => Key::Deep,
            "rem" => Key::Rem,
            "awake" => Key::Awake,
            "duration" => Key::Duration,
            "activeEnergyBurned" => Key::ActiveEnergyBurned,
            "activeEnergy" => Key::ActiveEnergy,
            "distance" => Key::Distance,
            _ => Key::Other,
        })
    }
}

impl<'de> Deserialize<'de> for Key {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_identifier(KeyVisitor)
    }
}

/// Rejects a repeated key (other than unknown ones), as the earlier derived
/// parser did.
#[derive(Default)]
struct SeenKeys(u32);

impl SeenKeys {
    fn mark<E: de::Error>(&mut self, key: Key) -> Result<(), E> {
        if key == Key::Other {
            return Ok(());
        }
        let bit = 1u32 << (key as u8);
        if self.0 & bit != 0 {
            return Err(E::custom("duplicate key"));
        }
        self.0 |= bit;
        Ok(())
    }
}

/// One measurement of a metric. Only points with a real calendar date exist.
#[derive(Debug, Default)]
struct Point {
    date: String,
    qty: Option<f64>,
    total_sleep: Option<f64>,
    asleep: Option<f64>,
    core: Option<f64>,
    deep: Option<f64>,
    rem: Option<f64>,
    awake: Option<f64>,
}

struct PointSeed;

impl<'de> DeserializeSeed<'de> for PointSeed {
    type Value = Option<Point>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for PointSeed {
    type Value = Option<Point>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a data point")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut p = Point::default();
        let mut date = None;
        let mut seen = SeenKeys::default();
        while let Some(key) = map.next_key::<Key>()? {
            seen.mark(key)?;
            match key {
                Key::Date => date = map.next_value::<Leaf>()?.text(),
                Key::Qty => p.qty = map.next_value::<Leaf>()?.num(),
                Key::TotalSleep => p.total_sleep = map.next_value::<Leaf>()?.num(),
                Key::Asleep => p.asleep = map.next_value::<Leaf>()?.num(),
                Key::Core => p.core = map.next_value::<Leaf>()?.num(),
                Key::Deep => p.deep = map.next_value::<Leaf>()?.num(),
                Key::Rem => p.rem = map.next_value::<Leaf>()?.num(),
                Key::Awake => p.awake = map.next_value::<Leaf>()?.num(),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(date.filter(|d| local_date(d).is_some()).map(|date| {
            p.date = date;
            p
        }))
    }
}

/// The points of one metric entry, added to `out` until `*count` reaches the
/// cap; the count is shared by every entry of the same kind in the file.
struct PointsSeed<'a> {
    out: &'a mut Vec<Point>,
    count: &'a mut usize,
}

impl<'de> DeserializeSeed<'de> for PointsSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for PointsSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of points")
    }
    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_none<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while *self.count < MAX_POINTS {
            match seq.next_element_seed(PointSeed)? {
                None => return Ok(()),
                Some(None) => {}
                Some(Some(p)) => {
                    self.out.push(p);
                    *self.count += 1;
                }
            }
        }
        skip_seq(seq)
    }
}

#[derive(Debug)]
struct Metric {
    kind: Kind,
    units: Option<String>,
    points: Vec<Point>,
}

/// A workout with a real start date; the name is already cleaned.
#[derive(Debug)]
struct Workout {
    id: Option<String>,
    name: Option<String>,
    start: String,
    duration: Option<f64>,
    energy: Option<QtyUnits>,
    distance: Option<QtyUnits>,
}

struct WorkoutSeed;

impl<'de> DeserializeSeed<'de> for WorkoutSeed {
    type Value = Option<Workout>;
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<Self::Value, D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for WorkoutSeed {
    type Value = Option<Workout>;
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a workout")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let (mut id, mut name, mut start, mut duration) = (None, None, None, None);
        let (mut burned, mut active, mut distance) = (None, None, None);
        let mut seen = SeenKeys::default();
        while let Some(key) = map.next_key::<Key>()? {
            seen.mark(key)?;
            match key {
                Key::Id => id = map.next_value::<Leaf>()?.text(),
                Key::Name => name = map.next_value::<Leaf>()?.text().map(|n| clean_name(&n)),
                Key::Start => start = map.next_value::<Leaf>()?.text(),
                Key::Duration => duration = map.next_value::<Leaf>()?.num(),
                Key::ActiveEnergyBurned => burned = map.next_value::<Lenient>()?.into_object(),
                Key::ActiveEnergy => active = map.next_value::<Lenient>()?.into_object(),
                Key::Distance => distance = map.next_value::<Lenient>()?.into_object(),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(start
            .filter(|s| local_date(s).is_some())
            .map(|start| Workout {
                id,
                name,
                start,
                duration,
                energy: burned.or(active),
                distance,
            }))
    }
}

struct WorkoutsSeed<'a>(&'a mut Vec<Workout>);

impl<'de> DeserializeSeed<'de> for WorkoutsSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for WorkoutsSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of workouts")
    }
    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_none<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while self.0.len() < MAX_FILE_WORKOUTS {
            match seq.next_element_seed(WorkoutSeed)? {
                None => return Ok(()),
                Some(None) => {}
                Some(Some(w)) => self.0.push(w),
            }
        }
        skip_seq(seq)
    }
}

/// Points kept so far per kind, for the per-file cap.
type Counts = [usize; KIND_COUNT];

struct MetricSeed<'a> {
    metrics: &'a mut Vec<Metric>,
    counts: &'a mut Counts,
}

impl<'de> DeserializeSeed<'de> for MetricSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for MetricSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a metric")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let (mut name, mut units): (Option<String>, Option<String>) = (None, None);
        // The data may come before the name, so it is held unparsed and only
        // read for a known name. Unknown metrics are never built.
        let mut data: Option<&'de RawValue> = None;
        let mut seen = SeenKeys::default();
        while let Some(key) = map.next_key::<Key>()? {
            seen.mark(key)?;
            match key {
                Key::Name => name = map.next_value::<Leaf>()?.text(),
                Key::Units => units = map.next_value::<Leaf>()?.text(),
                Key::Data => data = Some(map.next_value::<&'de RawValue>()?),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        let (Some(kind), Some(raw)) = (name.as_deref().and_then(kind_of), data) else {
            return Ok(());
        };
        let mut points = Vec::new();
        let mut de = serde_json::Deserializer::from_str(raw.get());
        PointsSeed {
            out: &mut points,
            count: &mut self.counts[kind as usize],
        }
        .deserialize(&mut de)
        .map_err(de::Error::custom)?;
        self.metrics.push(Metric {
            kind,
            units,
            points,
        });
        Ok(())
    }
}

struct MetricsSeed<'a> {
    metrics: &'a mut Vec<Metric>,
    counts: &'a mut Counts,
}

impl<'de> DeserializeSeed<'de> for MetricsSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for MetricsSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of metrics")
    }
    fn visit_unit<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_none<E: de::Error>(self) -> Result<(), E> {
        Ok(())
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        for _ in 0..MAX_METRICS {
            let seed = MetricSeed {
                metrics: &mut *self.metrics,
                counts: &mut *self.counts,
            };
            if seq.next_element_seed(seed)?.is_none() {
                return Ok(());
            }
        }
        skip_seq(seq)
    }
}

/// A parsed export with every cap applied.
#[derive(Debug, Default)]
pub struct Export {
    metrics: Vec<Metric>,
    workouts: Vec<Workout>,
}

impl Export {
    /// Number of points kept for the metric called `name` (all copies).
    pub fn point_count(&self, name: &str) -> usize {
        let kind = kind_of(name);
        self.metrics
            .iter()
            .filter(|m| Some(m.kind) == kind)
            .map(|m| m.points.len())
            .sum()
    }

    /// Number of workouts kept.
    pub fn workout_count(&self) -> usize {
        self.workouts.len()
    }

    fn total_points(&self) -> usize {
        self.metrics.iter().map(|m| m.points.len()).sum()
    }
}

struct DataSeed<'a>(&'a mut Export);

impl<'de> DeserializeSeed<'de> for DataSeed<'_> {
    type Value = ();
    fn deserialize<D: Deserializer<'de>>(self, d: D) -> Result<(), D::Error> {
        d.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for DataSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("the data object")
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        // An empty list is tolerated; anything in it is not the layout.
        match seq.next_element::<IgnoredAny>()? {
            None => Ok(()),
            Some(_) => Err(de::Error::custom("unexpected list")),
        }
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let mut counts: Counts = [0; KIND_COUNT];
        let mut seen = SeenKeys::default();
        while let Some(key) = map.next_key::<Key>()? {
            seen.mark(key)?;
            match key {
                Key::Metrics => map.next_value_seed(MetricsSeed {
                    metrics: &mut self.0.metrics,
                    counts: &mut counts,
                })?,
                Key::Workouts => map.next_value_seed(WorkoutsSeed(&mut self.0.workouts))?,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }
}

struct RootSeed<'a>(&'a mut Export);

impl<'de> Visitor<'de> for RootSeed<'_> {
    type Value = ();
    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an export object")
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        let mut found = false;
        while let Some(key) = map.next_key::<Key>()? {
            if key == Key::Data {
                if found {
                    return Err(de::Error::custom("duplicate key"));
                }
                found = true;
                map.next_value_seed(DataSeed(&mut *self.0))?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        if found {
            Ok(())
        } else {
            Err(de::Error::custom("no data"))
        }
    }
}

/// Parses one export file. Never panics; the error is a short fixed reason.
pub fn parse_export(bytes: &[u8]) -> Result<Export, String> {
    // Some editors and tools prefix UTF-8 files with a byte order mark.
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let mut export = Export::default();
    let mut de = serde_json::Deserializer::from_slice(bytes);
    (&mut de)
        .deserialize_map(RootSeed(&mut export))
        .and_then(|()| de.end())
        .map_err(|e| {
            match e.classify() {
                serde_json::error::Category::Data => "unexpected layout",
                serde_json::error::Category::Io => "could not be read",
                _ => "not valid JSON",
            }
            .to_owned()
        })?;
    Ok(export)
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

/// The local date: the first ten characters of the timestamp, if they are a
/// real calendar date (so no 2026-02-30).
fn local_date(ts: &str) -> Option<&str> {
    ts.get(..10)
        .filter(|d| is_iso_date(d))
        .filter(|d| crate::fitness::shift_days(d, 0) == *d)
}

fn clean_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_control() && !is_format_char(*c))
        .collect();
    cleaned.trim().chars().take(MAX_NAME_CHARS).collect()
}

/// Unicode format characters (category Cf): zero-width and bidirectional
/// controls that can reorder or hide text.
fn is_format_char(c: char) -> bool {
    matches!(c,
        '\u{00AD}'
        | '\u{0600}'..='\u{0605}'
        | '\u{061C}'
        | '\u{06DD}'
        | '\u{070F}'
        | '\u{0890}'..='\u{0891}'
        | '\u{08E2}'
        | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}'
        | '\u{FFF9}'..='\u{FFFB}'
        | '\u{110BD}'
        | '\u{110CD}'
        | '\u{13430}'..='\u{1343F}'
        | '\u{1BCA0}'..='\u{1BCA3}'
        | '\u{1D173}'..='\u{1D17A}'
        | '\u{E0001}'
        | '\u{E0020}'..='\u{E007F}')
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Steps,
    Energy,
    RestingHr,
    Hrv,
    Weight,
    Sleep,
    Workout,
}

const KIND_COUNT: usize = 7;

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
    fn ingest(&mut self, export: &Export, seen: &mut Seen) {
        for metric in &export.metrics {
            let kind = metric.kind;
            let units = metric.units.as_deref();
            for p in &metric.points {
                let ts = p.date.as_str();
                let Some(date) = local_date(ts) else { continue };
                // Only a usable value claims the timestamp, so an out-of-range
                // value in a newer file does not hide a valid older one.
                let key = seen.key(&(kind, ts));
                if seen.0.contains(&key) {
                    continue;
                }
                if self.add_point(kind, date, ts, p, units) {
                    seen.0.insert(key);
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
        p: &Point,
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

    fn add_workout(&mut self, w: &Workout, seen: &mut Seen) {
        if self.workouts.len() >= MAX_TOTAL_WORKOUTS {
            return;
        }
        let start = w.start.as_str();
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
            Some(id) => seen.key(&(Kind::Workout, 0u8, id, "")),
            None => seen.key(&(Kind::Workout, 1u8, name.as_str(), start)),
        };
        if !seen.0.insert(key) {
            return;
        }
        let energy = w.energy.clone().unwrap_or_default();
        let distance = w.distance.clone().unwrap_or_default();
        self.workouts.push(HealthWorkout {
            date: date.to_owned(),
            start: start.to_owned(),
            name,
            duration_min: within(w.duration, 0.0, 86_400.0).map(|s| round_i64(s / 60.0)),
            active_energy: energy_kcal(energy.qty, energy.units.as_deref()).map(round_i64),
            distance_km: distance_km(distance.qty, distance.units.as_deref())
                .map(|k| round_to(k, 2)),
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

/// Timestamps and workout keys already counted, as 64-bit hashes (keyed per
/// import) so the set stays small.
struct Seen(HashSet<u64>, RandomState);

impl Seen {
    fn new() -> Self {
        Self(HashSet::new(), RandomState::new())
    }
    fn key<T: Hash + ?Sized>(&self, parts: &T) -> u64 {
        self.1.hash_one(parts)
    }
}

/// One file's parse result, kept while the file's size and time are unchanged.
#[derive(Clone)]
struct CachedFile {
    len: u64,
    mtime_ms: i64,
    parsed: Result<Arc<Export>, String>,
}

type FileCache = HashMap<String, CachedFile>;

/// Reads every listed file (newest first) into one `Imported`. A bad file
/// is recorded and skipped, never fatal. `canonical_folder` must be canonical.
pub fn import(canonical_folder: &Path, listing: &Listing) -> Imported {
    import_cached(canonical_folder, listing, &FileCache::new()).0
}

/// As `import`, but a file whose size and time match `cache` is not read
/// again. Returns the files that can be reused next time.
fn import_cached(
    canonical_folder: &Path,
    listing: &Listing,
    cache: &FileCache,
) -> (Imported, FileCache) {
    let mut out = Imported {
        file_count: listing.files.len(),
        skipped_files: listing.skipped,
        ..Imported::default()
    };
    let mut next = FileCache::new();
    let mut seen = Seen::new();
    let mut points = 0usize;
    for (i, file) in listing.files.iter().enumerate() {
        if points >= MAX_TOTAL_POINTS {
            // Enough data from the newer files; the rest are not even opened.
            out.skipped_files += listing.files.len() - i;
            break;
        }
        let name = file.rel.rsplit('/').next().unwrap_or(&file.rel);
        let hit = cache
            .get(&file.rel)
            .filter(|c| c.len == file.len && c.mtime_ms == file.mtime_ms);
        let parsed = if let Some(c) = hit {
            c.parsed.clone()
        } else {
            match read_file(canonical_folder, file) {
                Ok(bytes) => parse_export(&bytes).map(Arc::new),
                // Not cached: a file that could not be read may be readable later.
                Err(reason) => {
                    out.bad_files.push(BadFile {
                        name: clean_name(name),
                        reason,
                    });
                    continue;
                }
            }
        };
        next.insert(
            file.rel.clone(),
            CachedFile {
                len: file.len,
                mtime_ms: file.mtime_ms,
                parsed: parsed.clone(),
            },
        );
        match parsed {
            Ok(export) => {
                out.newest_file_ms = out.newest_file_ms.max(Some(file.mtime_ms));
                points += export.total_points();
                out.ingest(&export, &mut seen);
            }
            Err(reason) => out.bad_files.push(BadFile {
                name: clean_name(name),
                reason,
            }),
        }
    }
    (out, next)
}

// ---------------------------------------------------------------------------
// Cache

type Signature = (PathBuf, Vec<(String, u64, i64)>, usize);

#[derive(Default)]
struct Inner {
    /// Bumped by `clear`; an import started before it is not stored.
    generation: u64,
    folder: Option<PathBuf>,
    /// The last merged import, valid while the folder's file list is the same.
    result: Option<(Signature, Arc<Imported>)>,
    files: FileCache,
}

/// The last import and the parsed files behind it.
#[derive(Default)]
pub struct HealthState(Mutex<Inner>);

impl HealthState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Forgets everything, and makes any import already running discard its
    /// result instead of storing it.
    pub fn clear(&self) {
        let mut guard = self.lock();
        let generation = guard.generation.wrapping_add(1);
        *guard = Inner {
            generation,
            ..Inner::default()
        };
    }

    /// Imports `folder`, or returns the cached import if nothing changed.
    /// The folder is checked again on every call, so a root replaced by a
    /// link or junction is refused. Listing, reading and parsing happen
    /// without the lock held; only new or changed files are read.
    pub fn load(&self, folder: &Path) -> io::Result<Arc<Imported>> {
        let checked = crate::settings::validate_health_folder(folder)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;
        let canonical = fs::canonicalize(checked)?;
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
        let (generation, cache) = {
            let guard = self.lock();
            if let Some((sig, imported)) = guard.result.as_ref()
                && *sig == signature
            {
                return Ok(Arc::clone(imported));
            }
            let cache = if guard.folder.as_ref() == Some(&canonical) {
                guard.files.clone()
            } else {
                FileCache::new()
            };
            (guard.generation, cache)
        };
        let (imported, files) = import_cached(&canonical, &listing, &cache);
        let imported = Arc::new(imported);
        let mut guard = self.lock();
        if guard.generation == generation {
            guard.folder = Some(canonical);
            guard.result = Some((signature, Arc::clone(&imported)));
            guard.files = files;
        }
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

    // A file dated in the future (clock skew) counts as just written.
    let last_export = imported.newest_file_ms.map(|t| t.min(now_ms));
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
