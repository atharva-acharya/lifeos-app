//! Bill splitting (requirements §3.8). `Money/Splits.md` holds one table of
//! what each friend owes the owner: positive when the friend owes, negative
//! when the owner owes. A split adds one row per friend; a settle-up adds
//! the opposite amount. Splits stay apart from the ledger, which records
//! what really left the bank (quick add or a statement import).

use std::path::Path;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::index::Index;
use crate::vault::note::{
    AMOUNT_HEADERS, DATE_HEADERS, DESCRIPTION_HEADERS, FRIEND_HEADERS, MAX_AMOUNT_PENCE,
    SPLIT_COLUMNS, SplitRow, format_pence, is_iso_date,
};
use crate::vault::write::{self, MAX_CELL_CHARS, Value, WriteRecord, cell};

pub const SPLITS_NOTE: &str = "Money/Splits.md";
const FRONT: &str = "type: splits";
const MAX_FRIENDS: usize = 20;
const MAX_NAME_CHARS: usize = 60;
const MAX_SHARE_WEIGHT: i64 = 1_000;
/// Recent split rows sent to the page.
const RECENT: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Method {
    Equal,
    /// Each person's amount in pence; they must add up to the total.
    Amounts,
    /// Each person's whole-number share (1 to 1000).
    Shares,
}

