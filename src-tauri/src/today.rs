//! Data for the Today page (requirements §3.1), read from the index.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::index::Index;

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub date: String,
    /// A `type: daily` note exists for `date`; without one the numbers below are blank, not zero.
    pub has_daily_note: bool,
    pub weight: Option<f64>,
    /// Change since the previous weigh-in.
    pub weight_change: Option<f64>,
    pub applications: Option<i64>,
    pub gym: Option<String>,
    pub habits: Habits,
    pub follow_ups: Vec<FollowUp>,
    pub project: Option<Resume>,
    /// Notes the app could not read, so the owner can fix them.
    pub parse_errors: i64,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Habits {
    pub weigh_in: bool,
    pub steps: Option<i64>,
    pub protein_g: Option<i64>,
    pub meals_tracked: bool,
    pub mobility: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowUp {
    pub path: String,
    pub company: Option<String>,
    pub role: Option<String>,
    pub stage: Option<String>,
    pub next_action: Option<String>,
    pub next_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resume {
    pub path: String,
    pub project: Option<String>,
    pub done: i64,
    pub total: i64,
    pub next_step: Option<String>,
    pub last_log: Option<String>,
}

/// Builds the Today view for `date` (YYYY-MM-DD, the owner's local date).
pub fn today(index: &Index, date: &str) -> rusqlite::Result<Today> {
    let conn = index.conn();
    let mut out = Today {
        date: date.to_owned(),
        ..Today::default()
    };

    let day = conn
        .query_row(
            "SELECT weight, applications, gym, steps, protein_g, meals_tracked, mobility
             FROM daily WHERE date = ?1 ORDER BY path LIMIT 1",
            params![date],
            |r| {
                Ok((
                    r.get::<_, Option<f64>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<i64>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<bool>>(5)?,
                    r.get::<_, Option<bool>>(6)?,
                ))
            },
        )
        .optional()?;
    if let Some((weight, applications, gym, steps, protein_g, meals, mobility)) = day {
        out.has_daily_note = true;
        out.weight = weight;
        out.applications = applications;
        out.gym = gym;
        out.habits = Habits {
            weigh_in: weight.is_some(),
            steps,
            protein_g,
            meals_tracked: meals.unwrap_or(false),
            mobility: mobility.unwrap_or(false),
        };
    }

    if let Some(weight) = out.weight {
        let previous: Option<f64> = conn
            .query_row(
                "SELECT weight FROM daily WHERE date < ?1 AND weight IS NOT NULL
                 ORDER BY date DESC LIMIT 1",
                params![date],
                |r| r.get(0),
            )
            .optional()?;
        out.weight_change = previous.map(|p| ((weight - p) * 10.0).round() / 10.0);
    }

    if out.gym.is_none() {
        out.gym = conn
            .query_row(
                "SELECT day FROM workout WHERE date = ?1 ORDER BY path LIMIT 1",
                params![date],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
    }

    out.follow_ups = follow_ups(conn, date)?;
    out.project = resume(conn)?;
    out.parse_errors = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE error IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    Ok(out)
}

fn follow_ups(conn: &Connection, date: &str) -> rusqlite::Result<Vec<FollowUp>> {
    conn.prepare(
        "SELECT path, company, role, stage, next_action, next_date FROM company
         WHERE next_date IS NOT NULL AND next_date <= ?1
           AND (stage IS NULL OR stage NOT IN ('rejected', 'offer'))
         ORDER BY next_date, company",
    )?
    .query_map(params![date], |r| {
        Ok(FollowUp {
            path: r.get(0)?,
            company: r.get(1)?,
            role: r.get(2)?,
            stage: r.get(3)?,
            next_action: r.get(4)?,
            next_date: r.get(5)?,
        })
    })?
    .collect()
}

/// The most recently updated active project and where to pick it up.
fn resume(conn: &Connection) -> rusqlite::Result<Option<Resume>> {
    let project = conn
        .query_row(
            "SELECT path, project, next_step, last_log FROM project
             WHERE status IS NULL OR lower(status) IN ('active', 'in progress')
             ORDER BY updated DESC, path LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((path, name, next_step, last_log)) = project else {
        return Ok(None);
    };
    let (done, total, first_open): (i64, i64, Option<String>) = conn.query_row(
        "SELECT COALESCE(SUM(done), 0), COUNT(*),
                (SELECT text FROM project_steps WHERE path = ?1 AND done = 0
                 ORDER BY position LIMIT 1)
         FROM project_steps WHERE path = ?1",
        params![path],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    Ok(Some(Resume {
        path,
        project: name,
        done,
        total,
        // The checklist is the truth; the front matter field is a fallback.
        next_step: first_open.or(next_step),
        last_log,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fixture_index() -> Index {
        let mut index = Index::open_in_memory().expect("open");
        index
            .sync(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault"))
            .expect("sync");
        index
    }

    #[test]
    fn builds_today_from_the_fixture_vault() {
        let t = today(&fixture_index(), "2026-01-13").expect("today");
        assert!(t.has_daily_note);
        assert_eq!(t.weight, Some(83.9));
        assert_eq!(t.weight_change, Some(-0.2));
        assert_eq!(t.applications, Some(4));
        assert_eq!(t.gym.as_deref(), Some("Pull A"));
        assert_eq!(
            t.habits,
            Habits {
                weigh_in: true,
                steps: Some(10450),
                protein_g: Some(165),
                meals_tracked: true,
                mobility: false,
            }
        );
        assert_eq!(t.parse_errors, 1);
    }

    #[test]
    fn follow_ups_due_on_or_before_today() {
        let index = fixture_index();
        assert!(
            today(&index, "2026-01-13")
                .expect("today")
                .follow_ups
                .is_empty()
        );
        let due = today(&index, "2026-01-14").expect("today").follow_ups;
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].company.as_deref(), Some("Example Security Ltd"));
    }

    #[test]
    fn resume_points_at_first_unchecked_step() {
        let r = today(&fixture_index(), "2026-01-13")
            .expect("today")
            .project
            .expect("project");
        assert_eq!(r.project.as_deref(), Some("home-lab"));
        assert_eq!((r.done, r.total), (1, 3));
        assert_eq!(r.next_step.as_deref(), Some("Set up log forwarding"));
        assert_eq!(
            r.last_log.as_deref(),
            Some("2026-01-13: Hypervisor running.")
        );
    }

    #[test]
    fn empty_day_has_no_values() {
        let t = today(&fixture_index(), "2030-01-01").expect("today");
        assert!(!t.has_daily_note);
        assert_eq!(t.weight, None);
        assert_eq!(t.weight_change, None);
        assert_eq!(t.habits, Habits::default());
    }
}
