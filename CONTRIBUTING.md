# Contributing

This is a personal project, but issues and suggestions are welcome.

- Branch from `main` with a short-lived branch (`feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles.
- All CI and security checks must pass before merge.
- Tests and fixtures use synthetic data only. Never commit real notes, credentials, tokens or local settings.
- Significant design changes need an ADR in `docs/adr/`.

## How work flows

- **Ready before work starts.** Each item names the files it changes, has acceptance criteria written as Given / When / Then, has one goal and no open questions. Items that change different files run in parallel on separate branches; items that touch the same files go one after another.
- **Checks sized to the change.** Docs-only changes skip the build (CI already does this). Code changes run everything. A change to the installer, release workflow or update signing also needs the manual Windows check written in its pull request.
- **Check locally before pushing.** `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test`, plus `cargo fmt --check` and `cargo clippy` when Rust changed, so CI rounds are not spent on what a laptop catches.
- **Independent review.** Before merging, the change is reviewed from separate angles, each without the others' notes: does it do what was asked, what edge cases break it, what was not verified, and (for UI) does it meet `docs/ui-spec.md`. Every finding is checked at the cited line before it is acted on.
- **Honest evidence.** A pull request lists only checks that actually ran, and says plainly what was skipped or could not be checked.
- **Merge in batches.** When several pull requests are ready, they are updated and merged back to back, so CI re-runs once per batch where branch protection allows it, not once per pull request after a long gap.
- **Decisions are written down.** A choice that changes behaviour, scope or a dependency gets a line in its pull request: what was decided, why, and what it costs if it is wrong.
- **Mistakes become rules.** When something goes wrong (a wrong default, a missed step), the fix includes the rule that stops it happening again.
- **UI changes** follow `docs/ui-spec.md` and list the requirement IDs they touch, with screenshots before and after.

## Releasing

1. Merge the release PR (version bumped in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`).
2. Check out the merged commit on `main` and run `pnpm e2e:gate`. It builds the app, runs the end-to-end suite and records the `e2e (local)` status on that commit.
3. Wait for CodeQL (Rust) on that commit, then push the tag `vX.Y.Z`. The release workflow refuses to publish without both, signs the update package and writes `latest.json` for auto-update (ADR 0007).
