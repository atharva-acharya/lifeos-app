//! Keeps the index in step with the vault while the app runs (ADR 0002):
//! a sync on start and on vault change, then debounced syncs on file events.
//!
//! The app is in one of two modes. `Real` reads the owner's vault. `Sample`
//! reads the bundled demo vault from a separate folder and index file, with
//! no watcher. The mode lives in memory only, so a restart is always `Real`.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::applications::Cache;
use crate::index::{Index, SyncStats};

const DEBOUNCE: Duration = Duration::from_millis(300);
pub const INDEX_UPDATED: &str = "index-updated";

/// Shown when a command that touches the owner's own data or accounts is
/// called while sample data is on.
pub const SAMPLE_REFUSED: &str =
    "This is not available while sample data is on. Leave sample data first.";

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Real,
    Sample,
}

struct Live {
    vault: PathBuf,
    index: Index,
    /// `None` in sample mode: the demo vault never changes.
    _watcher: Option<Debouncer<notify::RecommendedWatcher>>,
}

#[derive(Default)]
struct Inner {
    live: Option<Live>,
    mode: Mode,
    /// The synthetic applications copy, in sample mode only.
    sample_applications: Option<Cache>,
}

#[derive(Default)]
pub struct LiveState {
    inner: Mutex<Inner>,
    /// Held for the whole of entering, leaving or choosing a vault, so those never interleave.
    switch: tauri::async_runtime::Mutex<()>,
}

impl LiveState {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Runs `f` against the open index, if a vault (or the sample vault) is open.
    pub fn with_index<T>(&self, f: impl FnOnce(&Index) -> T) -> Option<T> {
        self.lock().live.as_ref().map(|live| f(&live.index))
    }

    /// The open vault's folder (canonical), if any.
    pub fn vault(&self) -> Option<PathBuf> {
        self.lock().live.as_ref().map(|live| live.vault.clone())
    }

    pub fn mode(&self) -> Mode {
        self.lock().mode
    }

    /// Refuses (with a message for the UI) while sample data is on.
    pub fn require_real(&self) -> Result<(), String> {
        match self.mode() {
            Mode::Real => Ok(()),
            Mode::Sample => Err(SAMPLE_REFUSED.to_owned()),
        }
    }

    /// Switches to sample mode, dropping whatever was open (the real watcher
    /// and index included).
    pub fn install_sample(&self, vault: PathBuf, index: Index, applications: Cache) {
        let mut inner = self.lock();
        inner.sample_applications = Some(applications);
        inner.live = Some(Live {
            vault,
            index,
            _watcher: None,
        });
        inner.mode = Mode::Sample;
    }

    /// The synthetic applications copy while sample data is on.
    pub fn sample_applications(&self) -> Option<Cache> {
        self.lock().sample_applications.clone()
    }

    /// Serialises enter, exit and choose-folder; hold the guard for the whole call.
    pub async fn switching(&self) -> impl Send + '_ {
        self.switch.lock().await
    }

    /// Closes the sample index ahead of a rebuild but stays in sample mode,
    /// so guarded commands keep refusing and the real vault is not reopened
    /// half-way. Files are not touched.
    pub fn begin_rebuild(&self) {
        let mut inner = self.lock();
        if inner.mode == Mode::Sample {
            inner.live = None;
            inner.sample_applications = None;
        }
    }

    /// Closes the open index and returns to real mode. Files are not touched.
    pub fn clear(&self) {
        let mut inner = self.lock();
        inner.live = None;
        inner.sample_applications = None;
        inner.mode = Mode::Real;
    }
}

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::commands::cache_dir(app)
}

fn index_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("index.db"))
}

/// Opens the index for `vault`, syncs it and starts watching. Replaces any
/// previous vault's watcher. Does nothing while sample data is on.
pub fn start(app: &AppHandle, vault: &Path) -> Result<SyncStats, String> {
    if app.state::<LiveState>().mode() == Mode::Sample {
        return Ok(SyncStats::default());
    }
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
    let mut inner = state.lock();
    if inner.mode == Mode::Sample {
        // Sample data was turned on while this was indexing; it wins.
        return Ok(stats);
    }
    inner.live = Some(Live {
        vault: vault.to_path_buf(),
        index,
        _watcher: Some(watcher),
    });
    drop(inner);
    let _ = app.emit(INDEX_UPDATED, stats);
    Ok(stats)
}

/// Syncs the index now (after the app writes a note) instead of waiting for
/// the watcher, and tells the UI if anything changed.
pub fn resync(app: &AppHandle) {
    let state = app.state::<LiveState>();
    let mut inner = state.lock();
    if inner.mode == Mode::Sample {
        return;
    }
    let Some(live) = inner.live.as_mut() else {
        return;
    };
    let vault = live.vault.clone();
    if let Ok(stats) = live.index.sync(&vault) {
        drop(inner);
        if stats.added + stats.updated + stats.removed > 0 {
            let _ = app.emit(INDEX_UPDATED, stats);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_real_and_sample_refuses_guarded_commands() {
        let state = LiveState::default();
        assert_eq!(state.mode(), Mode::Real);
        assert!(state.require_real().is_ok());
        assert!(state.with_index(|_| ()).is_none());

        let index = Index::open_in_memory().expect("index");
        state.install_sample(PathBuf::from("sample"), index, Cache::default());
        assert!(state.sample_applications().is_some());
        assert_eq!(state.mode(), Mode::Sample);
        assert_eq!(state.require_real(), Err(SAMPLE_REFUSED.to_owned()));
        assert!(state.with_index(|_| ()).is_some());

        // A rebuild closes the index but keeps refusing like sample mode.
        state.begin_rebuild();
        assert_eq!(state.mode(), Mode::Sample);
        assert!(state.with_index(|_| ()).is_none());
        assert!(state.sample_applications().is_none());
        assert_eq!(state.require_real(), Err(SAMPLE_REFUSED.to_owned()));

        state.clear();
        assert_eq!(state.mode(), Mode::Real);
        assert!(state.with_index(|_| ()).is_none());
        assert!(state.sample_applications().is_none());
        assert!(state.require_real().is_ok());
    }
}
