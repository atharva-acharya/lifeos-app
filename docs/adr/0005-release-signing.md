# ADR 0005: Release, signing and SBOM

Status: accepted · Date: 2026-10-29

## Context

Each phase ends with a released build. Requirements ask for a signed installer, a CycloneDX SBOM, a changelog and checksums.

## Decision

- **Trigger:** pushing a tag `vX.Y.Z` on `main` runs `release.yml` in a protected `release` environment (manual approval).
- **Version** from the tag; set in `package.json`, `Cargo.toml` and `tauri.conf.json` by the release workflow check (mismatch fails).
- **Artefacts:** NSIS installer (`.exe`) and MSI from `tauri build`.
- **Code signing (Authenticode):** apply to SignPath Foundation's free open-source programme; the CI signs through SignPath's GitHub Action, so no private key is ever stored in GitHub. Until approved, releases ship unsigned and the README says so.
- **Provenance:** GitHub artifact attestations (Sigstore, SLSA build provenance) for every artefact, verifiable with `gh attestation verify`.
- **SBOM:** CycloneDX for both ecosystems (`@cyclonedx/cyclonedx-npm`, `cargo cyclonedx`), merged and attached to the release.
- **Changelog:** generated from Conventional Commits with `git-cliff`.
- **Checksums:** `SHA256SUMS.txt` attached to the GitHub Release.
- **No auto-updater** in version 1 (keeps the app offline apart from the Sheets API).

## Alternatives

- **Azure Trusted Signing:** about $10/month and identity validation; individual sign-up is limited by region. Kept as fallback.
- **Self-signed certificate:** free but Windows SmartScreen still warns; no real trust value.

## Consequences

- SignPath approval needs a public repo with an OSI licence and some history; apply once phase 1 is merged.
