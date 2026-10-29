# Threat model

Version 0.1 · 2026-10-29 · Method: STRIDE per trust boundary. Reviewed at the end of every phase.

## Assets

1. Vault notes (personal health, job search and journal data): confidentiality and integrity.
2. Google OAuth refresh token (phase 2).
3. Integrity of the released installer and its dependencies.

## Trust boundaries

```
[Vault files] --(B1)--> [Rust core] <--(B2: IPC)--> [WebView UI]
                            |  \
                         (B3)   (B4: HTTPS)
                     [index.db]   [Google Sheets API]
[Source + deps] --(B5: CI/CD)--> [Signed installer] --> [Owner's PC]
```

## Threats and mitigations

| #   | Boundary | STRIDE          | Threat                                                                             | Mitigation                                                                                                                                    | Phase |
| --- | -------- | --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| T1  | B1       | Tampering / EoP | Path traversal or symlink/junction in a note path reaches files outside the vault  | Path guard: canonicalise, prefix check, refuse `..`, UNC, ADS, reparse points; `.md` only (ADR 0003); property tests                          | 1     |
| T2  | B1       | Tampering       | Concurrent edit with Obsidian overwrites changes                                   | Hash check before write, conflict prompt, atomic rename                                                                                       | 4     |
| T3  | B1       | Tampering       | Writer corrupts YAML or body                                                       | Round-trip writer, golden-file tests, never delete (move to `old/`)                                                                           | 4     |
| T4  | B1→B2    | EoP             | Malicious note content (HTML, `javascript:` links, SVG) runs script in the WebView | Raw HTML disabled, `rehype-sanitize`, strict CSP (`default-src 'self'`, no `unsafe-inline` scripts, no remote origins), link scheme allowlist | 1     |
| T5  | B2       | EoP             | Compromised UI calls powerful OS APIs                                              | No `fs`/`shell`/`http` plugins; Tauri capabilities limited to the app's own commands; commands validate all input                             | 1     |
| T6  | B1       | DoS             | Huge or malformed note hangs the indexer                                           | File size cap (2 MB), parser timeouts/limits, errors recorded not fatal                                                                       | 1     |
| T7  | B3       | Info disclosure | Index copied off the machine leaks data                                            | Stored in the user profile only; contains no data not already in the vault; documented                                                        | 1     |
| T8  | B3       | Tampering       | SQL injection through note values                                                  | Bound parameters only; no dynamic SQL                                                                                                         | 1     |
| T9  | B4       | Info disclosure | OAuth token stolen from disk                                                       | Windows Credential Manager via `keyring`; read-only Sheets scope; PKCE loopback flow                                                          | 2     |
| T10 | B4       | Spoofing        | Man-in-the-middle on Sheets calls                                                  | TLS with system roots (rustls), no certificate overrides                                                                                      | 2     |
| T11 | B5       | Tampering       | Malicious or vulnerable dependency                                                 | Lockfiles, frozen installs, `pnpm audit`, `cargo audit`, `cargo deny`, Dependabot, SBOM                                                       | 1     |
| T12 | B5       | Tampering       | Compromised GitHub Action or workflow injection                                    | Actions pinned by SHA, least-privilege `permissions:`, no `pull_request_target`, untrusted input never in `run:` expressions                  | 1     |
| T13 | B5       | Info disclosure | Secrets or personal data committed                                                 | Gitleaks + push protection; `.gitignore` for settings/credentials; synthetic fixtures only                                                    | 1     |
| T14 | B5       | Spoofing        | Tampered installer                                                                 | Authenticode signing via SignPath, Sigstore attestations, SHA256 checksums                                                                    | 1     |
| T15 | all      | Repudiation     | No record of what the app changed                                                  | Local append-only log of writes/moves in app data (path, time, hash before/after); no note content logged                                     | 4     |

## Out of scope

Malware already running as the user (it can read the vault directly); physical access to an unlocked PC.
