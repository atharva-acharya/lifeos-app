//! Holds the app back while a Life OS installer is still running.
//!
//! Before it copies any file the installer opens `installing.lock` in the
//! install folder and keeps it open until its process exits
//! (windows/installer-hooks.nsh). It relaunches the app from its last step,
//! so without this wait the window could open while the installer is still
//! finishing; the same goes for a shortcut clicked mid-install. Windows
//! refuses to delete a file another process has open, so the app keeps
//! trying to delete the lock and starts once that works.

use std::path::Path;
use std::time::{Duration, Instant};

/// Must match `LIFEOS_INSTALL_LOCK` in windows/installer-hooks.nsh.
pub const LOCK_FILE: &str = "installing.lock";
/// An installer that hangs must not keep the app closed for good.
const MAX_WAIT: Duration = Duration::from_secs(120);
const POLL: Duration = Duration::from_millis(250);
/// ERROR_SHARING_VIOLATION: the installer still has the lock open.
const SHARING_VIOLATION: i32 = 32;

pub fn wait_for_installer() {
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        wait_for(&dir.join(LOCK_FILE), MAX_WAIT);
    }
}

/// Returns once `lock` is gone (deleting it if no one holds it), on any error
/// other than "still open elsewhere" (a read-only install folder, say), or
/// after `max`.
fn wait_for(lock: &Path, max: Duration) {
    let start = Instant::now();
    loop {
        match std::fs::remove_file(lock) {
            Err(e) if e.raw_os_error() == Some(SHARING_VIOLATION) && start.elapsed() < max => {
                std::thread::sleep(POLL);
            }
            _ => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_lock(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("lifeos-install-wait-{name}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join(LOCK_FILE)
    }

    #[test]
    fn starts_at_once_with_no_installer() {
        let lock = temp_lock("none");
        let _ = fs::remove_file(&lock);
        let start = Instant::now();
        wait_for(&lock, Duration::from_secs(5));
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn removes_a_lock_left_by_a_finished_installer() {
        let lock = temp_lock("stale");
        fs::write(&lock, b"").expect("write lock");
        wait_for(&lock, Duration::from_secs(5));
        assert!(!lock.exists());
    }

    #[cfg(windows)]
    mod while_installing {
        use super::*;
        use std::os::windows::fs::OpenOptionsExt;
        use std::sync::mpsc;

        const FILE_SHARE_READ: u32 = 1;

        /// Stands in for the installer: holds the lock open like NSIS
        /// `FileOpen` (others may read, not delete), then exits.
        fn hold_lock(lock: std::path::PathBuf, hold: Duration) -> mpsc::Receiver<()> {
            let (ready, wait) = mpsc::channel();
            std::thread::spawn(move || {
                let file = fs::OpenOptions::new()
                    .write(true)
                    .create(true)
                    .truncate(true)
                    .share_mode(FILE_SHARE_READ)
                    .open(&lock)
                    .expect("open lock");
                ready.send(()).expect("signal");
                std::thread::sleep(hold);
                drop(file);
            });
            wait
        }

        #[test]
        fn waits_until_the_installer_exits() {
            let lock = temp_lock("hold");
            let ready = hold_lock(lock.clone(), Duration::from_millis(600));
            ready.recv().expect("installer started");
            let start = Instant::now();
            wait_for(&lock, Duration::from_secs(5));
            assert!(start.elapsed() >= Duration::from_millis(400));
            assert!(!lock.exists());
        }

        #[test]
        fn gives_up_on_a_hung_installer() {
            let lock = temp_lock("hung");
            let ready = hold_lock(lock.clone(), Duration::from_secs(3));
            ready.recv().expect("installer started");
            let start = Instant::now();
            wait_for(&lock, Duration::from_millis(300));
            assert!(start.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn installer_hooks_use_the_same_lock_name() {
        let hooks = include_str!("../windows/installer-hooks.nsh");
        assert!(hooks.contains(&format!("\"{LOCK_FILE}\"")));
    }
}
