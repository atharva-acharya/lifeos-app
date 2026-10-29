# Phase 2 plan: Jobs

Status: approved by owner 2026-10-29.

Goal (requirements §3.2): the Jobs page shows applications live from the owner's Google Sheet, the company pipeline from vault notes, the outreach log and job-search charts. Ends with `v0.2.0` and owner sign-off.

| #   | Task                                                                                                                                       | Done when                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | ADR 0006 agreed; threat model T9/T10 detailed                                                                                              | Merged                                                                       |
| 2   | Settings: Google connection (client ID and secret, Sheet ID, connect, status, disconnect)                                                  | Connect and disconnect work against Google; token only in Credential Manager |
| 3   | Rust Sheets client: OAuth PKCE loopback, token refresh, read `Applications` tab, map columns by header, host allowlist                     | Unit tests with recorded fixtures; no token in logs                          |
| 4   | Cache in the index with timestamp; refresh on open (15 min) and on demand; offline view                                                    | Jobs page works with network off                                             |
| 5   | Applications table: filter by status and source, sort, search, counts by stage                                                             | UI tests; screenshot with synthetic data                                     |
| 6   | Company pipeline: columns applied, replied, screen, interview, offer, rejected from company notes, with next action and date               | Matches vault notes; overdue highlighted                                     |
| 7   | Outreach log: parse the `Jobs/Outreach.md` table (sent, name, profile, company/role, type, status, last update); filter by status and type | Parser tests on synthetic fixture                                            |
| 8   | Charts: applications per week; reply rate by source                                                                                        | Chart tests; screenshot                                                      |
| 9   | Security review of the network and credential code; e2e extended with a fixture cache                                                      | Reviews clean; e2e passes locally                                            |
| 10  | Release `v0.2.0`                                                                                                                           | Installers, SBOM, checksums, provenance verified                             |

Per task: builder implements with tests, test-writer fills gaps, security-reviewer and code-reviewer review the diff, PR green, merge.

## Owner setup (once, about five minutes)

1. Go to console.cloud.google.com and create a project named `lifeos-app`.
2. APIs & Services → Library → enable **Google Sheets API**.
3. OAuth consent screen → External → app name `Life OS`, your email as support and developer contact → add scope `.../auth/spreadsheets.readonly` → add yourself as a test user → **Publish app** (In production).
4. Credentials → Create credentials → OAuth client ID → **Desktop app** → name `Life OS desktop` → copy the client ID and secret.
5. In Life OS → Settings → Google, paste the client ID, secret and the Sheet ID (the long code in the Sheet's URL), then click Connect and approve in the browser.

## Not in phase 2

Gmail viewer (deferred), editing the Sheet (read-only by design).
