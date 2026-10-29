//! Data for the Jobs page from the vault (requirements §3.2): the company
//! pipeline and the outreach log. Sheet applications are added in task 3.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::index::Index;
use crate::vault::note::{OutreachEntry, STAGES};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyCard {
    pub path: String,
    pub company: Option<String>,
    pub role: Option<String>,
    pub stage: String,
    pub applied: Option<String>,
    pub contact: Option<String>,
    pub next_action: Option<String>,
    pub next_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub stage: String,
    pub companies: Vec<CompanyCard>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Jobs {
    /// One column per agreed stage, in pipeline order; companies with no
    /// stage are listed under "applied".
    pub pipeline: Vec<Stage>,
    pub outreach: Vec<OutreachEntry>,
}

pub fn jobs(index: &Index) -> rusqlite::Result<Jobs> {
    let conn = index.conn();
    let cards = companies(conn)?;
    let pipeline = STAGES
        .iter()
        .map(|stage| Stage {
            stage: (*stage).to_owned(),
            companies: cards
                .iter()
                .filter(|c| c.stage == *stage)
                .cloned()
                .collect(),
        })
        .collect();
    Ok(Jobs {
        pipeline,
        outreach: outreach(conn)?,
    })
}

fn companies(conn: &Connection) -> rusqlite::Result<Vec<CompanyCard>> {
    conn.prepare(
        "SELECT path, company, role, COALESCE(stage, 'applied'), applied, contact,
                next_action, next_date
         FROM company ORDER BY next_date IS NULL, next_date, company",
    )?
    .query_map(params![], |r| {
        Ok(CompanyCard {
            path: r.get(0)?,
            company: r.get(1)?,
            role: r.get(2)?,
            stage: r.get(3)?,
            applied: r.get(4)?,
            contact: r.get(5)?,
            next_action: r.get(6)?,
            next_date: r.get(7)?,
        })
    })?
    .collect()
}

fn outreach(conn: &Connection) -> rusqlite::Result<Vec<OutreachEntry>> {
    conn.prepare(
        "SELECT sent, name, profile, company_role, contact_type, status, last_update
         FROM outreach ORDER BY sent DESC, position",
    )?
    .query_map(params![], |r| {
        Ok(OutreachEntry {
            sent: r.get(0)?,
            name: r.get(1)?,
            profile: r.get(2)?,
            company_role: r.get(3)?,
            contact_type: r.get(4)?,
            status: r.get(5)?,
            last_update: r.get(6)?,
        })
    })?
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn fixture() -> Jobs {
        let mut index = Index::open_in_memory().expect("open");
        index
            .sync(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/vault"))
            .expect("sync");
        jobs(&index).expect("jobs")
    }

    #[test]
    fn pipeline_has_every_stage_in_order() {
        let stages: Vec<String> = fixture().pipeline.into_iter().map(|s| s.stage).collect();
        assert_eq!(stages, STAGES);
    }

    #[test]
    fn companies_land_in_their_stage() {
        let jobs = fixture();
        let screen = jobs
            .pipeline
            .iter()
            .find(|s| s.stage == "screen")
            .expect("screen");
        assert_eq!(screen.companies.len(), 1);
        assert_eq!(
            screen.companies[0].company.as_deref(),
            Some("Example Security Ltd")
        );
    }

    #[test]
    fn outreach_is_newest_first() {
        let rows = fixture().outreach;
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].name.as_deref(), Some("Riley Test"));
        assert_eq!(rows[2].status.as_deref(), Some("replied"));
    }
}
