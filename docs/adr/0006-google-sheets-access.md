# ADR 0006: Google Sheets access

Status: proposed · Date: 2026-10-29

## Context

Phase 2 shows job applications live from the owner's Google Sheet (requirements §2, §3.2). This is the app's first network access and first stored credential (threat model T9, T10).

## Decision

- **OAuth 2.0 for installed apps** with PKCE and a loopback redirect (`http://127.0.0.1:<random port>`), opened in the owner's default browser. No embedded login page.
- **Scope:** `https://www.googleapis.com/auth/spreadsheets.readonly` only. The app can never change the Sheet.
- **OAuth client:** a "Desktop app" client in the owner's own Google Cloud project. Client ID and secret are entered once in Settings and stored in local settings; they are never in the repository (for desktop clients Google treats the secret as non-confidential, but it is still kept out of the repo).
- **Publishing status:** the consent screen is set to "In production" without verification. The owner sees Google's "unverified app" notice once; refresh tokens then do not expire weekly as they do in "Testing" mode.
- **Token storage:** the refresh token lives in Windows Credential Manager via the `keyring` crate. Access tokens stay in memory. Nothing token-related is logged or sent to the UI.
- **Network:** all HTTPS calls are made by the Rust core with `reqwest` and rustls (system roots, no certificate overrides). The UI keeps `connect-src` limited to IPC; the CSP does not change.
- **Hosts allowed:** `accounts.google.com`, `oauth2.googleapis.com`, `sheets.googleapis.com`. Requests to any other host are refused in code.
- **Offline-first:** the last successful fetch is cached in the index with its timestamp; the Jobs page always renders from the cache and shows when it was last updated. Refresh on page open (if older than 15 minutes) and on demand.
- **Columns by header name**, not position, so reordering the Sheet does not break the app; unknown columns are ignored and missing ones reported.
- **Disconnect** revokes the token with Google and deletes it from Credential Manager.

## Alternatives

- **"Publish to web" CSV link:** no auth, but makes the job search public. Rejected.
- **Service account:** needs the Sheet shared with a robot account and a private key file on disk. Rejected for a single-user desktop app.
- **Embedded webview login:** Google blocks OAuth in embedded browsers and it weakens phishing protection. Rejected.

## Consequences

- The owner creates the OAuth client once (about five minutes, steps in the phase 2 plan).
- New dependencies (`reqwest`, `keyring`, `oauth2` or a small PKCE implementation) go through `cargo deny` and review.
- The end-to-end test uses a fixture cache, never real Google calls.
