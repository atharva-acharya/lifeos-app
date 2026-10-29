# Phase 1 plan: foundation

Status: approved by owner 2026-10-29 (licence MIT, GitHub repo `lifeos-app`).

Goal (requirements §7): repo, CI/CD with all gates green, app shell, vault reader + SQLite index, Today page. Ends with tag `v0.1.0` and owner sign-off.

Each task is one short-lived branch and one pull request. Order matters; later tasks depend on earlier ones.

| #   | Task                                                                                                                                                        | Done when                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Repo baseline: README, LICENSE, SECURITY.md, CONTRIBUTING, `.editorconfig`, PR template, Dependabot, CODEOWNERS                                             | Pushed to GitHub, `main` protected              |
| 2   | Scaffold Tauri 2 + React + Vite + TS (strict), pnpm, toolchain pins, lint/format configs                                                                    | `pnpm tauri dev` opens an empty window          |
| 3   | `ci.yml`: format, lint, types, unit tests, build                                                                                                            | All green on a PR                               |
| 4   | `security.yml`: CodeQL, Semgrep, audits, `cargo deny`, Gitleaks, Scorecard                                                                                  | All green on a PR; set as required checks       |
| 5   | Lock down Tauri: capabilities, no fs/shell/http plugins, strict CSP                                                                                         | Security review passes; CSP test                |
| 6   | App shell: design tokens (studio dark), sidebar (Today, Jobs, Fitness, Projects, Search, Settings), routing, keyboard focus, reduce-motion                  | Screenshot matches design A                     |
| 7   | Settings: vault folder picker, stored in app data                                                                                                           | Path persists across restarts                   |
| 8   | Vault reader: path guard, front matter parser, note-type models for the five types                                                                          | Unit + property tests pass on synthetic vault   |
| 9   | SQLite index: schema, full build, watcher with debounce, parse-error table                                                                                  | Index rebuilds < 1 s for 1,000 synthetic notes  |
| 10  | Today page: greeting, cards (follow-ups due, weight + change, applications today, gym session, habit ticks), due-company list, active project "resume here" | Screenshot with synthetic data; Vitest coverage |
| 11  | Playwright smoke test against built app with synthetic vault                                                                                                | Runs in CI                                      |
| 12  | `release.yml`: NSIS/MSI, CycloneDX SBOM, git-cliff changelog, checksums, attestations, signing hook (SignPath when approved)                                | `v0.1.0` release published                      |

Per task: builder implements with tests → test-writer fills gaps → security-reviewer and code-reviewer review the diff → fixes → PR green → merge.

Not in phase 1: Google Sheets, charts, editor, Ctrl+K (phases 2-4).
