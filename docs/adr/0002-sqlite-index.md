# ADR 0002: SQLite as a disposable index

Status: accepted · Date: 2026-10-29

## Context
Dashboards and search need fast queries across hundreds of notes. The vault files must stay the only source of truth (requirements §2).

## Decision
- One SQLite file in the app data folder (`%APPDATA%\lifeos-app\index.db`), never in the vault or the repo.
- Tables: `notes` (path, type, mtime, size, content hash, title), one typed table per note type (`daily`, `workout`, `company`, `weekly`, `project`) with the agreed fields, `project_steps`, `parse_errors`, and an FTS5 table for search (phase 4).
- **Build:** full scan on start; incremental updates from `notify` events, debounced 300 ms, keyed by mtime + hash so unchanged files are skipped.
- **Schema version** stored in `PRAGMA user_version`. On mismatch or corruption the file is deleted and rebuilt; no migrations needed.
- Notes that fail to parse are recorded in `parse_errors` and shown in the UI, never silently dropped.
- All SQL uses bound parameters; queries live in the Rust core only.

## Consequences
- Deleting the index loses nothing; worst case is one rebuild on next start.
- Start-up target (< 2 s) depends on incremental rebuild; a full rebuild of ~1,000 notes is budgeted at under 1 s and measured in CI with synthetic fixtures.