/// One person in a split. `name` is `None` for the owner.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Person {
    pub name: Option<String>,
    #[serde(default)]
    pub value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewSplit {
    pub date: String,
    pub description: String,
    /// Pence, positive.
    pub total: i64,
    /// Who paid: `None` for the owner, or one of the friends.
    pub paid_by: Option<String>,
    pub method: Method,
    pub people: Vec<Person>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendBalance {
    pub friend: String,
    /// Pence the friend owes the owner (negative: the owner owes them).
    pub balance: i64,
    pub last_date: String,
}

/// Splits `total` pence by whole-number `weights`. Each share is rounded
/// down and the leftover pence go one each to the first people, so the
/// shares always add up to the total exactly.
pub fn by_weight(total: i64, weights: &[i64]) -> Vec<i64> {
    let sum: i128 = weights.iter().map(|w| i128::from(*w)).sum();
    if sum <= 0 {
        return vec![0; weights.len()];
    }
    let mut shares: Vec<i64> = weights
        .iter()
        .map(|w| i64::try_from(i128::from(total) * i128::from(*w) / sum).unwrap_or(0))
        .collect();
    let mut left = total - shares.iter().sum::<i64>();
    for (s, w) in shares.iter_mut().zip(weights) {
        if left == 0 {
            break;
        }
        if *w > 0 {
            *s += 1;
            left -= 1;
        }
    }
    shares
}

fn clean_name(name: &str) -> Result<String, String> {
    let n = cell(name);
    if n.is_empty() || n.chars().count() > MAX_NAME_CHARS {
        return Err("Each friend needs a name of up to 60 characters.".into());
    }
    Ok(n)
}

fn check_date(date: &str) -> Result<(), String> {
    if is_iso_date(date) {
        Ok(())
    } else {
        Err("Date must look like 2026-10-29.".into())
    }
}

impl NewSplit {
    /// Each person's share in pence, in the order given (the owner as `None`).
    pub fn shares(&self) -> Result<Vec<(Option<String>, i64)>, String> {
        check_date(&self.date)?;
        let description = cell(&self.description);
        if description.is_empty() || self.description.chars().count() > MAX_CELL_CHARS {
            return Err("Add a short description.".into());
        }
        if self.total <= 0 || self.total > MAX_AMOUNT_PENCE {
            return Err("The total must be more than £0 and at most £10,000,000.".into());
        }
        let mut names: Vec<Option<String>> = Vec::with_capacity(self.people.len());
        for p in &self.people {
            let name = p.name.as_deref().map(clean_name).transpose()?;
            let taken = names.iter().any(|n| match (n, &name) {
                (None, None) => true,
                (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                _ => false,
            });
            if taken {
                return Err("Each person can only be in a split once.".into());
            }
            names.push(name);
        }
        let friends = names.iter().filter(|n| n.is_some()).count();
        if friends == 0 || friends > MAX_FRIENDS {
            return Err(format!("Add between 1 and {MAX_FRIENDS} friends."));
        }
        let amounts = match self.method {
            Method::Equal => by_weight(self.total, &vec![1; names.len()]),
            Method::Shares => {
                if self
                    .people
                    .iter()
                    .any(|p| !(1..=MAX_SHARE_WEIGHT).contains(&p.value))
                {
                    return Err("Shares must be whole numbers from 1 to 1000.".into());
                }
                let weights: Vec<i64> = self.people.iter().map(|p| p.value).collect();
                by_weight(self.total, &weights)
            }
            Method::Amounts => {
                if self
                    .people
                    .iter()
                    .any(|p| p.value < 0 || p.value > self.total)
                {
                    return Err("Amounts must be between £0 and the total.".into());
                }
                let sum: i64 = self.people.iter().map(|p| p.value).sum();
                if sum != self.total {
                    return Err(format!(
                        "The amounts add up to {}, not the total of {}.",
                        format_pence(sum),
                        format_pence(self.total)
                    ));
                }
                self.people.iter().map(|p| p.value).collect()
            }
        };
        Ok(names.into_iter().zip(amounts).collect())
    }

    /// The splits rows this adds: each friend's share when the owner paid,
    /// or what the owner owes the friend who paid.
    pub fn rows(&self) -> Result<Vec<SplitRow>, String> {
        let shares = self.shares()?;
        let description = cell(&self.description);
        let row = |friend: &str, amount: i64| SplitRow {
            date: self.date.clone(),
            description: description.clone(),
            friend: friend.to_owned(),
            amount,
        };
        match self.paid_by.as_deref().map(clean_name).transpose()? {
            None => Ok(shares
                .iter()
                .filter_map(|(name, share)| name.as_deref().map(|n| row(n, *share)))
                .filter(|r| r.amount != 0)
                .collect()),
            Some(payer) => {
                let payer = shares
                    .iter()
                    .find_map(|(n, _)| n.as_ref().filter(|n| n.eq_ignore_ascii_case(&payer)))
                    .ok_or("The person who paid must be in the split.")?;
                let mine = shares
                    .iter()
                    .find(|(n, _)| n.is_none())
                    .map(|(_, s)| *s)
                    .ok_or("Add yourself to the split, or choose that you paid.")?;
                Ok(if mine == 0 {
                    Vec::new()
                } else {
                    vec![row(payer, -mine)]
                })
            }
        }
    }
}

fn values(rows: &[SplitRow]) -> Vec<Vec<Value<'static>>> {
    rows.iter()
        .map(|r| {
            vec![
                (DATE_HEADERS, r.date.clone()),
                (DESCRIPTION_HEADERS, r.description.clone()),
                (FRIEND_HEADERS, r.friend.clone()),
                (AMOUNT_HEADERS, format_pence(r.amount)),
            ]
        })
        .collect()
}

fn append(vault: &Path, rows: &[SplitRow]) -> Result<Option<WriteRecord>, String> {
    if rows.is_empty() {
        return Ok(None);
    }
    write::append_rows(vault, SPLITS_NOTE, FRONT, SPLIT_COLUMNS, &values(rows))
        .map(Some)
        .map_err(|e| format!("Could not save: {e}"))
}

/// Adds a split to `Money/Splits.md`.
pub fn add(vault: &Path, split: &NewSplit) -> Result<Option<WriteRecord>, String> {
    append(vault, &split.rows()?)
}

/// Records a settle-up: `amount` pence that clears what the friend owes
/// (negative) or what the owner owes them (positive).
pub fn settle(
    vault: &Path,
    friend: &str,
    amount: i64,
    date: &str,
) -> Result<Option<WriteRecord>, String> {
    check_date(date)?;
    if amount == 0 || amount.abs() > MAX_AMOUNT_PENCE {
        return Err("The amount must be more than £0 and at most £10,000,000.".into());
    }
    let row = SplitRow {
        date: date.to_owned(),
        description: "Settle-up".to_owned(),
        friend: clean_name(friend)?,
        amount,
    };
    append(vault, &[row])
}

/// Each friend's running balance, largest first, and the latest rows.
pub fn balances(index: &Index) -> rusqlite::Result<(Vec<FriendBalance>, Vec<SplitRow>)> {
    let conn = index.conn();
    let friends = conn
        .prepare(
            "SELECT MIN(friend), SUM(amount) AS b, MAX(date) FROM split
             GROUP BY lower(friend) ORDER BY abs(b) DESC, MIN(friend)",
        )?
        .query_map([], |r| {
            Ok(FriendBalance {
                friend: r.get(0)?,
                balance: r.get(1)?,
                last_date: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    let recent = conn
        .prepare(
            "SELECT date, description, friend, amount FROM split
             ORDER BY date DESC, path DESC, position DESC LIMIT ?1",
        )?
        .query_map(params![RECENT], |r| {
            Ok(SplitRow {
                date: r.get(0)?,
                description: r.get(1)?,
                friend: r.get(2)?,
                amount: r.get(3)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok((friends, recent))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn me(value: i64) -> Person {
        Person { name: None, value }
    }

    fn friend(name: &str, value: i64) -> Person {
        Person {
            name: Some(name.to_owned()),
            value,
        }
    }

    fn split(total: i64, method: Method, people: Vec<Person>) -> NewSplit {
        NewSplit {
            date: "2026-10-30".into(),
            description: "Dinner".into(),
            total,
            paid_by: None,
            method,
            people,
        }
    }

    #[test]
    fn weights_add_up_to_the_penny() {
        assert_eq!(by_weight(1000, &[1, 1, 1]), vec![334, 333, 333]);
        assert_eq!(by_weight(1, &[1, 1]), vec![1, 0]);
        assert_eq!(by_weight(1000, &[2, 1, 1]), vec![500, 250, 250]);
        assert_eq!(by_weight(999, &[0, 1]), vec![0, 999]);
        for total in [1, 7, 100, 12_345, MAX_AMOUNT_PENCE] {
            for w in [vec![1, 1, 1], vec![3, 7], vec![1, 2, 3, 4, 5, 6, 7]] {
                assert_eq!(by_weight(total, &w).iter().sum::<i64>(), total);
            }
        }
    }

    #[test]
    fn owner_paid_equal_split_gives_each_friend_their_share() {
        let s = split(
            10_000,
            Method::Equal,
            vec![me(0), friend("Sam", 0), friend("Alex", 0)],
        );
        let rows = s.rows().expect("rows");
        let owed: Vec<(&str, i64)> = rows.iter().map(|r| (r.friend.as_str(), r.amount)).collect();
        assert_eq!(owed, vec![("Sam", 3333), ("Alex", 3333)]);
    }

    #[test]
    fn a_friend_who_paid_is_owed_the_owners_share() {
        let mut s = split(9_000, Method::Shares, vec![me(2), friend("Sam", 1)]);
        s.paid_by = Some("sam".into());
        let rows = s.rows().expect("rows");
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].friend.as_str(), rows[0].amount), ("Sam", -6000));
    }

    #[test]
    fn amounts_must_add_up_and_people_be_unique() {
        let ok = split(
            5_000,
            Method::Amounts,
            vec![me(2_000), friend("Sam", 3_000)],
        );
        assert_eq!(ok.rows().expect("rows")[0].amount, 3_000);
        let short = split(
            5_000,
            Method::Amounts,
            vec![me(2_000), friend("Sam", 2_000)],
        );
        assert!(short.rows().expect_err("short").contains("add up to 40.00"));
        let twice = split(
            5_000,
            Method::Equal,
            vec![friend("Sam", 0), friend("SAM", 0)],
        );
        assert!(twice.rows().is_err());
        let alone = split(5_000, Method::Equal, vec![me(0)]);
        assert!(alone.rows().is_err());
        let bad_share = split(5_000, Method::Shares, vec![me(0), friend("Sam", 1)]);
        assert!(bad_share.rows().is_err());
        let mut not_in = split(5_000, Method::Equal, vec![me(0), friend("Sam", 0)]);
        not_in.paid_by = Some("Alex".into());
        assert!(not_in.rows().is_err());
        let mut without_me = split(
            5_000,
            Method::Equal,
            vec![friend("Sam", 0), friend("Alex", 0)],
        );
        without_me.paid_by = Some("Sam".into());
        assert!(without_me.rows().is_err());
        let mut long = ok.clone();
        long.description = "x".repeat(MAX_CELL_CHARS + 1);
        assert!(long.rows().is_err());
    }

    #[test]
    fn splits_and_settle_ups_make_running_balances() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        add(
            &root,
            &split(
                9_000,
                Method::Equal,
                vec![me(0), friend("Sam", 0), friend("Alex", 0)],
            ),
        )
        .expect("split");
        let mut lunch = split(2_000, Method::Equal, vec![me(0), friend("alex", 0)]);
        lunch.paid_by = Some("Alex".into());
        add(&root, &lunch).expect("lunch");
        settle(&root, "Sam", -3_000, "2026-10-31").expect("settle");

        let text = fs::read_to_string(root.join(SPLITS_NOTE)).expect("read");
        assert!(
            text.starts_with("---\ntype: splits\n---\n\n| Date | Description | Friend | Amount |")
        );
        assert!(text.contains("| 2026-10-31 | Settle-up | Sam | -30.00 |"));

        let mut index = Index::open_in_memory().expect("index");
        index.sync(&root).expect("sync");
        let (friends, recent) = balances(&index).expect("balances");
        let b: Vec<(&str, i64)> = friends
            .iter()
            .map(|f| (f.friend.as_str(), f.balance))
            .collect();
        assert_eq!(b, vec![("Alex", 2_000), ("Sam", 0)]);
        assert_eq!(recent[0].description, "Settle-up");
        assert_eq!(recent.len(), 4);
    }

    #[test]
    fn settle_ups_are_checked() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = fs::canonicalize(dir.path()).expect("root");
        assert!(settle(&root, "Sam", 0, "2026-10-31").is_err());
        assert!(settle(&root, " ", 100, "2026-10-31").is_err());
        assert!(settle(&root, "Sam", 100, "31/10/2026").is_err());
        assert!(!root.join(SPLITS_NOTE).exists());
    }
}
