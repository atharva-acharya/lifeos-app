//! Money page (requirements §3.8): one month's spending and income from the
//! ledger notes, budgets by category, and quick add, which writes a row to
//! `Money/Ledger/YYYY-MM.md` through the safe writer (ADR 0003).

use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::index::Index;
use crate::vault::note::{
    ACCOUNT_HEADERS, AMOUNT_HEADERS, CATEGORY_HEADERS, DATE_HEADERS, DESCRIPTION_HEADERS,
    LEDGER_COLUMNS, MAX_AMOUNT_PENCE, format_pence, is_iso_date,
};
use crate::vault::write::{self, MAX_CELL_CHARS, Value, WriteError, WriteRecord};

/// Category for rows that have none.
pub const UNCATEGORISED: &str = "Uncategorised";
/// Most transactions sent to the page for one month.
const MAX_ROWS: i64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BudgetStatus {
    Under,
    Near,
    Over,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetLine {
    pub category: String,
    /// Pence.
    pub limit: i64,
    pub spent: i64,
    pub status: BudgetStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryLine {
    pub category: String,
    /// Pence spent (positive).
    pub spent: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub date: String,
    pub description: String,
    pub category: Option<String>,
    pub amount: i64,
    pub account: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Money {
    /// `YYYY-MM`.
    pub month: String,
    /// Months that have transactions, newest first.
    pub months: Vec<String>,
    /// Pence in and out this month (both positive).
    pub income: i64,
    pub spent: i64,
    pub budgets: Vec<BudgetLine>,
    /// Spending by category, largest first.
    pub categories: Vec<CategoryLine>,
    /// This month's transactions, newest first.
    pub transactions: Vec<Row>,
    /// Every category name seen in budgets or the ledger, for quick add.
    pub known_categories: Vec<String>,
    pub has_ledger: bool,
    pub has_budgets: bool,
    pub parse_errors: i64,
    /// The six months ending with `month`, oldest first, for the charts.
    pub trend: Vec<MonthTotals>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthTotals {
    pub month: String,
    /// Pence in and out (both positive).
    pub income: i64,
    pub spent: i64,
    /// Spending by category, largest first.
    pub spending: Vec<CategoryLine>,
    /// Income by source (its category), largest first.
    pub income_by_source: Vec<CategoryLine>,
}

/// Months shown in the trend charts.
pub const TREND_MONTHS: i32 = 6;

/// `YYYY-MM` moved by `by` months.
pub fn shift_month(month: &str, by: i32) -> String {
    let y: i32 = month[..4].parse().unwrap_or(1970);
    let m: i32 = month[5..7].parse().unwrap_or(1);
    let total = y * 12 + (m - 1) + by;
    format!(
        "{:04}-{:02}",
        total.div_euclid(12),
        total.rem_euclid(12) + 1
    )
}

/// Sums by category for one month: money out (`sign` -1) or in (`sign` 1).
fn by_category(
    conn: &rusqlite::Connection,
    like: &str,
    sign: i64,
) -> rusqlite::Result<Vec<CategoryLine>> {
    conn.prepare(
        "SELECT COALESCE(category, ?2) AS c, SUM(amount) * ?3 AS s FROM ledger
         WHERE date LIKE ?1 AND amount * ?3 > 0
         GROUP BY lower(c) ORDER BY s DESC, c",
    )?
    .query_map(params![like, UNCATEGORISED, sign], |r| {
        Ok(CategoryLine {
            category: r.get(0)?,
            spent: r.get(1)?,
        })
    })?
    .collect()
}

fn trend(conn: &rusqlite::Connection, month: &str) -> rusqlite::Result<Vec<MonthTotals>> {
    (1 - TREND_MONTHS..=0)
        .map(|by| {
            let m = shift_month(month, by);
            let like = format!("{m}-%");
            let spending = by_category(conn, &like, -1)?;
            let income_by_source = by_category(conn, &like, 1)?;
            Ok(MonthTotals {
                income: income_by_source.iter().map(|c| c.spent).sum(),
                spent: spending.iter().map(|c| c.spent).sum(),
                month: m,
                spending,
                income_by_source,
            })
        })
        .collect()
}

pub fn is_month(s: &str) -> bool {
    s.len() == 7 && is_iso_date(&format!("{s}-01"))
}

/// Green under 80% of the limit, orange from 80% to the limit, red over it.
fn status(spent: i64, limit: i64) -> BudgetStatus {
    if spent > limit {
        BudgetStatus::Over
    } else if i128::from(spent) * 5 >= i128::from(limit) * 4 {
        BudgetStatus::Near
    } else {
        BudgetStatus::Under
    }
}

/// The money view for `month` (`YYYY-MM`). Spending counts money out only:
/// a refund is money in, so it raises income and does not lower a
/// category's spending.
pub fn money(index: &Index, month: &str) -> rusqlite::Result<Money> {
    let conn = index.conn();
    let like = format!("{month}-%");

    let months: Vec<String> = conn
        .prepare("SELECT DISTINCT substr(date, 1, 7) AS m FROM ledger ORDER BY m DESC")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;

    let (income, spent): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0),
                COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0)
         FROM ledger WHERE date LIKE ?1",
        params![like],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let categories = by_category(conn, &like, -1)?;

    let mut budgets: Vec<BudgetLine> = Vec::new();
    let rows = conn
        .prepare("SELECT category, monthly_limit FROM budget ORDER BY path, position")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (category, limit) in rows {
        if budgets
            .iter()
            .any(|b| b.category.eq_ignore_ascii_case(&category))
        {
            continue;
        }
        let spent = categories
            .iter()
            .find(|c| c.category.eq_ignore_ascii_case(&category))
            .map_or(0, |c| c.spent);
        budgets.push(BudgetLine {
            status: status(spent, limit),
            category,
            limit,
            spent,
        });
    }

    let transactions: Vec<Row> = conn
        .prepare(
            "SELECT date, description, category, amount, account FROM ledger
             WHERE date LIKE ?1 ORDER BY date DESC, path DESC, position DESC LIMIT ?2",
        )?
        .query_map(params![like, MAX_ROWS], |r| {
            Ok(Row {
                date: r.get(0)?,
                description: r.get(1)?,
                category: r.get(2)?,
                amount: r.get(3)?,
                account: r.get(4)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let mut known_categories: Vec<String> = budgets.iter().map(|b| b.category.clone()).collect();
    let used: Vec<String> = conn
        .prepare(
            "SELECT DISTINCT category FROM ledger WHERE category IS NOT NULL ORDER BY category",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for c in used {
        if !known_categories.iter().any(|k| k.eq_ignore_ascii_case(&c)) {
            known_categories.push(c);
        }
    }

    let count = |kind: &str| -> rusqlite::Result<bool> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM notes WHERE kind = ?1)",
            params![kind],
            |r| r.get(0),
        )
    };
    let parse_errors: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE error IS NOT NULL AND path LIKE 'Money/%'",
        [],
        |r| r.get(0),
    )?;

    Ok(Money {
        month: month.to_owned(),
        months,
        income,
        spent,
        budgets,
        categories,
        transactions,
        known_categories,
        has_ledger: count("ledger")?,
        has_budgets: count("budgets")?,
        parse_errors,
        trend: trend(conn, month)?,
    })
}

/// A transaction from the quick-add form. `amount` is in pence: negative
/// for money out.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewTransaction {
    pub date: String,
    pub description: String,
    pub category: Option<String>,
    pub amount: i64,
    pub account: Option<String>,
}

fn text_ok(s: &str, max: usize) -> bool {
    let n = write::cell(s).chars().count();
    n > 0 && n <= max && s.chars().count() <= MAX_CELL_CHARS
}

impl NewTransaction {
    /// Checks the form's values; the message is shown in the UI.
    pub fn validate(&self) -> Result<(), String> {
        if !is_iso_date(&self.date) {
            return Err("Date must look like 2026-10-29.".into());
        }
        if !text_ok(&self.description, MAX_CELL_CHARS) {
            return Err("Add a short description.".into());
        }
        if self.amount == 0 || self.amount.abs() > MAX_AMOUNT_PENCE {
            return Err("Amount must be more than £0 and at most £10,000,000.".into());
        }
        for (name, value) in [("Category", &self.category), ("Account", &self.account)] {
            if let Some(v) = value
                && !v.trim().is_empty()
                && !text_ok(v, 60)
            {
                return Err(format!("{name} must be 60 characters or fewer."));
            }
        }
        Ok(())
    }

    /// The vault-relative ledger note for this transaction's month.
    pub fn ledger_path(&self) -> String {
        format!("Money/Ledger/{}.md", &self.date[..7])
    }
}

/// Appends `t` to its month's ledger note, creating the note if needed.
/// Returns the hashes for the write log.
pub fn add(vault: &Path, t: &NewTransaction) -> Result<WriteRecord, String> {
    t.validate()?;
    let opt = |v: &Option<String>| v.as_deref().map(str::trim).unwrap_or_default().to_owned();
    let values: [Value<'_>; 5] = [
        (DATE_HEADERS, t.date.clone()),
        (DESCRIPTION_HEADERS, t.description.clone()),
        (CATEGORY_HEADERS, opt(&t.category)),
        (AMOUNT_HEADERS, format_pence(t.amount)),
        (ACCOUNT_HEADERS, opt(&t.account)),
    ];
    let front = format!("type: ledger\nmonth: {}", &t.date[..7]);
    write::append_row(vault, &t.ledger_path(), &front, LEDGER_COLUMNS, &values).map_err(|e| match e
    {
        WriteError::Conflict | WriteError::NoColumn(_) => e.to_string(),
        other => format!("Could not save: {other}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tx(date: &str, amount: i64, category: Option<&str>) -> NewTransaction {
        NewTransaction {
            date: date.to_owned(),
            description: "Test".to_owned(),
            category: category.map(str::to_owned),
            amount,
            account: None,
        }
    }

    fn vault() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        fs::create_dir_all(root.join("Money")).expect("mkdir");
        fs::write(
            root.join("Money/Budgets.md"),
            "---\ntype: budgets\n---\n| Category | Monthly limit |\n| --- | --- |\n| Groceries | 300 |\n| Eating out | 100 |\n| Transport | 80 |\n",
        )
        .expect("budgets");
        (dir, root)
    }

    #[test]
    fn validates_the_form() {
        assert!(tx("2026-10-30", -350, None).validate().is_ok());
        assert!(tx("2026-13-01", -350, None).validate().is_err());
        assert!(tx("2026-10-30", 0, None).validate().is_err());
        assert!(
            tx("2026-10-30", MAX_AMOUNT_PENCE + 1, None)
                .validate()
                .is_err()
        );
        let mut t = tx("2026-10-30", -1, None);
        t.description = " \r\n\t ".to_owned();
        assert!(
            t.validate().is_err(),
            "a blank description is empty once cleaned"
        );
        t.description = "x".repeat(MAX_CELL_CHARS + 1);
        assert!(t.validate().is_err());
        let mut t = tx("2026-10-30", -1, Some(&"c".repeat(61)));
        assert!(t.validate().is_err());
        t.category = Some("  ".to_owned());
        assert!(t.validate().is_ok(), "a blank category is no category");
    }

    #[test]
    fn quick_add_writes_rows_and_the_month_adds_up() {
        let (_dir, root) = vault();
        for t in [
            tx("2026-10-02", -12_000, Some("Groceries")),
            tx("2026-10-05", -15_000, Some("groceries")),
            tx("2026-10-06", -9_000, Some("Eating out")),
            tx("2026-10-07", -10_000, Some("Transport")),
            tx("2026-10-08", -2_500, None),
            tx("2026-10-25", 240_000, Some("Salary")),
            tx("2026-09-30", -99_900, Some("Groceries")),
        ] {
            add(&root, &t).expect("add");
        }
        assert!(root.join("Money/Ledger/2026-09.md").exists());
        let text = fs::read_to_string(root.join("Money/Ledger/2026-10.md")).expect("read");
        assert!(text.starts_with("---\ntype: ledger\nmonth: 2026-10\n---\n"));
        assert!(text.contains("| 2026-10-25 | Test | Salary | 2400.00 |  |"));

        let mut index = Index::open_in_memory().expect("index");
        index.sync(&root).expect("sync");
        let m = money(&index, "2026-10").expect("money");
        assert_eq!(m.months, vec!["2026-10", "2026-09"]);
        assert_eq!((m.income, m.spent), (240_000, 48_500));
        let line = |c: &str| m.budgets.iter().find(|b| b.category == c).expect(c).clone();
        assert_eq!(line("Groceries").spent, 27_000);
        assert_eq!(line("Groceries").status, BudgetStatus::Near);
        assert_eq!(line("Eating out").status, BudgetStatus::Near);
        assert_eq!(line("Transport").status, BudgetStatus::Over);
        assert_eq!(m.categories[0].spent, 27_000);
        assert!(m.categories.iter().any(|c| c.category == UNCATEGORISED));
        assert_eq!(m.transactions.len(), 6);
        assert_eq!(m.transactions[0].date, "2026-10-25");
        assert!(m.known_categories.contains(&"Salary".to_owned()));
        assert!(m.has_ledger && m.has_budgets);
        assert_eq!(m.parse_errors, 0);

        let months: Vec<&str> = m.trend.iter().map(|t| t.month.as_str()).collect();
        assert_eq!(
            months,
            [
                "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"
            ]
        );
        let (sep, oct) = (&m.trend[4], &m.trend[5]);
        assert_eq!((sep.income, sep.spent), (0, 99_900));
        assert_eq!((oct.income, oct.spent), (240_000, 48_500));
        assert_eq!(oct.income_by_source[0].category, "Salary");
        assert_eq!(oct.spending, m.categories);
        assert!(m.trend[0].spending.is_empty());
    }

    #[test]
    fn an_empty_vault_has_no_money_yet() {
        let index = Index::open_in_memory().expect("index");
        let m = money(&index, "2026-10").expect("money");
        assert!(!m.has_ledger && !m.has_budgets);
        assert_eq!((m.income, m.spent), (0, 0));
        assert!(m.transactions.is_empty() && m.months.is_empty());
    }

    #[test]
    fn amounts_parse_to_pence_and_back() {
        use crate::vault::note::parse_pence;
        for (text, pence) in [
            ("-12.50", -1250),
            ("£1,234", 123_400),
            ("−£3.2", -320),
            ("+40", 4000),
            (".5", 50),
            ("0.07", 7),
        ] {
            assert_eq!(parse_pence(text), Some(pence), "{text}");
            assert_eq!(parse_pence(&format_pence(pence)), Some(pence));
        }
        for bad in [
            "",
            "-",
            "12.345",
            "1e5",
            "12,50.0.1",
            "abc",
            "£",
            "99999999999999",
        ] {
            assert_eq!(parse_pence(bad), None, "{bad}");
        }
        assert_eq!(parse_pence("10000000"), Some(MAX_AMOUNT_PENCE));
        assert_eq!(parse_pence("10000000.01"), None);
    }

    #[test]
    fn ledger_and_budget_tables_follow_their_headers() {
        use crate::vault::note::{Note, parse};
        let ledger = "---\ntype: ledger\n---\n| Amount | Payee | Date | Category |\n|---|---|---|---|\n| -9.99 | `Netflix` | 2026-10-03 | Subscriptions |\n| oops | Bad amount | 2026-10-04 | x |\n| 5 | Bad date | 2026-13-01 | x |\n| 20 | | 2026-10-05 | |\n";
        let Ok(Note::Ledger(rows)) = parse(ledger) else {
            panic!("ledger");
        };
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].description, "Netflix");
        assert_eq!(
            (rows[0].amount, rows[0].category.as_deref()),
            (-999, Some("Subscriptions"))
        );
        assert_eq!(
            (rows[1].description.as_str(), rows[1].category.as_deref()),
            ("", None)
        );

        let budgets = "---\ntype: budgets\n---\n| Category | Limit |\n|---|---|\n| Food | 200 |\n| food | 250 |\n| Fun | 0 |\n| Rent | -1 |\n| | 50 |\n";
        let Ok(Note::Budgets(rows)) = parse(budgets) else {
            panic!("budgets");
        };
        assert_eq!(
            rows.len(),
            1,
            "later rows replace, zero and negative limits are dropped"
        );
        assert_eq!((rows[0].category.as_str(), rows[0].limit), ("Food", 25_000));
    }

    #[test]
    fn months_shift_across_years() {
        assert_eq!(shift_month("2026-01", -1), "2025-12");
        assert_eq!(shift_month("2026-12", 1), "2027-01");
        assert_eq!(shift_month("2026-10", -5), "2026-05");
        assert_eq!(shift_month("2026-03", -15), "2024-12");
    }

    #[test]
    fn months_are_checked() {
        assert!(is_month("2026-10"));
        for bad in ["2026-13", "2026-1", "26-10", "2026-10-01", "2026_10"] {
            assert!(!is_month(bad), "{bad}");
        }
    }
}
