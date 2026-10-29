# Life OS desktop app: requirements

Status: agreed 2026-10-29. Version 1 scope. Changes go through a new section at the end ("Change log"), never by silently editing the scope.

## 1. Purpose

A personal Windows desktop app over an existing Markdown + YAML note system (an Obsidian vault). It shows progress dashboards and lets the owner view and edit the notes, without replacing Obsidian. Built with production-grade engineering: CI/CD, security gates, tests and documented architecture.

## 2. Data

- **Source of truth:** the vault folder `Life OS` (path chosen on first run and kept in local app settings, never in the repo). The app reads and writes these files directly. No database is the source of truth.
- **Local index:** a SQLite cache built from the notes for fast dashboards and search. Rebuilt on start and on file change (file watcher). Deleting it loses nothing.
- **Note types and fields** (YAML front matter, exactly as below; never rename or add fields without a change log entry):
  - Daily `Daily/YYYY-MM-DD.md`: `type: daily`, `date`, `weight` (kg), `steps`, `protein_g`, `meals_tracked`, `gym`, `mobility` (bool), `applications`, `study_minutes`, `mood` (1-5)
  - Workout `Fitness/Log/`: `type: workout`, `date`, `day` (Push A / Pull A / Legs / Push B / Pull B), `week`, `deload`, `duration_min`, `exercises` (list of `name sets x reps @ kg`)
  - Company `Jobs/Companies/`: `type: company`, `company`, `role`, `stage` (applied / replied / screen / interview / offer / rejected), `applied`, `contact`, `next_action`, `next_date`
  - Weekly `Weekly/YYYY-Www.md`: `type: weekly`, `week`, `arc_week`, `avg_weight`, `weight_change`, `target_change`, `sessions`, `protein_days`, `avg_steps`, `applications`, `replies`, `study_hours`
  - Project tracker (new, see 3.4): `type: project`, `project`, `status`, `step`, `steps_total`, `next_step`, `updated`
- **Job applications:** read live from a Google Sheet (tab `Applications`; columns Applied, Company, Role, Source, Inbox, Status, Last update, Days since, Follow up?, Email, Notes, Message ID). Read-only OAuth scope. Sheet ID and credentials live in local settings, never in the repo.
- **Health data (Apple Health):** the owner's iPhone runs an auto-export app (Health Auto Export or equivalent) that writes daily JSON files to an iCloud Drive folder; iCloud for Windows syncs that folder to the PC. The app reads only that folder (path in local settings), read-only. Metrics: steps, active energy, resting heart rate, heart rate variability, sleep (duration and stages), body mass, workouts. The export files are the source of truth; the app indexes them.
- **Money data:** stored in the vault under `Money/`, so it stays with the owner's notes. Records: transaction (date, amount, direction income/expense, category, description, account, optional split: who shares it and each share), budget (month, category, limit), settle-up (date, friend, amount, direction). The exact file format is fixed in the phase 4 design note and recorded in this change log before build.
- **Privacy:** no telemetry, no cloud services other than the read-only Google Sheets API. Health files arrive through the owner's own iCloud Drive sync; the app itself makes no new network calls. No bank connections. Personal data never enters the repository, tests or screenshots (tests use synthetic fixtures).

## 3. Modules (version 1)

### 3.1 Today (home)
- Greeting with date; cards: follow-ups due, today's weight with change, applications today, gym session of the day, habit ticks (weigh-in, steps, protein, meals, mobility).
- Lists: company notes with `next_date` on or before today; the active project's "resume here" step.

### 3.2 Job search
- Applications table from the Sheet: filter by status and source, sort, search; counts by stage.
- Company notes (stage pipeline view: applied, replied, screen, interview, offer, rejected) with next action and date.
- Outreach log (`Jobs/Outreach.md`): who, when, status (sent / accepted / replied).
- Charts: applications per week, reply rate by source (company site vs Easy Apply vs agency).

### 3.3 Fitness
- Weight trend (daily points, 7-day average, target line), steps, protein days.
- Workout history per session type; lift progress per exercise (top set over time).

### 3.4 Projects tracker
- One note per project with an ordered step list (`- [ ] step` / `- [x] step`) and a dated log section.
- Shows current step, progress bar, "resume here" (next unchecked step and last log entry), so work can continue in a later session.
- The tracker file is plain Markdown, readable by the owner and by tools.

### 3.5 Editor
- Any note opens in an editor: YAML fields as typed form controls (numbers, dates, booleans, enums from the lists above), the body as Markdown with live preview.
- Saves preserve unknown fields, field order and the body byte-for-byte where untouched (round-trip safe with Obsidian).
- External change while editing: warn and offer reload or keep mine; never overwrite silently.

