const COMMANDS: &[&str] = &[
    "get_settings",
    "choose_vault_folder",
    "get_today",
    "get_jobs",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
