# ADR 0007: Signed auto-update

Status: accepted · Date: 2026-10-30

## Context

Every fix needed a manual download and reinstall. The owner approved one new network call (requirements §2, change log 2026-10-30): an update check against GitHub Releases, switchable off. A compromised update channel is the classic way to take over a desktop app, so the design has to hold even if GitHub, the network or a build dependency is hostile (threat model T22).

## Decision

- **Tauri updater plugin, driven from Rust.** The UI calls three app commands (`check_for_update`, `install_update(version)`, `set_auto_update`); the plugin's own JavaScript permissions are not granted to the window. Installing names the exact version the owner was shown.
- **Signatures bound to versions:** every update package is minisign-signed with `--app-version`, and the app sets `requireSignedVersion`. The updater checks the signature against the public key built into the app (`tauri.conf.json`) and that the signed version equals the announced one, so an older genuine release cannot be replayed as "new" (no downgrades). Any failure is refused and the owner is told plainly.
- **Where updates come from:** `https://github.com/atharva-acharya/lifeos-app/releases/latest/download/latest.json`; the download URL must be HTTPS on github.com under this repository's releases. Release builds refuse non-HTTPS endpoints. Debug builds accept a local endpoint and test key (`LIFEOS_UPDATE_ENDPOINT`, `LIFEOS_UPDATE_PUBKEY`) for the end-to-end suite only.
- **Key handling:** the private key and its password exist only as GitHub Actions secrets and in the owner's offline backup. The release workflow builds with no secrets; a separate publish job, which runs only a pinned Tauri CLI installed without install scripts (no repository code, no other dependencies), signs the installer and writes `latest.json`.
- **Owner control:** checks at start-up by default, can be switched off in Settings; installing always needs a click ("Install and restart").
- **Release gates:** the workflow refuses to publish unless CodeQL (Rust) passed on the tagged commit and the owner's end-to-end run did too. `pnpm e2e:gate` runs the suite in a fresh worktree of that commit (dependencies from the lockfile) and records the `e2e (local)` status; only a status created by the repository owner counts.

## Consequences

- Losing the private key means installed copies can never auto-update again (a new key needs a manual reinstall). The owner keeps an offline backup.
- The end-to-end suite proves both refusal paths in the real app: an update signed with the wrong key, and a genuine old release announced as a newer version.
- The e2e suite runs debug builds; the release-only rules (HTTPS endpoint, GitHub download host) are covered by unit tests.
- Authenticode signing (ADR 0005) is still separate: it removes the SmartScreen warning but does not replace update signatures.