### 3.6 Search
- Ctrl+K command palette: notes, companies, projects, and actions (new daily note, log weight).

### 3.7 Health
- Apple-inspired design within design A: activity rings (steps, active energy, sleep goal), spring animations on cards and charts, smooth transitions between day, week and month; all motion respects "reduce motion".
- Today ring summary; trends for resting heart rate, HRV, sleep (duration and stages) and weight; workouts imported from Apple Health alongside vault workout logs.
- Shows when the last export arrived, and a clear message if the export folder goes stale.

### 3.8 Money (budget tracker)
- Quick add for expenses and income; import of bank statement CSVs (column mapping saved per bank; duplicates skipped).
- Monthly budgets by category: spent vs limit, colour-coded (green under, orange near, red over).
- Bill splitting: split an expense with friends (equal, by amount or by share); running balance per friend ("Sam owes you £12"); record settle-ups.
- Income analytics: income by source and month, savings rate, spending by category over time, month-on-month comparison.

## 4. Design (option A, "studio dark")

- Dark UI: page `#141414`, sidebar `#1b1b1b`, cards `#232323` with `#333` border, 12px radius.
- Font: Segoe UI Variable (fallback Segoe UI); comfortable sizes, nothing below 12px; uppercase spaced kickers for section labels.
- Colour meaning, used consistently: purple = read/viewed, orange = in progress/editing/due, green = done/positive, yellow = pending, red = destructive.
- File-type and category badges; rounded status pills.
- The active item (current project step, item being edited) has a slow breathing highlight; respects "reduce motion".
- Left sidebar: Today, Jobs, Fitness, Health, Money, Projects, Search; settings at the bottom.

## 5. Non-functional

- Windows 10/11, offline-first; starts in under 2 s on a normal laptop.
- Never deletes notes; "delete" moves a file to an `old/` folder in the vault.
- Accessible: keyboard navigation for every action, visible focus, text contrast AA.
- Tauri allowlist kept minimal; file access limited to the configured vault folder; strict content security policy.

## 6. Engineering

- **Stack:** Tauri 2 (Rust core) + TypeScript + React + Vite; SQLite via Rust; charts via a maintained library; tests with Vitest (UI) and `cargo test` (core); Playwright for end-to-end.
- **Repository:** public GitHub. Trunk-based: short-lived feature branches, pull requests into `main`, `main` protected (checks must pass).
- **CI on every pull request:** format check, lint (ESLint, Clippy), type-check, unit tests, build; security: CodeQL, Semgrep, dependency audit (`npm audit`, `cargo audit`), secret scanning, Dependabot.
- **Release on version tag:** build a signed Windows installer, SBOM (CycloneDX), changelog from commit messages (Conventional Commits), GitHub Release with checksums.
- **Docs:** README with screenshots (synthetic data), architecture decision records in `docs/adr/`, `docs/threat-model.md`, `SECURITY.md`.

## 7. Phases

1. **Foundation:** repo, CI/CD with all gates green, app shell (sidebar, theme, settings), vault reader + SQLite index, Today page. *(Released as v0.1.0.)*
2. **Jobs:** Sheets integration, pipeline view, outreach log, job charts.
3. **Fitness, Health + Projects:** fitness charts, Apple Health import and Health section, projects tracker and resume-here.
4. **Money:** budget tracker, bill splitting, income analytics; introduces safe note writing (atomic, round-trip safe) that the editor reuses.
5. **Editor + search:** forms + Markdown editor, Ctrl+K, release 1.0.

### Deferred (not in version 1)
- Live workout logging (Hevy/Strong style): belongs in a future iOS app, where logging happens at the gym.
- Mail viewer (Gmail): revisit after the Sheet-based job search is in use.
- Bank account linking (Open Banking): CSV import covers version 1.

Each phase ends with a working, released build and owner sign-off before the next starts.

## Change log

- 2026-10-29: version 1 scope agreed (design A).
- 2026-10-29: Default vault path removed from this document (kept in local settings only, per privacy rule). No functional change.
- 2026-10-29: Scope change agreed with owner after v0.1.0. Added Health section with Apple Health import via an iPhone auto-export app and iCloud Drive (route A), Apple-inspired motion; added Money module (budgets, CSV import, bill splitting with friends, income analytics), no bank linking. Phases now 5: Money becomes phase 4, Editor + search moves to phase 5 (release 1.0). Deferred: live workout logging (future iOS app), Gmail viewer, bank linking. Sidebar gains Health and Money.
