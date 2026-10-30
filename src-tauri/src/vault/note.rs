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
    Plan(Plan),
    /// `Jobs/Outreach.md`: one table of contacts.
    Outreach(Vec<OutreachEntry>),
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
    /// Last entry of the `## Log` section, if any.
    pub last_log: Option<String>,
    /// Every bullet of the `## Log` section, in file order.
    pub log: Vec<LogEntry>,
}

/// One bullet of a project's `## Log`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub date: Option<String>,
    pub text: String,
}

/// `Fitness/Plan.md`: the training plan's span and goals. Every field is optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Plan {
    pub name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub start_weight: Option<f64>,
    pub target_weight: Option<f64>,
    pub steps_goal: Option<i64>,
    pub protein_goal: Option<i64>,
}

/// One line of a workout's `exercises` list, read as `Name S x R @ KG`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExerciseSet {
    pub name: String,
    pub sets: Option<i64>,
    pub reps: Option<i64>,
    pub kg: Option<f64>,
    pub raw: String,
}

const MAX_SETS: i64 = 100;
const MAX_REPS: i64 = 1000;
const MAX_KG: f64 = 1000.0;

/// Reads an exercise line such as `Deadlift 3 x 5 @ 120`. The separator may be
/// `x`, `X` or `×`, spaces are flexible, `kg` is optional and the decimal may
/// be `.` or `,`. A line that does not fit keeps its whole text as the name
/// with no numbers; it never fails. Absurd values become `None`.
pub fn parse_exercise(line: &str) -> ExerciseSet {
    let garbage = || ExerciseSet {
        name: line.trim().to_owned(),
        sets: None,
        reps: None,
        kg: None,
        raw: line.to_owned(),
    };
    let Some((left, right)) = line.rsplit_once('@') else {
        return garbage();
    };
    let Some((name, sets, reps)) = split_sets_reps(left) else {
        return garbage();
    };
    let right = right.trim();
    let number = right
        .get(right.len().saturating_sub(2)..)
        .filter(|unit| right.len() >= 2 && unit.eq_ignore_ascii_case("kg"))
        .map_or(right, |_| right[..right.len() - 2].trim_end());
    let kg = number
        .replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|k| k.is_finite() && (0.0..=MAX_KG).contains(k));
    ExerciseSet {
        name,
        sets: sets.filter(|n| (0..=MAX_SETS).contains(n)),
        reps: reps.filter(|n| (0..=MAX_REPS).contains(n)),
        kg,
        raw: line.to_owned(),
    }
}

/// Splits `Name S x R` from the right. A count too large for an integer is
/// returned as `None` rather than failing the line.
fn split_sets_reps(left: &str) -> Option<(String, Option<i64>, Option<i64>)> {
    let rest = left.trim_end();
    let digits = rest.chars().rev().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let (rest, reps) = rest.split_at(rest.len() - digits);
    let rest = rest.trim_end().strip_suffix(['x', 'X', '×'])?.trim_end();
    let digits_s = rest.chars().rev().take_while(char::is_ascii_digit).count();
    if digits_s == 0 {
        return None;
    }
    let (name, sets) = rest.split_at(rest.len() - digits_s);
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    Some((name.to_owned(), sets.parse().ok(), reps.parse().ok()))
}

/// A body weight in kg the page can draw: finite, above 0 and at most 1000.
fn plausible_weight(w: f64) -> bool {
    w.is_finite() && w > 0.0 && w <= 1000.0
}

pub const STAGES: &[&str] = &[
    "applied",
    "replied",
    "screen",
    "interview",
    "offer",
    "rejected",
];
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutreachEntry {
    pub sent: Option<String>,
    pub name: Option<String>,
    pub profile: Option<String>,
    pub company_role: Option<String>,
    pub contact_type: Option<String>,
    pub status: Option<String>,
    pub last_update: Option<String>,
}

