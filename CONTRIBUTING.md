# Contributing

This is a personal project, but issues and suggestions are welcome.

- Branch from `main` with a short-lived branch (`feat/…`, `fix/…`, `chore/…`, `ci/…`, `docs/…`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages and PR titles.
- All CI and security checks must pass before merge.
- Tests and fixtures use synthetic data only. Never commit real notes, credentials, tokens or local settings.
- Significant design changes need an ADR in `docs/adr/`.

## Releasing

1. Merge the release PR (version bumped in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`).
2. Check out the merged commit on `main` and run `pnpm e2e:gate`. It builds the app, runs the end-to-end suite and records the `e2e (local)` status on that commit.
3. Wait for CodeQL (Rust) on that commit, then push the tag `vX.Y.Z`. The release workflow refuses to publish without both, signs the update package and writes `latest.json` for auto-update (ADR 0007).
