# ADR 0007: Signed auto-update

Status: accepted · Date: 2026-10-30

## Context

Every fix needed a manual download and reinstall. The owner approved one new network call (requirements §2, change log 2026-10-30): an update check against GitHub Releases, switchable off. A compromised update channel is the classic way to take over a desktop app, so the design has to hold even if GitHub or the network is hostile (threat model T22).

## Decision

- **Tauri updater plugin, driven from Rust.** The UI calls three app commands (`check_for_update`, `install_update`, `set_auto_update`); the plugin's own JavaScript permissions are not granted to the window.
- **Signatures:** every update package is signed with a minisign key. The public key is compiled into the app (`tauri.conf.json`); the private key and its password exist only as GitHub Actions secrets and in the owner's offline backup. The updater verifies the signature (and the signed version) before running anything; a mismatch is refused and the owner is told plainly.
- **Endpoint:** `https://github.com/atharva-acharya/lifeos-app/releases/latest/download/latest.json`, written by the release workflow. Release builds refuse non-HTTPS endpoints; debug builds accept a local override (`LIFEOS_UPDATE_ENDPOINT`) for the end-to-end test only.
- **Owner control:** checks at start-up by default, can be switched off in Settings; installing always needs a click ("Install and restart").
- **Release gates:** the release workflow refuses to publish unless CodeQL (Rust) and the local end-to-end suite (`pnpm e2e:gate`, recorded as the `e2e (local)` commit status) passed on the tagged commit, so an update cannot ship untested.

## Consequences

- Losing the private key means installed copies can never auto-update again (a new key needs a manual reinstall). The owner keeps an offline backup.
- The end-to-end suite proves the refusal path in the real app: an update signed with a throwaway key is offered and refused.
- Authenticode signing (ADR 0005) is still separate: it removes the SmartScreen warning but does not replace update signatures.
