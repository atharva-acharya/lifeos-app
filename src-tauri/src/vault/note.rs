//! Front matter parsing and typed note models (requirements §2).
//! Field names match the vault exactly; unknown fields are ignored here and
//! preserved by the writer (phase 4).

use serde::Serialize;
use yaml_rust2::{Yaml, YamlLoader};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("front matter is not valid YAML: {0}")]
    Yaml(String),
    #[error("front matter must be a map of fields")]
    NotAMap,
    #[error("field `{0}` has the wrong type")]
    WrongType(&'static str),
    #[error("field `{0}` must be a date like 2026-10-29")]
    BadDate(&'static str),
    #[error("field `{field}` must be one of: {allowed}")]
    NotAllowed {
        field: &'static str,
        allowed: &'static str,
    },
}

/// Splits a note into its YAML front matter (if any) and Markdown body.
pub fn split_front_matter(text: &str) -> (Option<&str>, &str) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, text);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let body = &rest[offset + line.len()..];
            return (Some(&rest[..offset]), body);
        }
        offset += line.len();
    }
    (None, text)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Note {
    Daily(Daily),
    Workout(Workout),
    Company(Company),
    Weekly(Weekly),
    Project(Project),
    /// A note with no front matter or a `type` the app does not model.
    Other,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Daily {
    pub date: Option<String>,
    pub weight: Option<f64>,
    pub steps: Option<i64>,
    pub protein_g: Option<i64>,
    pub meals_tracked: Option<bool>,
    pub gym: Option<String>,
    pub mobility: Option<bool>,
    pub applications: Option<i64>,
    pub study_minutes: Option<i64>,
    pub mood: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Workout {
    pub date: Option<String>,
    pub day: Option<String>,
    pub week: Option<i64>,
    pub deload: Option<bool>,
    pub duration_min: Option<i64>,
    pub exercises: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Company {
    pub company: Option<String>,
    pub role: Option<String>,
    pub stage: Option<String>,
    pub applied: Option<String>,
    pub contact: Option<String>,
    pub next_action: Option<String>,
    pub next_date: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Weekly {
    pub week: Option<String>,
    pub arc_week: Option<i64>,
    pub avg_weight: Option<f64>,
    pub weight_change: Option<f64>,
    pub target_change: Option<f64>,
    pub sessions: Option<i64>,
    pub protein_days: Option<i64>,
    pub avg_steps: Option<i64>,
    pub applications: Option<i64>,
    pub replies: Option<i64>,
    pub study_hours: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Project {
    pub project: Option<String>,
    pub status: Option<String>,
    pub step: Option<i64>,
    pub steps_total: Option<i64>,
    pub next_step: Option<String>,
    pub updated: Option<String>,
    /// Ordered checklist from the body: (done, text).
    pub steps: Vec<(bool, String)>,
}

pub const STAGES: &[&str] = &[
    "applied",
    "replied",
    "screen",
    "interview",
    "offer",
    "rejected",
];
pub const WORKOUT_DAYS: &[&str] = &["Push A", "Pull A", "Legs", "Push B", "Pull B"];

/// Parses a note's text into a typed model.
pub fn parse(text: &str) -> Result<Note, ParseError> {
    let (front, body) = split_front_matter(text);
    let Some(front) = front else {
        return Ok(Note::Other);
    };
    let docs = YamlLoader::load_from_str(front).map_err(|e| ParseError::Yaml(e.to_string()))?;
    let map = match docs.into_iter().next() {
        None | Some(Yaml::Null) => return Ok(Note::Other),
        Some(map @ Yaml::Hash(_)) => map,
        Some(_) => return Err(ParseError::NotAMap),
    };
    let f = Fields(&map);
    Ok(match f.string("type")?.as_deref() {
        Some("daily") => Note::Daily(Daily {
            date: f.date("date")?,
            weight: f.float("weight")?,
            steps: f.int("steps")?,
            protein_g: f.int("protein_g")?,
            meals_tracked: f.boolean("meals_tracked")?,
            gym: f.string("gym")?,
            mobility: f.boolean("mobility")?,
            applications: f.int("applications")?,
            study_minutes: f.int("study_minutes")?,
            mood: f.int("mood")?,
        }),
        Some("workout") => Note::Workout(Workout {
            date: f.date("date")?,
            day: f.one_of("day", WORKOUT_DAYS, "Push A, Pull A, Legs, Push B, Pull B")?,
            week: f.int("week")?,
            deload: f.boolean("deload")?,
            duration_min: f.int("duration_min")?,
            exercises: f.list("exercises")?,
        }),
        Some("company") => Note::Company(Company {
            company: f.string("company")?,
            role: f.string("role")?,
            stage: f.one_of(
                "stage",
                STAGES,
                "applied, replied, screen, interview, offer, rejected",
            )?,
            applied: f.date("applied")?,
            contact: f.string("contact")?,
            next_action: f.string("next_action")?,
            next_date: f.date("next_date")?,
        }),
        Some("weekly") => Note::Weekly(Weekly {
            week: f.string("week")?,
            arc_week: f.int("arc_week")?,
            avg_weight: f.float("avg_weight")?,
            weight_change: f.float("weight_change")?,
            target_change: f.float("target_change")?,
            sessions: f.int("sessions")?,
            protein_days: f.int("protein_days")?,
            avg_steps: f.int("avg_steps")?,
            applications: f.int("applications")?,
            replies: f.int("replies")?,
            study_hours: f.float("study_hours")?,
        }),
        Some("project") => Note::Project(Project {
            project: f.string("project")?,
            status: f.string("status")?,
            step: f.int("step")?,
            steps_total: f.int("steps_total")?,
            next_step: f.string("next_step")?,
            updated: f.date("updated")?,
            steps: checklist(body),
        }),
        _ => Note::Other,
    })
}

/// Reads `- [ ] step` / `- [x] step` lines under a `## Steps` heading, or
/// anywhere if the note has no such heading.
pub fn checklist(body: &str) -> Vec<(bool, String)> {
    let has_heading = body
        .lines()
        .any(|l| l.trim().eq_ignore_ascii_case("## steps"));
    let mut in_steps = !has_heading;
    let mut out = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_steps = !has_heading || trimmed.eq_ignore_ascii_case("## steps");
            continue;
        }
        if !in_steps {
            continue;
        }
        let item = trimmed
            .strip_prefix("- [")
            .or_else(|| trimmed.strip_prefix("* ["));
        if let Some(rest) = item {
            let done = rest.starts_with(['x', 'X']);
            if let Some(text) = rest.get(1..).and_then(|r| r.strip_prefix("] ")) {
                out.push((done, text.trim().to_owned()));
            }
        }
    }
    out
}

struct Fields<'a>(&'a Yaml);

impl Fields<'_> {
    fn get(&self, key: &str) -> Option<&Yaml> {
        match &self.0[key] {
            Yaml::BadValue | Yaml::Null => None,
            v => Some(v),
        }
    }

    fn string(&self, key: &'static str) -> Result<Option<String>, ParseError> {
        Ok(match self.get(key) {
            None => None,
            Some(Yaml::String(s)) => Some(s.clone()),
            Some(Yaml::Integer(i)) => Some(i.to_string()),
            Some(Yaml::Real(r)) => Some(r.clone()),
            Some(Yaml::Boolean(b)) => Some(b.to_string()),
            Some(_) => return Err(ParseError::WrongType(key)),
        })
    }

    fn int(&self, key: &'static str) -> Result<Option<i64>, ParseError> {
        match self.get(key) {
            None => Ok(None),
            Some(Yaml::Integer(i)) => Ok(Some(*i)),
            Some(_) => Err(ParseError::WrongType(key)),
        }
    }

    fn float(&self, key: &'static str) -> Result<Option<f64>, ParseError> {
        match self.get(key) {
            None => Ok(None),
            Some(Yaml::Real(_)) => self
                .get(key)
                .and_then(Yaml::as_f64)
                .map(Some)
                .ok_or(ParseError::WrongType(key)),
            #[allow(clippy::cast_precision_loss)]
            Some(Yaml::Integer(i)) => Ok(Some(*i as f64)),
            Some(_) => Err(ParseError::WrongType(key)),
        }
    }

    fn boolean(&self, key: &'static str) -> Result<Option<bool>, ParseError> {
        match self.get(key) {
            None => Ok(None),
            Some(Yaml::Boolean(b)) => Ok(Some(*b)),
            Some(_) => Err(ParseError::WrongType(key)),
        }
    }

    fn date(&self, key: &'static str) -> Result<Option<String>, ParseError> {
        let Some(s) = self.string(key)? else {
            return Ok(None);
        };
        if is_iso_date(&s) {
            Ok(Some(s))
        } else {
            Err(ParseError::BadDate(key))
        }
    }

    fn one_of(
        &self,
        key: &'static str,
        allowed: &[&str],
        list: &'static str,
    ) -> Result<Option<String>, ParseError> {
        match self.string(key)? {
            None => Ok(None),
            Some(v) if allowed.contains(&v.as_str()) => Ok(Some(v)),
            Some(_) => Err(ParseError::NotAllowed {
                field: key,
                allowed: list,
            }),
        }
    }

    fn list(&self, key: &'static str) -> Result<Vec<String>, ParseError> {
        match self.get(key) {
            None => Ok(Vec::new()),
            Some(Yaml::Array(items)) => items
                .iter()
                .map(|i| match i {
                    Yaml::String(s) => Ok(s.clone()),
                    _ => Err(ParseError::WrongType(key)),
                })
                .collect(),
            Some(_) => Err(ParseError::WrongType(key)),
        }
    }
}

fn is_iso_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (1..=12).contains(&s[5..7].parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&s[8..10].parse::<u8>().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAILY: &str = "---\ntype: daily\ndate: 2026-10-29\nweight: 82.4\nsteps: 9120\nprotein_g: 160\nmeals_tracked: true\ngym: Push A\nmobility: false\napplications: 3\nstudy_minutes: 90\nmood: 4\nextra_field: kept\n---\n# Notes\n";

    #[test]
    fn splits_front_matter_and_body() {
        let (front, body) = split_front_matter("---\na: 1\n---\nbody\n");
        assert_eq!(front, Some("a: 1\n"));
        assert_eq!(body, "body\n");
    }

    #[test]
    fn handles_crlf_and_bom() {
        let (front, body) = split_front_matter("\u{feff}---\r\na: 1\r\n---\r\nbody");
        assert_eq!(front, Some("a: 1\r\n"));
        assert_eq!(body, "body");
    }

    #[test]
    fn no_front_matter_is_other() {
        assert_eq!(parse("# Just a note\n"), Ok(Note::Other));
        assert_eq!(parse("---\nunclosed: yes\n"), Ok(Note::Other));
    }

    #[test]
    fn parses_daily() {
        let Ok(Note::Daily(d)) = parse(DAILY) else {
            panic!("expected daily");
        };
        assert_eq!(d.date.as_deref(), Some("2026-10-29"));
        assert_eq!(d.weight, Some(82.4));
        assert_eq!(d.steps, Some(9120));
        assert_eq!(d.meals_tracked, Some(true));
        assert_eq!(d.gym.as_deref(), Some("Push A"));
        assert_eq!(d.mood, Some(4));
    }

    #[test]
    fn integer_weight_is_accepted() {
        let Ok(Note::Daily(d)) = parse("---\ntype: daily\nweight: 82\n---\n") else {
            panic!("expected daily");
        };
        assert_eq!(d.weight, Some(82.0));
    }

    #[test]
    fn parses_workout_with_exercises() {
        let text = "---\ntype: workout\ndate: 2026-10-28\nday: Pull A\nweek: 3\ndeload: false\nduration_min: 62\nexercises:\n  - Deadlift 3 x 5 @ 140\n  - Row 3 x 8 @ 70\n---\n";
        let Ok(Note::Workout(w)) = parse(text) else {
            panic!("expected workout");
        };
        assert_eq!(w.day.as_deref(), Some("Pull A"));
        assert_eq!(w.exercises.len(), 2);
    }

    #[test]
    fn parses_company_and_checks_stage() {
        let ok = "---\ntype: company\ncompany: Example Ltd\nrole: SOC Analyst\nstage: screen\napplied: 2026-10-01\nnext_date: 2026-10-30\n---\n";
        let Ok(Note::Company(c)) = parse(ok) else {
            panic!("expected company");
        };
        assert_eq!(c.stage.as_deref(), Some("screen"));
        let bad = "---\ntype: company\nstage: ghosted\n---\n";
        assert!(matches!(
            parse(bad),
            Err(ParseError::NotAllowed { field: "stage", .. })
        ));
    }

    #[test]
    fn parses_project_with_steps() {
        let text = "---\ntype: project\nproject: demo\nstatus: active\nstep: 2\nsteps_total: 3\nupdated: 2026-10-29\n---\n# Demo\n## Steps\n- [x] First\n- [ ] Second\n- [ ] Third\n## Log\n- [ ] not a step\n";
        let Ok(Note::Project(p)) = parse(text) else {
            panic!("expected project");
        };
        assert_eq!(
            p.steps,
            vec![
                (true, "First".to_owned()),
                (false, "Second".to_owned()),
                (false, "Third".to_owned())
            ]
        );
    }

    #[test]
    fn wrong_types_and_dates_are_errors() {
        assert_eq!(
            parse("---\ntype: daily\nsteps: lots\n---\n"),
            Err(ParseError::WrongType("steps"))
        );
        assert_eq!(
            parse("---\ntype: daily\ndate: 29/10/2026\n---\n"),
            Err(ParseError::BadDate("date"))
        );
        assert_eq!(
            parse("---\ntype: daily\ndate: 2026-13-01\n---\n"),
            Err(ParseError::BadDate("date"))
        );
    }

    #[test]
    fn invalid_yaml_is_an_error_not_a_panic() {
        assert!(matches!(
            parse("---\ntype: [daily\n---\n"),
            Err(ParseError::Yaml(_))
        ));
        assert_eq!(parse("---\n- a\n- b\n---\n"), Err(ParseError::NotAMap));
    }

    #[test]
    fn unknown_type_is_other() {
        assert_eq!(parse("---\ntype: recipe\n---\n"), Ok(Note::Other));
    }
}
