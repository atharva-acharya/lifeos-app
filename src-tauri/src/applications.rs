//! Job applications from the owner's Sheet (requirements §3.2): column
//! mapping by header name and an offline cache (ADR 0006).

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const CACHE_FILE: &str = "applications.json";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub applied: Option<String>,
    pub company: Option<String>,
    pub role: Option<String>,
    pub source: Option<String>,
    pub inbox: Option<String>,
    pub status: Option<String>,
    pub last_update: Option<String>,
    pub days_since: Option<String>,
    pub follow_up: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cache {
    /// Milliseconds since the Unix epoch of the last successful fetch.
    pub fetched_at: i64,
    pub rows: Vec<Application>,
    /// Agreed columns the Sheet did not have, so the owner can fix them.
    pub missing_columns: Vec<String>,
}

const COLUMNS: &[&str] = &[
    "applied",
    "company",
    "role",
    "source",
    "inbox",
    "status",
    "last update",
    "days since",
    "follow up?",
    "email",
    "notes",
    "message id",
];

/// Maps Sheet rows (first row = headers) to applications by header name.
/// Extra columns are ignored; empty rows are skipped.
pub fn from_rows(rows: &[Vec<String>]) -> (Vec<Application>, Vec<String>) {
    let Some((header, data)) = rows.split_first() else {
        return (
            Vec::new(),
            COLUMNS.iter().map(|c| (*c).to_owned()).collect(),
        );
    };
    let header: Vec<String> = header.iter().map(|h| h.trim().to_lowercase()).collect();
    let pos: Vec<Option<usize>> = COLUMNS
        .iter()
        .map(|c| header.iter().position(|h| h == c))
        .collect();
    let missing = COLUMNS
        .iter()
        .zip(&pos)
        .filter(|(_, p)| p.is_none())
        .map(|(c, _)| (*c).to_owned())
        .collect();
    let apps = data
        .iter()
        .map(|row| {
            let get = |i: usize| {
                pos[i]
                    .and_then(|p| row.get(p))
                    .map(|v| v.trim().to_owned())
                    .filter(|v| !v.is_empty())
            };
            Application {
                applied: get(0),
                company: get(1),
                role: get(2),
                source: get(3),
                inbox: get(4),
                status: get(5),
                last_update: get(6),
                days_since: get(7),
                follow_up: get(8),
                email: get(9),
                notes: get(10),
                message_id: get(11),
            }
        })
        .filter(|a| a != &Application::default())
        .collect();
    (apps, missing)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

pub fn load(dir: &Path) -> Option<Cache> {
    let text = fs::read_to_string(dir.join(CACHE_FILE)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn save(dir: &Path, cache: &Cache) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{CACHE_FILE}.tmp"));
    fs::write(&tmp, serde_json::to_vec(cache)?)?;
    fs::rename(tmp, dir.join(CACHE_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(cells: &[&str]) -> Vec<String> {
        cells.iter().map(|c| (*c).to_owned()).collect()
    }

    #[test]
    fn maps_columns_by_header_in_any_order() {
        let rows = vec![
            row(&["Company", "Applied", "Status", "Extra", "Source", "Role"]),
            row(&[
                "Example Ltd",
                "2026-01-05",
                "Applied",
                "x",
                "Easy Apply",
                "SOC Analyst",
            ]),
            row(&["", "", "", "", "", ""]),
            row(&["Sample Bank", "2026-01-06"]),
        ];
        let (apps, missing) = from_rows(&rows);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].company.as_deref(), Some("Example Ltd"));
        assert_eq!(apps[0].source.as_deref(), Some("Easy Apply"));
        assert_eq!(apps[1].status, None);
        assert!(missing.contains(&"message id".to_owned()));
        assert!(!missing.contains(&"company".to_owned()));
    }

    #[test]
    fn empty_sheet_reports_all_columns_missing() {
        let (apps, missing) = from_rows(&[]);
        assert!(apps.is_empty());
        assert_eq!(missing.len(), COLUMNS.len());
    }

    #[test]
    fn cache_round_trips_atomically() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(load(dir.path()), None);
        let cache = Cache {
            fetched_at: 42,
            rows: vec![Application {
                company: Some("Example Ltd".into()),
                ..Application::default()
            }],
            missing_columns: vec![],
        };
        save(dir.path(), &cache).expect("save");
        assert_eq!(load(dir.path()), Some(cache));
        assert!(!dir.path().join("applications.json.tmp").exists());
    }

    #[test]
    fn corrupt_cache_is_ignored() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(dir.path().join(CACHE_FILE), "{ nope").expect("write");
        assert_eq!(load(dir.path()), None);
    }
}
