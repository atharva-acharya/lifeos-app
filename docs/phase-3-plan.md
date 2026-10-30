# Phase 3 plan: Fitness, Health, Projects

Status: draft 2026-10-30. Owner decisions marked **(owner)**.

Goal (requirements §3.3, §3.4, §3.7): the Fitness, Health and Projects pages, a shared motion system, and the quality work that a shipped product needs (updates, diagnostics, release gate). Ends with `v0.3.0`.

## How this phase is run

Lean flow agreed after phase 2: one PR per feature area (five PRs), each with one combined code and security review, the local e2e suite run on the built app before the PR opens, auto-merge on green, and the version bump inside the last PR. Work continues on the next branch while CI runs.

## Pull requests

| PR  | Scope                                                                                                                                                                                                                                                                                                                                                                                   | Done when                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | **Foundations.** Motion tokens (durations 120/200/320 ms, standard and spring easings via CSS `linear()`), page and tab transitions with the View Transitions API, enter animations with `@starting-style`, all off under "reduce motion". Line chart and ring components (in-house SVG, like `BarChart`). Local error log with "Copy diagnostics" in Settings (no data leaves the PC). | Motion used through tokens only; components unit-tested; e2e page-error guard clean; error log captures a forced test error                            |
| B   | **Release quality.** The local e2e run records a commit status `e2e (local)` on the tested commit; the release workflow refuses to publish without it (as it already does for CodeQL Rust). Signed auto-update with the Tauri updater against GitHub Releases, update check switchable off in Settings **(owner)**. Threat model and ADR updated.                                       | A release without a passing local e2e on that commit fails; an update from a test build to a newer signed build installs; a tampered update is refused |
| C   | **Fitness.** Weight trend (daily points, 7-day average, target line from `Fitness/Plan.md`), steps, protein days; workout history per session type; lift progress per exercise (top set over time), from daily notes and `Fitness/Log`.                                                                                                                                                 | Parser tests on synthetic notes; charts tested; empty, partial and malformed data handled                                                              |
| D   | **Projects tracker.** Project notes with ordered steps and a dated log; current step, progress bar, "resume here" (next unchecked step and last log entry).                                                                                                                                                                                                                             | Matches `Projects/lifeos-app.md` format; tests on synthetic notes                                                                                      |
| E   | **Health.** Read-only import of the auto-export JSON folder (path in Settings, same path guard as the vault); activity rings (steps, active energy, sleep goal); trends for resting heart rate, HRV, sleep and weight; Apple Health workouts beside vault workouts; last-export time and a stale-folder warning. Version 0.3.0.                                                         | Importer fuzz/size-limit tests (T16); synthetic export fixture; rings and trends tested; e2e covers Health                                             |

## Owner setup and decisions

1. **(owner) Auto-update:** allow one new network call, a signed update check to GitHub Releases, switchable off. This changes requirements §2 "no new network calls", so it needs your OK. Without it, updates stay manual downloads.
2. **(owner) Health export:** the iPhone app Health Auto Export (its automatic export to iCloud Drive needs the paid Premium tier) and iCloud for Windows on the PC. Only needed for PR E; PRs A to D don't depend on it.
3. **(owner) Code signing:** apply to the SignPath open-source programme from your GitHub account, so Windows stops showing "unknown publisher". Independent of this phase.

## Not in phase 3

Workout logging in the app (future iOS app), Money (phase 4), editor and search (phase 5).