pub const OUTREACH_STATUSES: &[&str] = &["sent", "accepted", "messaged", "replied", "withdrawn"];

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
            last_log: last_log(body),
            log: log_entries(body),
        }),
        Some("plan") => Note::Plan(Plan {
            name: f.string("name")?,
            start: f.date("start")?,
            end: f.date("end")?,
            start_weight: f.float("start_weight")?.filter(|w| plausible_weight(*w)),
            target_weight: f.float("target_weight")?.filter(|w| plausible_weight(*w)),
            steps_goal: f.int("steps_goal")?.filter(|n| (1..=100_000).contains(n)),
            protein_goal: f.int("protein_goal")?.filter(|n| (1..=1000).contains(n)),
        }),
        Some("outreach-log") => Note::Outreach(outreach_table(body)),
        _ => Note::Other,
    })
}

/// Reads `- [ ] step` / `- [x] step` lines under a `## Steps` heading, or
/// anywhere if the note has no such heading.
/// Returns the last list item under a `## Log` heading.
pub fn last_log(body: &str) -> Option<String> {
    let mut in_log = false;
    let mut last = None;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_log = trimmed.eq_ignore_ascii_case("## log");
            continue;
        }
        if in_log
            && let Some(item) = trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
        {
            last = Some(item.trim().to_owned());
        }
    }
    last
}

/// Splits a leading ISO date off a log bullet. The date must be followed by
/// `:`, ` - `, ` – ` or whitespace; otherwise the whole bullet is the text.
fn split_log_item(item: &str) -> LogEntry {
    if let Some(head) = item.get(..10)
        && is_iso_date(head)
    {
        let rest = &item[10..];
        let text = if let Some(r) = rest.strip_prefix(':') {
            Some(r)
        } else if let Some(r) = rest
            .strip_prefix(" - ")
            .or_else(|| rest.strip_prefix(" – "))
        {
            Some(r)
        } else if rest.starts_with(char::is_whitespace) {
            Some(rest)
        } else {
            None
        };
        if let Some(text) = text {
            let text = text.trim();
            if !text.is_empty() {
                return LogEntry {
                    date: Some(head.to_owned()),
                    text: text.to_owned(),
                };
            }
        }
    }
    LogEntry {
        date: None,
        text: item.to_owned(),
    }
}

/// Returns the bullets under a `## Log` heading, in file order. Empty
/// bullets are skipped.
pub fn log_entries(body: &str) -> Vec<LogEntry> {
    let mut in_log = false;
    let mut out = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_log = trimmed.eq_ignore_ascii_case("## log");
            continue;
        }
        if in_log
            && let Some(item) = trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
        {
            let item = item.trim();
            if !item.is_empty() {
                out.push(split_log_item(item));
            }
        }
    }
    out
}

/// Reads the first Markdown table in the body, matching columns by header
/// name (case-insensitive), so reordering columns is harmless.
pub fn outreach_table(body: &str) -> Vec<OutreachEntry> {
    let mut rows = body
        .lines()
        .map(str::trim)
        .skip_while(|l| !l.starts_with('|'))
        .take_while(|l| l.starts_with('|'));
    let Some(header) = rows.next() else {
        return Vec::new();
    };
    let headers: Vec<String> = cells(header).iter().map(|h| h.to_lowercase()).collect();
    let col = |names: &[&str]| headers.iter().position(|h| names.contains(&h.as_str()));
    let (sent, name, profile, company, kind, status, updated) = (
        col(&["sent", "date"]),
        col(&["name"]),
        col(&["profile"]),
        col(&["company / role", "company/role", "company"]),
        col(&["type"]),
        col(&["status"]),
        col(&["last update", "updated"]),
    );
    rows.filter(|r| !is_separator(r))
        .map(|r| {
            let c = cells(r);
            let get = |i: Option<usize>| {
                i.and_then(|i| c.get(i))
                    .map(|v| v.trim_matches('`').trim().to_owned())
                    .filter(|v| !v.is_empty())
            };
            OutreachEntry {
                sent: get(sent),
                name: get(name),
                profile: get(profile),
                company_role: get(company),
                contact_type: get(kind),
                status: get(status).map(|s| s.to_lowercase()),
                last_update: get(updated),
            }
        })
        .filter(|e| e != &OutreachEntry::default())
        .collect()
}

