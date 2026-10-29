# ADR 0001: Application stack

Status: accepted · Date: 2026-10-29

## Context
A Windows desktop app over a local Markdown vault. It must start in under 2 s, work offline, keep a small attack surface and be a credible engineering showcase.

## Decision
- **Shell:** Tauri 2. Rust core owns all file, database and network access; the UI is a WebView2 front end with no direct OS access.
- **UI:** TypeScript (strict) + React 19 + Vite. Styling with CSS variables for the "studio dark" tokens (no CSS framework). Charts with Recharts. Markdown rendering with `react-markdown` + `rehype-sanitize` (no raw HTML).
- **Core crates:** `rusqlite` (bundled SQLite), `notify` (file watcher), `serde_yaml`-compatible parser for front matter, `pulldown-cmark` for task-list parsing, `keyring` for secrets (phase 2), `thiserror` for errors.
- **Tests:** Vitest + Testing Library (UI), `cargo test` (core), Playwright against the built app via `tauri-driver` (end to end).
- **Tooling:** pnpm, ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier, `rustfmt`, Clippy (`-D warnings`). Pinned toolchains: `.nvmrc` (Node 24 LTS) and `rust-toolchain.toml` (stable).

## Alternatives
- **Electron:** larger binary (~150 MB), slower start, Node in the app process widens the attack surface.
- **.NET WinUI 3:** native feel, but weaker web charting and Markdown ecosystem, and a less portable portfolio piece.

## Consequences
- Needs Node 24 LTS, pnpm, Rust (MSVC) and Visual Studio Build Tools locally; WebView2 ships with Windows 11.
- Two languages to test and scan; CI covers both (ADR 0004).
