//! Disposable SQLite index of the vault (ADR 0002). The vault files are the
//! source of truth; this file can be deleted at any time and is rebuilt.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use rusqlite::{Connection, Transaction, params};
use serde::Serialize;

use crate::vault::{self, FileInfo, note::Note};

/// Bump when the schema changes; a mismatch drops and rebuilds the index.
pub const SCHEMA_VERSION: i32 = 2;

const SCHEMA: &str = "
CREATE TABLE notes (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    error TEXT
);
CREATE TABLE daily (
    path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
    date TEXT, weight REAL, steps INTEGER, protein_g INTEGER, meals_tracked INTEGER,
    gym TEXT, mobility INTEGER, applications INTEGER, study_minutes INTEGER, mood INTEGER
);
CREATE INDEX daily_date ON daily(date);
CREATE TABLE workout (
    path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
    date TEXT, day TEXT, week INTEGER, deload INTEGER, duration_min INTEGER, exercises TEXT
);
CREATE INDEX workout_date ON workout(date);
CREATE TABLE company (
    path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
    company TEXT, role TEXT, stage TEXT, applied TEXT, contact TEXT,
    next_action TEXT, next_date TEXT
);
CREATE INDEX company_next_date ON company(next_date);
CREATE TABLE weekly (
    path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
    week TEXT, arc_week INTEGER, avg_weight REAL, weight_change REAL, target_change REAL,
    sessions INTEGER, protein_days INTEGER, avg_steps INTEGER, applications INTEGER,
    replies INTEGER, study_hours REAL
);
CREATE TABLE project (
    path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
    project TEXT, status TEXT, step INTEGER, steps_total INTEGER, next_step TEXT, updated TEXT,
    last_log TEXT
);
CREATE TABLE outreach (
    path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    sent TEXT, name TEXT, profile TEXT, company_role TEXT, contact_type TEXT,
    status TEXT, last_update TEXT,
    PRIMARY KEY (path, position)
);
CREATE TABLE project_steps (
    path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    done INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (path, position)
);
";

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("index database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("could not read the vault: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SyncStats {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub unchanged: usize,
    pub errors: usize,
}

pub struct Index {
    conn: Connection,
}

impl Index {
    /// Opens the index at `path`, rebuilding it if the schema is outdated or
    /// the file is unreadable.
    pub fn open(path: &Path) -> Result<Self, IndexError> {
        match Self::try_open(path) {
            Ok(index) => Ok(index),
            Err(_) => {
                // Corrupt or foreign file: it holds nothing that is not in the vault.
                let _ = fs::remove_file(path);
                Self::try_open(path)
            }
        }
    }

    pub fn open_in_memory() -> Result<Self, IndexError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn try_open(path: &Path) -> Result<Self, IndexError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        Self::init(Connection::open(path)?)
    }

    fn init(conn: Connection) -> Result<Self, IndexError> {
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version != SCHEMA_VERSION {
            let tables: Vec<String> = conn
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?
                .query_map([], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            conn.pragma_update(None, "foreign_keys", false)?;
            for table in tables {
                conn.execute(&format!("DROP TABLE IF EXISTS \"{table}\""), [])?;
            }
            conn.pragma_update(None, "foreign_keys", true)?;
            conn.execute_batch(SCHEMA)?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Self { conn })
    }

    /// Brings the index in line with the vault. Only notes whose size or
    /// modification time changed are re-read.
    pub fn sync(&mut self, root: &Path) -> Result<SyncStats, IndexError> {
        let files = vault::list(root)?;
        let known: HashMap<String, (i64, i64)> = self
            .conn
            .prepare("SELECT path, mtime_ms, size FROM notes")?
            .query_map([], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
            .collect::<Result<_, _>>()?;

        let mut stats = SyncStats::default();
        let tx = self.conn.transaction()?;
        let mut seen = std::collections::HashSet::with_capacity(files.len());
        for file in &files {
            seen.insert(file.rel.as_str());
            let size = i64::try_from(file.len).unwrap_or(i64::MAX);
            match known.get(&file.rel) {
                Some(&(mtime, s)) if mtime == file.mtime_ms && s == size => {
                    stats.unchanged += 1;
                    continue;
                }
                Some(_) => stats.updated += 1,
                None => stats.added += 1,
            }
            if store(&tx, file, size)? {
                stats.errors += 1;
            }
        }
        for path in known.keys().filter(|p| !seen.contains(p.as_str())) {
            tx.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
            stats.removed += 1;
        }
        tx.commit()?;
        Ok(stats)
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }
}

/// Replaces one note's rows. Returns true if the note failed to parse.
fn store(tx: &Transaction<'_>, file: &FileInfo, size: i64) -> Result<bool, IndexError> {
    let entry = vault::read(file);
    tx.execute("DELETE FROM notes WHERE path = ?1", params![file.rel])?;
    let kind = match &entry.note {
        Some(Note::Daily(_)) => "daily",
        Some(Note::Workout(_)) => "workout",
        Some(Note::Company(_)) => "company",
        Some(Note::Weekly(_)) => "weekly",
        Some(Note::Project(_)) => "project",
        Some(Note::Outreach(_)) => "outreach",
        Some(Note::Other) => "other",
        None => "error",
    };
    tx.execute(
        "INSERT INTO notes (path, kind, mtime_ms, size, error) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![file.rel, kind, file.mtime_ms, size, entry.error],
    )?;
    let p = &file.rel;
    match entry.note {
        Some(Note::Daily(d)) => {
            tx.execute(
                "INSERT INTO daily VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    p,
                    d.date,
                    d.weight,
                    d.steps,
                    d.protein_g,
                    d.meals_tracked,
                    d.gym,
                    d.mobility,
                    d.applications,
                    d.study_minutes,
                    d.mood
                ],
            )?;
        }
        Some(Note::Workout(w)) => {
            let exercises = serde_json::to_string(&w.exercises).unwrap_or_default();
            tx.execute(
                "INSERT INTO workout VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    p,
                    w.date,
                    w.day,
                    w.week,
                    w.deload,
                    w.duration_min,
                    exercises
                ],
            )?;
        }
        Some(Note::Company(c)) => {
            tx.execute(
                "INSERT INTO company VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    p,
                    c.company,
                    c.role,
                    c.stage,
                    c.applied,
                    c.contact,
                    c.next_action,
                    c.next_date
                ],
            )?;
        }
        Some(Note::Weekly(w)) => {
            tx.execute(
                "INSERT INTO weekly VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    p,
                    w.week,
                    w.arc_week,
                    w.avg_weight,
                    w.weight_change,
                    w.target_change,
                    w.sessions,
                    w.protein_days,
                    w.avg_steps,
                    w.applications,
                    w.replies,
                    w.study_hours
                ],
            )?;
        }
        Some(Note::Project(pr)) => {
            tx.execute(
                "INSERT INTO project VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    p,
                    pr.project,
                    pr.status,
                    pr.step,
                    pr.steps_total,
                    pr.next_step,
                    pr.updated,
                    pr.last_log
                ],
            )?;
            for (i, (done, text)) in pr.steps.iter().enumerate() {
                tx.execute(
                    "INSERT INTO project_steps VALUES (?1, ?2, ?3, ?4)",
                    params![p, i64::try_from(i).unwrap_or(i64::MAX), done, text],
                )?;
            }
        }
        Some(Note::Outreach(rows)) => {
            for (i, r) in rows.iter().enumerate() {
                tx.execute(
                    "INSERT INTO outreach VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        p,
                        i64::try_from(i).unwrap_or(i64::MAX),
                        r.sent,
                        r.name,
                        r.profile,
                        r.company_role,
                        r.contact_type,
                        r.status,
                        r.last_update
                    ],
                )?;
            }
        }
        Some(Note::Other) | None => {}
    }
    Ok(entry.error.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault")
    }

    fn count(index: &Index, table: &str) -> i64 {
        index
            .conn()
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn indexes_the_fixture_vault() {
        let mut index = Index::open_in_memory().expect("open");
        let stats = index.sync(&fixture()).expect("sync");
        assert_eq!(stats.added, 9);
        assert_eq!(stats.errors, 1);
        assert_eq!(count(&index, "daily"), 2);
        assert_eq!(count(&index, "workout"), 1);
        assert_eq!(count(&index, "company"), 1);
        assert_eq!(count(&index, "weekly"), 1);
        assert_eq!(count(&index, "project"), 1);
        assert_eq!(count(&index, "project_steps"), 3);
    }

    #[test]
    fn second_sync_reads_nothing() {
        let mut index = Index::open_in_memory().expect("open");
        index.sync(&fixture()).expect("sync");
        let again = index.sync(&fixture()).expect("sync");
        assert_eq!(again.unchanged, 9);
        assert_eq!(again.added + again.updated + again.removed, 0);
    }

    #[test]
    fn picks_up_edits_and_deletions() {
        let vault = tempfile::tempdir().expect("temp dir");
        let note = vault.path().join("a.md");
        fs::write(&note, "---\ntype: daily\ndate: 2026-01-01\nsteps: 1\n---\n").expect("write");
        let mut index = Index::open_in_memory().expect("open");
        index.sync(vault.path()).expect("sync");

        fs::write(
            &note,
            "---\ntype: daily\ndate: 2026-01-01\nsteps: 12345\n---\n",
        )
        .expect("write");
        let stats = index.sync(vault.path()).expect("sync");
        assert_eq!(stats.updated, 1);
        let steps: i64 = index
            .conn()
            .query_row("SELECT steps FROM daily", [], |r| r.get(0))
            .expect("steps");
        assert_eq!(steps, 12345);

        fs::remove_file(&note).expect("remove");
        let stats = index.sync(vault.path()).expect("sync");
        assert_eq!(stats.removed, 1);
        assert_eq!(count(&index, "daily"), 0);
    }

    #[test]
    fn corrupt_index_file_is_rebuilt() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = dir.path().join("index.db");
        fs::write(&db, b"this is not sqlite").expect("write");
        let mut index = Index::open(&db).expect("rebuilt");
        assert_eq!(index.sync(&fixture()).expect("sync").added, 9);
    }

    #[test]
    fn outdated_schema_is_rebuilt() {
        let dir = tempfile::tempdir().expect("temp dir");
        let db = dir.path().join("index.db");
        {
            let conn = Connection::open(&db).expect("open");
            conn.execute_batch("CREATE TABLE notes (old TEXT); PRAGMA user_version = 0;")
                .expect("old schema");
        }
        let mut index = Index::open(&db).expect("open");
        assert_eq!(index.sync(&fixture()).expect("sync").added, 9);
    }

    #[test]
    fn note_values_are_stored_as_data_not_sql() {
        let vault = tempfile::tempdir().expect("temp dir");
        fs::write(
            vault.path().join("x.md"),
            "---\ntype: company\ncompany: \"x'); DROP TABLE notes; --\"\n---\n",
        )
        .expect("write");
        let mut index = Index::open_in_memory().expect("open");
        index.sync(vault.path()).expect("sync");
        let name: String = index
            .conn()
            .query_row("SELECT company FROM company", [], |r| r.get(0))
            .expect("company");
        assert_eq!(name, "x'); DROP TABLE notes; --");
        assert_eq!(count(&index, "notes"), 1);
    }

    #[test]
    fn full_build_of_1000_notes_is_fast() {
        let vault = tempfile::tempdir().expect("temp dir");
        fs::create_dir(vault.path().join("Daily")).expect("mkdir");
        for i in 0..1000 {
            let (m, d) = (i / 28 % 12 + 1, i % 28 + 1);
            fs::write(
                vault.path().join(format!("Daily/{i:04}.md")),
                format!(
                    "---\ntype: daily\ndate: 2026-{m:02}-{d:02}\nweight: 80.5\nsteps: {i}\nmood: 3\n---\n# Day {i}\n"
                ),
            )
            .expect("write");
        }
        // A real vault's files were written long ago; read them once so the
        // antivirus first-open scan of freshly written files is not timed.
        for file in vault::list(vault.path()).expect("list") {
            fs::read(&file.abs).expect("warm read");
        }
        let mut index = Index::open_in_memory().expect("open");
        let start = Instant::now();
        let stats = index.sync(vault.path()).expect("sync");
        let took = start.elapsed();
        assert_eq!(stats.added, 1000);
        // Budget is 1 s in release builds (ADR 0002); debug builds get headroom.
        let budget = if cfg!(debug_assertions) {
            Duration::from_secs(5)
        } else {
            Duration::from_secs(1)
        };
        assert!(took < budget, "full build took {took:?}");
        eprintln!("full build of 1000 notes: {took:?}");
    }
}