fn cells(row: &str) -> Vec<String> {
    row.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|c| c.trim().to_owned())
        .collect()
}

fn is_separator(row: &str) -> bool {
    cells(row)
        .iter()
        .all(|c| !c.is_empty() && c.chars().all(|ch| matches!(ch, '-' | ':' | ' ')))
}

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

pub fn is_iso_date(s: &str) -> bool {
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
        assert_eq!(p.last_log.as_deref(), Some("[ ] not a step"));
    }

    #[test]
    fn log_entries_split_dates_and_text() {
        let body = "## Log
- 2026-01-02: dated colon
- 2026-01-03 - dash
- 2026-01-04 – en dash
- 2026-01-05 spaced
- 2026-13-40: bad date
- no date here
- 2026-01-06:no space
- 2026-01-077 glued
* star bullet
- 
- ééééééééééé accents
- 2026-01-08
";
        let e = log_entries(body);
        let got: Vec<(Option<&str>, &str)> = e
            .iter()
            .map(|x| (x.date.as_deref(), x.text.as_str()))
            .collect();
        assert_eq!(got[0], (Some("2026-01-02"), "dated colon"));
        assert_eq!(got[1], (Some("2026-01-03"), "dash"));
        assert_eq!(got[2], (Some("2026-01-04"), "en dash"));
        assert_eq!(got[3], (Some("2026-01-05"), "spaced"));
        assert_eq!(got[4], (None, "2026-13-40: bad date"));
        assert_eq!(got[5], (None, "no date here"));
        assert_eq!(got[6], (Some("2026-01-06"), "no space"));
        assert_eq!(got[7], (None, "2026-01-077 glued"));
        assert_eq!(got[8], (None, "star bullet"));
        assert_eq!(got[9], (None, "ééééééééééé accents"));
        assert_eq!(got[10], (None, "2026-01-08"));
        assert_eq!(got.len(), 11);
    }

    #[test]
    fn log_entries_only_from_log_section() {
        assert!(log_entries("## Log\n").is_empty());
        assert!(log_entries("## Steps\n- [x] a\n- b\n").is_empty());
        let body = "## Steps\n- [x] a\n## LOG\n- 2026-01-02: x\n## Other\n- y\n";
        let e = log_entries(body);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].text, "x");
    }

    #[test]
    fn reads_last_log_entry() {
        let body = "## Steps
- [ ] a
## Log
- 2026-01-01: started
- 2026-01-02: kept going
## Notes
- unrelated
";
        assert_eq!(last_log(body).as_deref(), Some("2026-01-02: kept going"));
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
    fn parses_outreach_table_by_header() {
        let text = "---
type: outreach-log
---
# Outreach
Intro text.

| Sent | Name | Profile | Company / role | Type | Status | Last update |
|---|---|---|---|---|---|---|
| 2026-01-05 | Alex Example | linkedin.com/in/alex | Example Ltd / SOC Analyst | Recruiter | `replied` | 2026-01-07 |
| 2026-01-06 | Jo Sample | | Sample Bank | Peer | Sent | |

After the table.
";
        let Ok(Note::Outreach(rows)) = parse(text) else {
            panic!("expected outreach");
        };
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name.as_deref(), Some("Alex Example"));
        assert_eq!(
            rows[0].company_role.as_deref(),
            Some("Example Ltd / SOC Analyst")
        );
        assert_eq!(rows[0].status.as_deref(), Some("replied"));
        assert_eq!(rows[1].status.as_deref(), Some("sent"));
        assert_eq!(rows[1].profile, None);
    }

    #[test]
    fn outreach_columns_can_be_reordered_or_missing() {
        let body = "| Status | Name |
|:--|--:|
| accepted | Sam |
";
        let rows = outreach_table(body);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name.as_deref(), Some("Sam"));
        assert_eq!(rows[0].status.as_deref(), Some("accepted"));
        assert_eq!(rows[0].sent, None);
        assert!(outreach_table("no table here").is_empty());
    }

    #[test]
    fn parses_plan_with_optional_fields() {
        let text = "---\ntype: plan\nname: Winter Arc\nstart: 2026-01-05\nend: 2026-03-30\nstart_weight: 85\ntarget_weight: 80.5\nsteps_goal: 9000\nprotein_goal: 160\n---\n";
        let Ok(Note::Plan(p)) = parse(text) else {
            panic!("expected plan");
        };
        assert_eq!(p.name.as_deref(), Some("Winter Arc"));
        assert_eq!(p.start.as_deref(), Some("2026-01-05"));
        assert_eq!(p.start_weight, Some(85.0));
        assert_eq!(p.target_weight, Some(80.5));
        assert_eq!((p.steps_goal, p.protein_goal), (Some(9000), Some(160)));
        let Ok(Note::Plan(bare)) = parse("---\ntype: plan\n---\n") else {
            panic!("expected plan");
        };
        assert_eq!(bare, Plan::default());
        assert_eq!(
            parse("---\ntype: plan\nstart: soon\n---\n"),
            Err(ParseError::BadDate("start"))
        );
    }

    fn ex(line: &str) -> (String, Option<i64>, Option<i64>, Option<f64>) {
        let e = parse_exercise(line);
        (e.name, e.sets, e.reps, e.kg)
    }

    #[test]
    fn parses_a_good_exercise_line() {
        assert_eq!(
            ex("Deadlift 3 x 5 @ 120"),
            ("Deadlift".to_owned(), Some(3), Some(5), Some(120.0))
        );
        assert_eq!(parse_exercise("Row 3 x 8 @ 70").raw, "Row 3 x 8 @ 70");
    }

    #[test]
    fn exercise_spacing_separator_unit_and_decimals_are_flexible() {
        let want = ("Bench press".to_owned(), Some(3), Some(8), Some(62.5));
        assert_eq!(ex("Bench press 3x8@62.5"), want);
        assert_eq!(ex("  Bench press   3  X  8   @   62,5 kg  "), want);
        assert_eq!(ex("Bench press 3 × 8 @ 62.5kg"), want);
        assert_eq!(ex("Bench press 3 x 8 @ 62.5 KG"), want);
    }

    #[test]
    fn unparseable_exercise_lines_keep_their_text() {
        for line in [
            "Farmers walk for time",
            "",
            "   ",
            "@",
            "3 x 5 @ 100",
            "Squat @ 100",
        ] {
            let e = parse_exercise(line);
            assert_eq!(e.name, line.trim());
            assert_eq!((e.sets, e.reps, e.kg), (None, None, None));
            assert_eq!(e.raw, line);
        }
    }

    #[test]
    fn absurd_exercise_numbers_are_dropped() {
        let squat = |kg: Option<f64>| ("Squat".to_owned(), Some(3), Some(5), kg);
        assert_eq!(ex("Squat 3 x 5 @ 5000"), squat(None));
        assert_eq!(ex("Squat 3 x 5 @ inf"), squat(None));
        assert_eq!(ex("Squat 3 x 5 @ NaN"), squat(None));
        assert_eq!(ex("Squat 3 x 5 @ -20"), squat(None));
        assert_eq!(
            ex("Squat 101 x 1001 @ 100"),
            ("Squat".to_owned(), None, None, Some(100.0))
        );
        let huge = parse_exercise("Squat 99999999999999999999 x 5 @ 100");
        assert_eq!(
            (huge.sets, huge.reps, huge.kg),
            (None, Some(5), Some(100.0))
        );
    }

    #[test]
    fn exercise_parser_survives_odd_unicode() {
        assert_eq!(parse_exercise("Pressé 3 x 5 @ 4é").kg, None);
        assert_eq!(parse_exercise("Press 3 x 5 @ é").kg, None);
        let _ = parse_exercise("日本語 @ ×");
        let _ = parse_exercise("日本語 3 × 5 @ 日本");
    }

    #[test]
    fn unknown_type_is_other() {
        assert_eq!(parse("---\ntype: recipe\n---\n"), Ok(Note::Other));
    }
}

