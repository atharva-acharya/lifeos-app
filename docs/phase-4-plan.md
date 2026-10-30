# Phase 4 plan: Money

Status: started 2026-10-30. The owner asked for phase 4 to go ahead without further sign-off; the choices below are the delivery team's, within requirements §3.8.

Goal (requirements §3.8, §7): a budget tracker in the vault, bill splitting and income analytics, built on safe note writing (ADR 0003 §3, §4), which the phase 5 editor reuses. Ends with `v0.4.0`.

## Where money lives in the vault

- **Ledger:** notes with `type: ledger`, one per month by default (`Money/Ledger/2026-10.md`), each holding one table: `| Date | Description | Category | Amount | Account |`. Amounts are pounds, negative for money out. Columns are matched by name, so the owner may reorder them or add their own; a row's month comes from its date, not the file name.
- **Budgets:** `Money/Budgets.md` with `type: budgets` and a `| Category | Monthly limit |` table. Categories match ledger categories case-insensitively.
- The index stores amounts as whole pence; nothing is rounded through floating point.

## Safe writing

`vault::write` adds one table row: path guard, folders created inside the vault without following links, temp file in the same folder, flush, re-read and compare a SHA-256 of the note just before an atomic rename (any change by Obsidian is a conflict, never a merge), and creation through a hard link so an existing note is never overwritten. Every byte outside the new row is kept; line endings follow the note. Cells lose `|`, line breaks and control characters, and are clipped to 200 characters.

## Pull requests

| PR  | Scope                                                                                                                                                                                                                                                                                      | Done when                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Ledger, budgets, quick add.** Safe writer; ledger and budget parsing and index; Money page with month switcher, spent / income / net / savings rate, budgets coloured green under 80%, orange to 100%, red over; quick add (money out or in) writing to the month's ledger; sample data. | Writer unit tests (round trip, conflict, no overwrite, guard); money totals tested; e2e adds a row in the real vault and checks the file |
| B   | **CSV import.** Bank statement CSV, column mapping saved per bank in local settings, preview, duplicates (same date, amount and description already in the ledger) skipped, rows written through the safe writer.                                                                          | Parser and mapping tests on synthetic CSVs; size caps; duplicates skipped on re-import                                                   |
| C   | **Bill splitting.** Split an expense equally, by amount or by share; running balance per friend; settle-ups. Stored in the ledger (`Split` column) and `Money/Friends.md`.                                                                                                                 | Balance maths tested to the penny; settle-up clears a balance                                                                            |
| D   | **Income analytics.** Income by source and month, savings rate over time, spending by category over time, month-on-month comparison. Version 0.4.0.                                                                                                                                        | Charts tested; e2e covers Money                                                                                                          |

## Not in phase 4

Bank linking (deferred), editing or deleting ledger rows from the app (phase 5 editor).
