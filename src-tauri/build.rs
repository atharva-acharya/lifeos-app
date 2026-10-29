const COMMANDS: &[&str] = &[
    "get_settings",
    "choose_vault_folder",
    "get_today",
    "save_google_config",
    "connect_google",
    "disconnect_google",
    "get_applications",
    "refresh_applications",
    "get_jobs",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
