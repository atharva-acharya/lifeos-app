# ADR 0003: Vault access model

Status: accepted · Date: 2026-10-29

## Context

The app reads and writes the owner's notes, which Obsidian also edits. A bug or a malicious note must not be able to reach files outside the vault, lose data, or run code.

## Decision

1. **Rust core only.** The front end gets no Tauri `fs`, `shell` or `http` plugins. It calls a small set of typed commands (`list_notes`, `read_note`, `write_note`, `archive_note`, `query_*`) that take **vault-relative** paths.
2. **Path guard.** Every path is joined to the configured vault root, canonicalised, and rejected unless it stays inside the root. `..`, absolute paths, UNC/device paths (`\\?\`, `\\.\`), alternate data streams (`:`) and reparse points (symlinks, junctions) are refused. Only `.md` files are read or written.
3. **Safe writes.** Write to a temp file in the same folder, flush, then atomic rename. Just before the rename, re-read the note and compare its hash with the one read at the start; if it changed, refuse with a conflict and write nothing (the phase 5 editor will let the user choose, requirements §3.5). New notes are created without overwriting (hard link, or an exclusive create where links are unsupported). The note's folder is re-checked inside the vault right before the rename. Each write is logged locally (path, time, hash before and after; no content). Implemented in phase 4 (`vault::write`).
4. **Round-trip safety.** Front matter is edited as a document, not re-serialised from a struct: only changed keys are rewritten; unknown fields, order, comments and the body are preserved byte-for-byte. Golden-file tests enforce this.
5. **Never delete.** "Delete" moves the file to `old/` in the vault (name collision gets a timestamp suffix).
6. **Vault root** is chosen through a native folder picker and stored in local settings (`%APPDATA%\lifeos-app\settings.json`), outside the repo.
7. **Untrusted content.** Note text is treated as untrusted: Markdown is rendered with raw HTML disabled and sanitised; links open only after a confirm, and only `https:` / `obsidian:` schemes.

## Consequences

- The path guard and the round-trip writer are the highest-risk code; both need unit tests, property tests (`proptest`) and security review on every change.
- Edits made in Obsidian while the app runs are picked up by the watcher and surfaced as conflicts if a note is open.
