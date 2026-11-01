//! Guards the app's security configuration (threat model T4, T5).
//! These fail if the CSP or capabilities are loosened without review.

use serde_json::Value;

const TAURI_CONF: &str = include_str!("../tauri.conf.json");
const CAPABILITY: &str = include_str!("../capabilities/default.json");
const CARGO_TOML: &str = include_str!("../Cargo.toml");

fn csp() -> String {
    let conf: Value = serde_json::from_str(TAURI_CONF).expect("tauri.conf.json is valid JSON");
    conf["app"]["security"]["csp"]
        .as_str()
        .expect("a CSP string is set")
        .to_owned()
}

fn directive(csp: &str, name: &str) -> Option<String> {
    csp.split(';')
        .map(str::trim)
        .find(|d| d.split_whitespace().next() == Some(name))
        .map(str::to_owned)
}

#[test]
fn csp_defaults_to_self() {
    assert_eq!(
        directive(&csp(), "default-src").as_deref(),
        Some("default-src 'self'")
    );
}

#[test]
fn csp_scripts_are_local_only() {
    let script = directive(&csp(), "script-src").expect("script-src is set");
    assert_eq!(script, "script-src 'self'");
}

#[test]
fn csp_blocks_plugins_framing_and_base_rewrites() {
    let csp = csp();
    assert_eq!(
        directive(&csp, "object-src").as_deref(),
        Some("object-src 'none'")
    );
    assert_eq!(
        directive(&csp, "base-uri").as_deref(),
        Some("base-uri 'none'")
    );
    assert_eq!(
        directive(&csp, "frame-ancestors").as_deref(),
        Some("frame-ancestors 'none'")
    );
    assert_eq!(
        directive(&csp, "form-action").as_deref(),
        Some("form-action 'none'")
    );
}

#[test]
fn csp_allows_no_remote_origins_or_eval() {
    let csp = csp();
    for banned in ["'unsafe-eval'", "https:", "http:", "*"] {
        let hits: Vec<&str> = csp
            .split(';')
            .filter(|d| d.split_whitespace().skip(1).any(|s| s == banned))
            .filter(|d| !d.trim().starts_with("connect-src"))
            .collect();
        assert!(hits.is_empty(), "{banned} found in CSP: {hits:?}");
    }
}

#[test]
fn prototype_is_frozen() {
    let conf: Value = serde_json::from_str(TAURI_CONF).expect("valid JSON");
    assert_eq!(
        conf["app"]["security"]["freezePrototype"],
        Value::Bool(true)
    );
}

#[test]
fn capability_grants_only_events_window_and_app_commands() {
    let cap: Value = serde_json::from_str(CAPABILITY).expect("capability is valid JSON");
    let perms: Vec<&str> = cap["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .map(|p| p.as_str().expect("permission is a string"))
        .collect();
    assert_eq!(
        perms,
        [
            "core:event:default",
            "core:window:default",
            // The app's own title bar: drag, double-click to maximise, and
            // the three window buttons. Nothing that resizes or moves the
            // window from script.
            "core:window:allow-start-dragging",
            "core:window:allow-internal-toggle-maximize",
            "core:window:allow-minimize",
            "core:window:allow-toggle-maximize",
            "core:window:allow-close",
            "allow-get-settings",
            "allow-choose-vault-folder",
            "allow-choose-health-folder",
            "allow-clear-health-folder",
            "allow-get-today",
            "allow-save-google-config",
            "allow-connect-google",
            "allow-disconnect-google",
            "allow-get-applications",
            "allow-refresh-applications",
            "allow-get-jobs",
            "allow-get-fitness",
            "allow-get-projects",
            "allow-get-health",
            "allow-get-money",
            "allow-add-transaction",
            "allow-set-transaction-category",
            "allow-get-banks",
            "allow-preview-import",
            "allow-import-csv",
            "allow-add-split",
            "allow-settle-up",
            "allow-log-error",
            "allow-get-diagnostics",
            "allow-set-auto-update",
            "allow-check-for-update",
            "allow-install-update",
            "allow-get-setup",
            "allow-skip-setup-item",
            "allow-unskip-setup-item",
            "allow-dismiss-setup",
            "allow-get-mode",
            "allow-enter-sample-mode",
            "allow-exit-sample-mode",
        ]
    );
}

#[test]
fn no_os_access_plugins_are_linked() {
    for plugin in [
        "tauri-plugin-fs",
        "tauri-plugin-shell",
        "tauri-plugin-http",
        "tauri-plugin-opener",
    ] {
        assert!(
            !CARGO_TOML.contains(plugin),
            "{plugin} must not be a dependency (ADR 0003)"
        );
    }
}
