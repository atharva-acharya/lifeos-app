//! Data for the Projects page (requirements §3.4), read from the index.

use std::path::Path;

use rusqlite::params;
use serde::Serialize;

use crate::index::Index;
use crate::vault::note::LogEntry;

/// At most this many projects are sent to the UI.
const MAX_PROJECTS: i64 = 200;

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projects {
    pub projects: Vec<ProjectView>,
    /// Notes under `Projects/` the app could not read.
    pub parse_errors: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StepView {
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub path: String,
    pub name: String,
    pub status: Option<String>,
    pub active: bool,
    pub updated: Option<String>,
    pub steps: Vec<StepView>,
    pub done: i64,
    pub total: i64,
    /// Index of the first unchecked step.
    pub current: Option<usize>,
    pub next_step: Option<String>,
    pub last_log: Option<LogEntry>,
    /// Newest first.
    pub log: Vec<LogEntry>,
}

struct Row {
    path: String,
    project: Option<String>,
    status: Option<String>,
    step: Option<i64>,
    steps_total: Option<i64>,
    next_step: Option<String>,
    updated: Option<String>,
}

/// Same rule as Today's resume: no status, `active` or `in progress`.
fn is_active(status: Option<&str>) -> bool {
    status.is_none_or(|s| {
        let s = s.trim();
        s.eq_ignore_ascii_case("active") || s.eq_ignore_ascii_case("in progress")
    })
}

pub fn projects(index: &Index) -> rusqlite::Result<Projects> {
    let conn = index.conn();
    let rows: Vec<Row> = conn
        .prepare(
            "SELECT path, project, status, step, steps_total, next_step, updated FROM project
             ORDER BY (status IS NULL OR lower(trim(status)) IN ('active', 'in progress')) DESC,
                      updated IS NULL, updated DESC, path
             LIMIT ?1",
        )?
        .query_map(params![MAX_PROJECTS], |r| {
            Ok(Row {
                path: r.get(0)?,
                project: r.get(1)?,
                status: r.get(2)?,
                step: r.get(3)?,
                steps_total: r.get(4)?,
                next_step: r.get(5)?,
                updated: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut steps_query =
        conn.prepare("SELECT text, done FROM project_steps WHERE path = ?1 ORDER BY position")?;
    let mut log_query =
        conn.prepare("SELECT date, text FROM project_log WHERE path = ?1 ORDER BY position DESC")?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let steps: Vec<StepView> = steps_query
            .query_map(params![row.path], |r| {
                Ok(StepView {
                    text: r.get(0)?,
                    done: r.get::<_, i64>(1)? != 0,
                })
            })?
            .collect::<Result<_, _>>()?;
        let log: Vec<LogEntry> = log_query
            .query_map(params![row.path], |r| {
                Ok(LogEntry {
                    date: r.get(0)?,
                    text: r.get(1)?,
                })
            })?
            .collect::<Result<_, _>>()?;

        let (done, total, current) = if steps.is_empty() {
            // No checklist: the front matter is all there is.
            let total = row.steps_total.unwrap_or(0).max(0);
            (row.step.unwrap_or(0).clamp(0, total), total, None)
        } else {
            let done = steps.iter().filter(|s| s.done).count();
            (
                i64::try_from(done).unwrap_or(i64::MAX),
                i64::try_from(steps.len()).unwrap_or(i64::MAX),
                steps.iter().position(|s| !s.done),
            )
        };
        let all_done = total > 0 && done >= total;
        let next_step = match current {
            Some(i) => Some(steps[i].text.clone()),
            None if all_done => None,
            None => row.next_step.clone(),
        };
        let name = row.project.clone().unwrap_or_else(|| {
            Path::new(&row.path)
                .file_stem()
                .map_or_else(|| row.path.clone(), |s| s.to_string_lossy().into_owned())
        });
        out.push(ProjectView {
            active: is_active(row.status.as_deref()),
            path: row.path,
            name,
            status: row.status,
            updated: row.updated,
            steps,
            done,
            total,
            current,
            next_step,
            last_log: log.first().cloned(),
            log,
        });
    }

    Ok(Projects {
        projects: out,
        parse_errors: conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE kind = 'error' AND path LIKE ?1",
            params!["Projects/%"],
            |r| r.get(0),
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write as _;
    use std::fs;

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

    fn find<'a>(p: &'a Projects, name: &str) -> &'a ProjectView {
        p.projects.iter().find(|v| v.name == name).expect("project")
    }

    #[test]
    fn fixture_projects_are_ordered_active_first_then_newest() {
        let p = projects(&fixture_index()).expect("projects");
        let names: Vec<&str> = p.projects.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(
            names,
            ["home-lab", "notes-only", "garden-planner", "reading-list"]
        );
        assert_eq!(p.parse_errors, 0);
    }

    #[test]
    fn active_project_with_a_checklist() {
        let p = projects(&fixture_index()).expect("projects");
        let v = find(&p, "home-lab");
        assert!(v.active);
        assert_eq!((v.done, v.total, v.current), (1, 3, Some(1)));
        assert_eq!(v.next_step.as_deref(), Some("Set up log forwarding"));
        assert!(v.steps[0].done && !v.steps[1].done);
        assert_eq!(
            v.last_log,
            Some(LogEntry {
                date: Some("2026-01-13".to_owned()),
                text: "Hypervisor running.".to_owned()
            })
        );
    }

    #[test]
    fn paused_project_keeps_its_place_and_undated_log() {
        let p = projects(&fixture_index()).expect("projects");
        let v = find(&p, "garden-planner");
        assert!(!v.active);
        assert_eq!((v.done, v.total, v.current), (2, 4, Some(2)));
        assert_eq!(v.next_step.as_deref(), Some("Order seeds"));
        // Newest first by position: the undated line was written last.
        assert_eq!(v.log.len(), 2);
        assert_eq!(v.log[0].date, None);
        assert_eq!(v.log[0].text, "Waiting on spring.");
        assert_eq!(v.log[1].date.as_deref(), Some("2026-02-18"));
        assert_eq!(v.last_log.as_ref(), v.log.first());
    }

    #[test]
    fn done_project_has_no_current_or_next_step() {
        let p = projects(&fixture_index()).expect("projects");
        let v = find(&p, "reading-list");
        assert!(!v.active);
        assert_eq!((v.done, v.total, v.current), (2, 2, None));
        assert_eq!(v.next_step, None);
    }

    #[test]
    fn without_a_checklist_front_matter_is_the_fallback() {
        let p = projects(&fixture_index()).expect("projects");
        let v = find(&p, "notes-only");
        assert!(v.steps.is_empty());
        assert_eq!((v.done, v.total, v.current), (1, 4, None));
        assert_eq!(v.next_step.as_deref(), Some("Draft the outline"));
        assert_eq!(v.last_log, None);
        assert!(v.log.is_empty());
    }

    #[test]
    fn fallback_is_clamped_and_hides_next_step_when_complete() {
        let index = vault_with(&[
            (
                "Projects/over.md",
                "---\ntype: project\nstep: 9\nsteps_total: 4\nnext_step: Stale\n---\n",
            ),
            (
                "Projects/negative.md",
                "---\ntype: project\nstep: -3\nsteps_total: 4\n---\n",
            ),
            ("Projects/bare.md", "---\ntype: project\n---\n"),
        ]);
        let p = projects(&index).expect("projects");
        let over = find(&p, "over");
        assert_eq!((over.done, over.total), (4, 4));
        assert_eq!(over.next_step, None);
        let neg = find(&p, "negative");
        assert_eq!((neg.done, neg.total), (0, 4));
        let bare = find(&p, "bare");
        assert_eq!((bare.done, bare.total, bare.current), (0, 0, None));
        assert!(bare.active, "no status counts as active");
    }

    #[test]
    fn status_is_case_and_space_insensitive() {
        let index = vault_with(&[
            (
                "Projects/a.md",
                "---\ntype: project\nstatus: \" In Progress \"\n---\n",
            ),
            (
                "Projects/b.md",
                "---\ntype: project\nstatus: blocked\n---\n",
            ),
        ]);
        let p = projects(&index).expect("projects");
        assert!(find(&p, "a").active);
        assert!(!find(&p, "b").active);
    }

    #[test]
    fn unreadable_project_notes_are_counted() {
        let index = vault_with(&[
            (
                "Projects/bad.md",
                "---\ntype: project\nsteps_total: lots\n---\n",
            ),
            ("Jobs/bad.md", "---\ntype: company\nstage: ghosted\n---\n"),
        ]);
        let p = projects(&index).expect("projects");
        assert_eq!(p.parse_errors, 1);
        assert!(p.projects.is_empty());
    }

    #[test]
    fn empty_vault_gives_no_projects() {
        let p = projects(&vault_with(&[])).expect("projects");
        assert!(p.projects.is_empty());
        assert_eq!(p.parse_errors, 0);
    }

    #[test]
    fn at_most_200_projects() {
        let files: Vec<(String, String)> = (0..205)
            .map(|i| {
                (
                    format!("Projects/p{i:03}.md"),
                    "---\ntype: project\n---\n".to_owned(),
                )
            })
            .collect();
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let p = projects(&vault_with(&refs)).expect("projects");
        assert_eq!(p.projects.len(), 200);
    }

    #[test]
    fn keeps_only_the_newest_thousand_log_entries() {
        let mut text = String::from("---\ntype: project\n---\n## Log\n");
        for i in 0..1005 {
            writeln!(text, "- entry {i}").expect("write");
        }
        let index = vault_with(&[("Projects/long.md", &text)]);
        let p = projects(&index).expect("projects");
        let v = find(&p, "long");
        assert_eq!(v.log.len(), 1000);
        assert_eq!(v.log[0].text, "entry 1004");
        assert_eq!(v.log[999].text, "entry 5");
    }

    #[test]
    fn reads_a_note_in_the_tracker_format() {
        let note = "---\ntype: project\nproject: lifeos-app\nstatus: active\nstep: 4\nsteps_total: 7\nnext_step: \"Phase 3: build the projects page\"\nupdated: 2026-10-30\n---\n# Life OS app\nFree text about the project.\n## Steps\n- [x] Scaffold the app\n- [x] Read the vault\n- [x] Today page\n- [x] Jobs page\n- [ ] Fitness page\n- [ ] Projects page\n- [ ] Writes\n## Log\n- 2026-10-28: Jobs page shipped.\n- 2026-10-29: Fitness page started.\n";
        let index = vault_with(&[("Projects/lifeos-app.md", note)]);
        let p = projects(&index).expect("projects");
        let v = find(&p, "lifeos-app");
        assert_eq!((v.done, v.total, v.current), (4, 7, Some(4)));
        // The UI shows "Step 5 of 7".
        assert_eq!(v.current.map(|c| c + 1), Some(5));
        // The checklist wins over the quoted front matter value.
        assert_eq!(v.next_step.as_deref(), Some("Fitness page"));
        assert_eq!(v.updated.as_deref(), Some("2026-10-30"));
        assert_eq!(v.log.len(), 2);
        assert_eq!(v.log[0].date.as_deref(), Some("2026-10-29"));
        assert_eq!(v.log[0].text, "Fitness page started.");
    }

    #[test]
    fn quoted_next_step_with_a_colon_is_kept_without_a_checklist() {
        let note = "---\ntype: project\nproject: x\nstep: 1\nsteps_total: 3\nnext_step: \"Phase 3: build it\"\n---\n";
        let p = projects(&vault_with(&[("Projects/x.md", note)])).expect("projects");
        assert_eq!(
            find(&p, "x").next_step.as_deref(),
            Some("Phase 3: build it")
        );
    }
}

#[cfg(test)]
mod edge_tests {
    use super::*;
    use std::fmt::Write as _;
    use std::fs;

    fn vault_with(files: &[(&str, &str)]) -> (tempfile::TempDir, Index) {
        let dir = tempfile::tempdir().expect("temp dir");
        for (path, text) in files {
            let full = dir.path().join(path);
            fs::create_dir_all(full.parent().expect("parent")).expect("mkdir");
            fs::write(full, text).expect("write");
        }
        let mut index = Index::open_in_memory().expect("open");
        index.sync(dir.path()).expect("sync");
        (dir, index)
    }

    fn names(p: &Projects) -> Vec<&str> {
        p.projects.iter().map(|v| v.name.as_str()).collect()
    }

    fn proj(extra: &str) -> String {
        format!("---\ntype: project\n{extra}---\n")
    }

    #[test]
    fn null_updated_sorts_last_within_its_group_and_ties_break_by_path() {
        let (_d, index) = vault_with(&[
            ("Projects/b-none.md", &proj("")),
            ("Projects/a-none.md", &proj("")),
            ("Projects/old.md", &proj("updated: 2020-01-01\n")),
            ("Projects/new.md", &proj("updated: 2026-05-05\n")),
            ("Projects/p-none.md", &proj("status: paused\n")),
            (
                "Projects/p-dated.md",
                &proj("status: paused\nupdated: 2019-01-01\n"),
            ),
        ]);
        let p = projects(&index).expect("projects");
        assert_eq!(
            names(&p),
            ["new", "old", "a-none", "b-none", "p-dated", "p-none"]
        );
    }

    #[test]
    fn odd_status_spacing_and_case() {
        let (_d, index) = vault_with(&[
            ("Projects/a.md", &proj("status: \"  IN   PROGRESS \"\n")),
            ("Projects/b.md", &proj("status: \"  IN PROGRESS \"\n")),
            ("Projects/c.md", &proj("status: \" Active\"\n")),
            ("Projects/d.md", &proj("status: ACTIVE\n")),
            ("Projects/e.md", &proj("status: in-progress\n")),
            ("Projects/f.md", &proj("status: inactive\n")),
        ]);
        let p = projects(&index).expect("projects");
        let active = |n: &str| p.projects.iter().find(|v| v.name == n).expect(n).active;
        // Inner double spaces are not collapsed by the rule.
        assert!(!active("a"));
        assert!(active("b"));
        assert!(active("c"));
        assert!(active("d"));
        assert!(!active("e"));
        assert!(!active("f"));
        // SQL ordering agrees with `active`: all active entries come first.
        let flags: Vec<bool> = p.projects.iter().map(|v| v.active).collect();
        let first_inactive = flags.iter().position(|a| !a).unwrap_or(flags.len());
        assert!(flags[first_inactive..].iter().all(|a| !a));
    }

    #[test]
    fn name_falls_back_to_file_stem_and_unicode_names_survive() {
        let (_d, index) = vault_with(&[
            ("Projects/Hello World.md", &proj("")),
            ("Projects/日本語.md", &proj("")),
            ("Projects/named.md", &proj("project: Shown Name\n")),
            ("Projects/sub/nested.md", &proj("")),
        ]);
        let p = projects(&index).expect("projects");
        let mut n = names(&p);
        n.sort_unstable();
        assert_eq!(n, ["Hello World", "Shown Name", "nested", "日本語"]);
    }

    #[test]
    fn parse_errors_count_only_under_projects_dir() {
        let (_d, index) = vault_with(&[
            ("Projects/bad1.md", &proj("steps_total: lots\n")),
            ("Projects/sub/bad2.md", &proj("step: many\n")),
            ("Projects/ok.md", &proj("")),
            ("Other/bad3.md", &proj("steps_total: lots\n")),
            ("Fitness/bad4.md", "---\ntype: workout\ndate: nope\n---\n"),
        ]);
        let p = projects(&index).expect("projects");
        assert_eq!(p.parse_errors, 2, "only Projects/ errors count");
        assert_eq!(names(&p), ["ok"]);
    }

    #[test]
    fn fallback_edge_values() {
        let (_d, index) = vault_with(&[
            ("Projects/zero.md", &proj("step: 3\nsteps_total: 0\n")),
            ("Projects/negtotal.md", &proj("step: 2\nsteps_total: -5\n")),
            (
                "Projects/exact.md",
                &proj("step: 4\nsteps_total: 4\nnext_step: Stale\n"),
            ),
            (
                "Projects/mid.md",
                &proj("step: 2\nsteps_total: 4\nnext_step: \"Go: next\"\n"),
            ),
            ("Projects/stepsonly.md", &proj("step: 2\n")),
        ]);
        let p = projects(&index).expect("projects");
        let get = |n: &str| p.projects.iter().find(|v| v.name == n).expect(n);
        assert_eq!((get("zero").done, get("zero").total), (0, 0));
        assert_eq!((get("negtotal").done, get("negtotal").total), (0, 0));
        assert_eq!((get("exact").done, get("exact").total), (4, 4));
        assert_eq!(get("exact").next_step, None);
        assert_eq!(get("mid").next_step.as_deref(), Some("Go: next"));
        assert_eq!(get("mid").current, None);
        assert_eq!((get("stepsonly").done, get("stepsonly").total), (0, 0));
    }

    #[test]
    fn checklist_wins_over_contradicting_front_matter() {
        let note = "---\ntype: project\nstep: 7\nsteps_total: 9\nnext_step: Front\n---\n## Steps\n- [x] a\n- [ ] b\n";
        let (_d, index) = vault_with(&[("Projects/c.md", note)]);
        let p = projects(&index).expect("projects");
        let v = &p.projects[0];
        assert_eq!((v.done, v.total, v.current), (1, 2, Some(1)));
        assert_eq!(v.next_step.as_deref(), Some("b"));
    }

    #[test]
    fn all_steps_checked_hides_front_matter_next_step() {
        let note = "---\ntype: project\nnext_step: Front\n---\n## Steps\n- [x] a\n- [X] b\n";
        let (_d, index) = vault_with(&[("Projects/c.md", note)]);
        let v = &projects(&index).expect("projects").projects[0];
        assert_eq!((v.done, v.total, v.current), (2, 2, None));
        assert_eq!(v.next_step, None);
    }

    #[test]
    fn tracker_note_with_colons_in_next_step_and_log() {
        let note = "---\ntype: project\nproject: tracker\nstatus: active\nstep: 4\nsteps_total: 7\nnext_step: \"Phase 3: PR D\"\nupdated: 2026-10-30\n---\n# T\n## Steps\n- [x] one\n- [x] two\n- [x] three\n- [x] four\n- [ ] five\n- [ ] six\n- [ ] seven\n## Log\n- 2026-10-29: first\n- 2026-10-30: second: with colon\n";
        let (_d, index) = vault_with(&[("Projects/tracker.md", note)]);
        let v = &projects(&index).expect("projects").projects[0];
        assert_eq!((v.steps.len(), v.done, v.total), (7, 4, 7));
        assert_eq!(v.current, Some(4));
        assert_eq!(v.next_step.as_deref(), Some("five"));
        assert_eq!(v.log[0].text, "second: with colon");
        assert_eq!(v.log[0].date.as_deref(), Some("2026-10-30"));
        assert_eq!(v.last_log.as_ref(), v.log.first());
    }

    fn long_log(n: usize) -> String {
        let mut note = String::from("---\ntype: project\n---\n## Log\n");
        for i in 0..n {
            writeln!(note, "- e{i}").expect("write");
        }
        note
    }

    #[test]
    fn exactly_one_thousand_entries_are_all_kept() {
        let (_d, index) = vault_with(&[("Projects/n.md", &long_log(1000))]);
        let v = &projects(&index).expect("projects").projects[0];
        assert_eq!(v.log.len(), 1000);
        assert_eq!(v.log[0].text, "e999");
        assert_eq!(v.log[999].text, "e0");
    }

    #[test]
    fn one_thousand_and_one_drops_only_the_oldest() {
        let (_d, index) = vault_with(&[("Projects/n.md", &long_log(1001))]);
        let v = &projects(&index).expect("projects").projects[0];
        assert_eq!(v.log.len(), 1000);
        assert_eq!(v.log[0].text, "e1000");
        assert_eq!(v.log[999].text, "e1");
    }

    #[test]
    fn editing_a_note_replaces_its_log_and_deleting_cascades() {
        let (dir, mut index) = vault_with(&[(
            "Projects/n.md",
            "---\ntype: project\n---\n## Log\n- a\n- b\n",
        )]);
        let path = dir.path().join("Projects/n.md");
        fs::write(&path, "---\ntype: project\n---\n## Log\n- only now\n").expect("write");
        index.sync(dir.path()).expect("sync");
        let v = &projects(&index).expect("projects").projects[0];
        assert_eq!(v.log.len(), 1);
        assert_eq!(v.log[0].text, "only now");
        fs::remove_file(&path).expect("rm");
        index.sync(dir.path()).expect("sync");
        let n: i64 = index
            .conn()
            .query_row("SELECT COUNT(*) FROM project_log", [], |r| r.get(0))
            .expect("count");
        assert_eq!(n, 0);
    }

    #[test]
    fn empty_and_malformed_notes_do_not_break_the_listing() {
        let (_d, index) = vault_with(&[
            ("Projects/empty.md", ""),
            ("Projects/nofm.md", "# just text\n- [ ] not a project\n"),
            ("Projects/unterminated.md", "---\ntype: project\n"),
            ("Projects/badyaml.md", "---\n: : [\n---\n"),
            ("Projects/ok.md", &proj("")),
        ]);
        let p = projects(&index).expect("projects");
        assert!(names(&p).contains(&"ok"));
    }

    #[test]
    fn serialises_with_camel_case_keys() {
        let (_d, index) = vault_with(&[("Projects/a.md", &proj("next_step: Go\n"))]);
        let json = serde_json::to_value(projects(&index).expect("projects")).expect("json");
        assert!(json.get("parseErrors").is_some());
        let v = &json["projects"][0];
        for k in ["nextStep", "lastLog", "log", "steps", "current", "active"] {
            assert!(v.get(k).is_some(), "{k}");
        }
    }
}
