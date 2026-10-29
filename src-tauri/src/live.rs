//! Keeps the index in step with the vault while the app runs (ADR 0002):
//! a sync on start and on vault change, then debounced syncs on file events.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use tauri::{AppHandle, Emitter, Manager};

use crate::index::{Index, SyncStats};

const DEBOUNCE: Duration = Duration::from_millis(300);
pub const INDEX_UPDATED: &str = "index-updated";

struct Live {
    vault: PathBuf,
    index: Index,
    _watcher: Debouncer<notify::RecommendedWatcher>,
}

#[derive(Default)]
pub struct LiveState(Mutex<Option<Live>>);

impl LiveState {
    /// Runs `f` against the open index, if a vault is connected.
    pub fn with_index<T>(&self, f: impl FnOnce(&Index) -> T) -> Option<T> {
        let guard = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        guard.as_ref().map(|live| f(&live.index))
    }
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match crate::commands::test_data_dir() {
        Some(dir) => dir,
        None => app.path().app_local_data_dir().map_err(|e| e.to_string())?,
    };
    Ok(dir.join("index.db"))
}

/// Opens the index for `vault`, syncs it and starts watching. Replaces any
/// previous vault's watcher.
pub fn start(app: &AppHandle, vault: &Path) -> Result<SyncStats, String> {
    let mut index = Index::open(&index_path(app)?).map_err(|e| e.to_string())?;
    let stats = index.sync(vault).map_err(|e| e.to_string())?;

    let handle = app.clone();
    let mut watcher = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        if res.is_ok() {
            resync(&handle);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watcher()
        .watch(vault, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let state = app.state::<LiveState>();
    let mut guard = state
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    *guard = Some(Live {
        vault: vault.to_path_buf(),
        index,
        _watcher: watcher,
    });
    drop(guard);
    let _ = app.emit(INDEX_UPDATED, stats);
    Ok(stats)
}

fn resync(app: &AppHandle) {
    let state = app.state::<LiveState>();
    let mut guard = state
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(live) = guard.as_mut() else {
        return;
    };
    let vault = live.vault.clone();
    if let Ok(stats) = live.index.sync(&vault) {
        drop(guard);
        if stats.added + stats.updated + stats.removed > 0 {
            let _ = app.emit(INDEX_UPDATED, stats);
        }
    }
}
