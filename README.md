# lifeos-app

A Windows desktop app for a Markdown + YAML "Life OS" note vault (Obsidian-compatible). It shows progress dashboards for daily habits, fitness, job search and personal projects, and lets you view and edit the notes without replacing Obsidian.

> Status: phase 1 (foundation) in progress. Not yet usable.

## Highlights
- **Local-first.** Your notes stay the source of truth; a disposable SQLite index makes dashboards fast. No telemetry.
- **Least privilege.** The UI has no direct file system, shell or network access; all vault access goes through a path-guarded Rust core.
- **Secure pipeline.** Every pull request runs format, lint, type and unit checks plus CodeQL, Semgrep, dependency audits and secret scanning. Releases ship with an SBOM, checksums and build provenance.

## Stack
Tauri 2 (Rust) · TypeScript · React · Vite · SQLite · Vitest · Playwright

## Docs
- [Architecture decision records](docs/adr/)
- [Threat model](docs/threat-model.md)
- [Phase 1 plan](docs/phase-1-plan.md)
- [Security policy](SECURITY.md)

## Building from source
Requirements: Windows 10/11, Node 24 LTS, pnpm, Rust (stable, MSVC), Visual Studio Build Tools (C++ workload). Build steps arrive with the app scaffold.

## Licence
[MIT](LICENSE)
