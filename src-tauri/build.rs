const COMMANDS: &[&str] = &[
    "get_settings",
    "choose_vault_folder",
    "choose_health_folder",
    "clear_health_folder",
    "get_today",
    "save_google_config",
    "connect_google",
    "disconnect_google",
    "get_applications",
    "refresh_applications",
    "get_jobs",
    "get_fitness",
    "get_projects",
    "get_health",
    "get_money",
    "add_transaction",
    "get_banks",
    "preview_import",
    "import_csv",
    "log_error",
    "get_diagnostics",
    "set_auto_update",
    "check_for_update",
    "install_update",
    "get_setup",
    "skip_setup_item",
    "unskip_setup_item",
    "dismiss_setup",
    "get_mode",
    "enter_sample_mode",
    "exit_sample_mode",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