#[cfg(test)]
mod fitness_edge_tests {
    use super::*;
    use proptest::prelude::*;

    fn ex(line: &str) -> (String, Option<i64>, Option<i64>, Option<f64>) {
        let e = parse_exercise(line);
        (e.name, e.sets, e.reps, e.kg)
    }

    fn garbage(line: &str) {
        let e = parse_exercise(line);
        assert_eq!(e.name, line.trim(), "{line:?}");
        assert_eq!((e.sets, e.reps, e.kg), (None, None, None), "{line:?}");
        assert_eq!(e.raw, line);
    }

    #[test]
    fn multiple_at_signs_use_the_last_one() {
        // The name may contain `@`; the weight is after the final one.
        assert_eq!(
            ex("Cable @ home 3 x 5 @ 20"),
            ("Cable @ home".to_owned(), Some(3), Some(5), Some(20.0))
        );
        // A second `@` after the weight leaves nothing readable on the left.
        garbage("Squat 3 x 5 @ 100 @ 120");
        garbage("Squat 3 x 5 @ 100 @");
        garbage("@ @ @");
    }

    #[test]
    fn missing_or_odd_weight_keeps_sets_and_reps() {
        assert_eq!(
            ex("Squat 3 x 5 @"),
            ("Squat".to_owned(), Some(3), Some(5), None)
        );
        assert_eq!(ex("Squat 3 x 5 @ kg").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 80 kgs").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 80lb").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 1.2.3").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 6,2,5").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 1.000,5").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 100kg").3, Some(100.0));
        assert_eq!(ex("Squat 3 x 5 @ 100 kG").3, Some(100.0));
        assert_eq!(ex("Squat 3 x 5 @ .5").3, Some(0.5));
        assert_eq!(ex("Squat 3 x 5 @ 0").3, Some(0.0));
    }

    #[test]
    fn weight_limits_are_inclusive_at_1000() {
        assert_eq!(ex("Squat 3 x 5 @ 1000").3, Some(1000.0));
        assert_eq!(ex("Squat 3 x 5 @ 1000.0001").3, None);
        assert_eq!(ex("Squat 3 x 5 @ 1e309").3, None);
        assert_eq!(ex("Squat 3 x 5 @ -0.5").3, None);
        assert_eq!(ex("Squat 3 x 5 @ infinity").3, None);
        assert_eq!(ex("Squat 3 x 5 @ -inf").3, None);
        assert_eq!(ex("Squat 3 x 5 @ nan kg").3, None);
    }

    #[test]
    fn set_and_rep_limits_are_inclusive() {
        assert_eq!(
            ex("Squat 100 x 1000 @ 10"),
            ("Squat".to_owned(), Some(100), Some(1000), Some(10.0))
        );
        assert_eq!(
            ex("Squat 0 x 0 @ 10"),
            ("Squat".to_owned(), Some(0), Some(0), Some(10.0))
        );
        assert_eq!(
            ex("Squat 003 x 007 @ 10"),
            ("Squat".to_owned(), Some(3), Some(7), Some(10.0))
        );
        // Counts too big for an integer drop out without failing the line.
        let big = "9".repeat(40);
        let e = parse_exercise(&format!("Squat 3 x {big} @ 10"));
        assert_eq!((e.sets, e.reps, e.kg), (Some(3), None, Some(10.0)));
    }

    #[test]
    fn separators_and_whitespace_variants() {
        let want = ("Row".to_owned(), Some(4), Some(6), Some(55.0));
        assert_eq!(ex("Row 4×6@55"), want);
        assert_eq!(ex("Row 4X6@55"), want);
        assert_eq!(ex("Row\t4\tx\t6\t@\t55"), want);
        assert_eq!(ex("Row\u{a0}4 x 6 @ 55"), want);
        // A name that contains `x` or digits.
        assert_eq!(
            ex("Box jump 3 x 5 @ 20"),
            ("Box jump".to_owned(), Some(3), Some(5), Some(20.0))
        );
        assert_eq!(
            ex("21s curl 3 x 5 @ 20"),
            ("21s curl".to_owned(), Some(3), Some(5), Some(20.0))
        );
    }

    #[test]
    fn non_ascii_digits_and_separators_are_not_numbers() {
        garbage("Squat \u{ff13} x \u{ff15} @ 100"); // fullwidth digits
        garbage("Squat \u{663} x \u{665} @ 100"); // Arabic-Indic digits
        garbage("Squat 3 \u{2715} 5 @ 100"); // multiplication x symbol
        garbage("Squat 3 * 5 @ 100");
        garbage("Squat 3 x five @ 100");
        garbage("Squat three x 5 @ 100");
    }

    #[test]
    fn name_only_or_number_only_lines_are_garbage() {
        garbage("5 @ 100");
        garbage("x 5 @ 100");
        garbage("Squat x 5 @ 100");
        garbage("Squat 3 x @ 100");
        garbage("Squat 3 x 5");
        garbage("\t\n");
    }

    #[test]
    fn very_long_lines_do_not_panic_or_stall() {
        let long_name = "a".repeat(1_000_000);
        let e = parse_exercise(&format!("{long_name} 3 x 5 @ 100"));
        assert_eq!(e.name.len(), 1_000_000);
        assert_eq!(e.kg, Some(100.0));
        garbage(&"a".repeat(1_000_000));
        garbage(&"@".repeat(100_000));
        garbage(&"x".repeat(100_000));
        let digits = "9".repeat(100_000);
        let e = parse_exercise(&format!("Squat {digits} x {digits} @ {digits}"));
        assert_eq!((e.sets, e.reps, e.kg), (None, None, None));
        assert_eq!(e.name, "Squat");
        let e = parse_exercise(&format!("日本語 3 × 5 @ {}", "é".repeat(50_000)));
        assert_eq!(e.kg, None);
    }

    #[test]
    fn plan_with_wrong_types_is_rejected_by_field() {
        let bad = |fm: &str| parse(&format!("---\ntype: plan\n{fm}\n---\n"));
        let wrong = |k: &'static str| Err(ParseError::WrongType(k));
        assert_eq!(bad("steps_goal: lots"), wrong("steps_goal"));
        assert_eq!(bad("steps_goal: 8000.5"), wrong("steps_goal"));
        assert_eq!(bad("protein_goal: [1, 2]"), wrong("protein_goal"));
        assert_eq!(bad("protein_goal: true"), wrong("protein_goal"));
        assert_eq!(bad("target_weight: 80kg"), wrong("target_weight"));
        assert_eq!(bad("target_weight: [80]"), wrong("target_weight"));
        // A null is the same as an absent field.
        assert_eq!(bad("start_weight: ~"), Ok(Note::Plan(Plan::default())));
        assert_eq!(bad("name: [a, b]"), wrong("name"));
        assert_eq!(bad("name: {a: b}"), wrong("name"));
        assert_eq!(bad("start: [2026-01-05]"), wrong("start"));
        assert_eq!(bad("start: 20260105"), Err(ParseError::BadDate("start")));
        assert_eq!(bad("end: 2026-13-45"), Err(ParseError::BadDate("end")));
        assert_eq!(bad("end: ''"), Err(ParseError::BadDate("end")));
    }

    #[test]
    fn plan_scalars_that_are_coerced() {
        let text = "---\ntype: plan\nname: 2026\ntarget_weight: 80\nsteps_goal: -5\n---\n";
        let Ok(Note::Plan(p)) = parse(text) else {
            panic!("expected plan");
        };
        assert_eq!(p.name.as_deref(), Some("2026"));
        assert_eq!(p.target_weight, Some(80.0));
        // Out-of-range goals are dropped so the defaults apply.
        assert_eq!(p.steps_goal, None);
    }

    #[test]
    fn plan_numbers_outside_their_range_are_dropped() {
        let plan = |fm: &str| {
            let Ok(Note::Plan(p)) = parse(&format!(
                "---
type: plan
{fm}
---
"
            )) else {
                panic!("expected plan");
            };
            p
        };
        assert_eq!(plan("steps_goal: 0").steps_goal, None);
        assert_eq!(plan("steps_goal: 100001").steps_goal, None);
        assert_eq!(plan("steps_goal: 100000").steps_goal, Some(100_000));
        assert_eq!(plan("protein_goal: 1001").protein_goal, None);
        assert_eq!(plan("protein_goal: 1").protein_goal, Some(1));
        assert_eq!(plan("target_weight: 0").target_weight, None);
        assert_eq!(plan("target_weight: -80").target_weight, None);
        assert_eq!(plan("start_weight: 1000.5").start_weight, None);
        assert_eq!(plan("start_weight: 1000").start_weight, Some(1000.0));
        assert_eq!(plan("target_weight: .inf").target_weight, None);
        assert_eq!(plan("target_weight: .nan").target_weight, None);
    }

    #[test]
    fn plan_with_empty_or_broken_front_matter() {
        assert!(matches!(
            parse("---\ntype: plan\n---\nbody"),
            Ok(Note::Plan(_))
        ));
        assert!(parse("---\ntype: plan\n  bad: [unclosed\n---\n").is_err());
        assert!(parse("---\n- a\n- b\n---\n").is_err());
        assert_eq!(parse("---\n---\nbody"), Ok(Note::Other));
    }

    #[test]
    fn workout_exercises_with_wrong_types_are_rejected() {
        let bad = |fm: &str| parse(&format!("---\ntype: workout\n{fm}\n---\n"));
        let wrong = |k: &'static str| Err(ParseError::WrongType(k));
        assert_eq!(bad("exercises: Squat 3 x 5 @ 100"), wrong("exercises"));
        assert_eq!(bad("exercises: {a: b}"), wrong("exercises"));
        assert_eq!(bad("exercises:\n  - 100"), wrong("exercises"));
        assert_eq!(bad("exercises:\n  - Squat: 5"), wrong("exercises"));
        assert_eq!(bad("exercises:\n  - [a]"), wrong("exercises"));
        assert_eq!(bad("deload: maybe"), wrong("deload"));
        assert_eq!(bad("week: three"), wrong("week"));
        assert!(matches!(bad("exercises: []"), Ok(Note::Workout(w)) if w.exercises.is_empty()));
        assert!(matches!(bad("exercises:"), Ok(Note::Workout(w)) if w.exercises.is_empty()));
    }

    proptest! {
        #[test]
        fn exercise_parser_never_panics_and_keeps_invariants(line in ".*") {
            let e = parse_exercise(&line);
            prop_assert_eq!(&e.raw, &line);
            if let Some(kg) = e.kg {
                prop_assert!(kg.is_finite() && (0.0..=1000.0).contains(&kg));
            }
            if let Some(s) = e.sets { prop_assert!((0..=100).contains(&s)); }
            if let Some(r) = e.reps { prop_assert!((0..=1000).contains(&r)); }
            prop_assert_eq!(e.name.trim(), e.name.as_str());
        }

        #[test]
        fn exercise_parser_survives_structured_noise(
            line in "[A-Za-z0-9 x×X@,.+kgKG日é-]{0,60}"
        ) {
            let e = parse_exercise(&line);
            prop_assert_eq!(e.raw, line);
        }

        #[test]
        fn well_formed_lines_round_trip(
            name in "[A-Za-z][A-Za-z ]{0,20}[A-Za-z]",
            sets in 0i64..=100,
            reps in 0i64..=1000,
            tenths in 0u32..=10_000,
            sep in prop::sample::select(vec!["x", "X", "×"]),
            comma in any::<bool>(),
            suffix in prop::sample::select(vec!["", "kg", " kg", "KG"]),
        ) {
            let kg = f64::from(tenths) / 10.0;
            let mut num = format!("{kg:.1}");
            if comma { num = num.replace('.', ","); }
            let line = format!("{name} {sets} {sep} {reps} @ {num}{suffix}");
            let e = parse_exercise(&line);
            prop_assert_eq!(e.name, name);
            prop_assert_eq!(e.sets, Some(sets));
            prop_assert_eq!(e.reps, Some(reps));
            prop_assert_eq!(e.kg, Some(kg));
        }

        #[test]
        fn plan_parser_never_panics(fm in "[ -~\n]{0,200}") {
            let _ = parse(&format!("---\ntype: plan\n{fm}\n---\n"));
        }
    }
}
