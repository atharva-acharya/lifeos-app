pub mod applications;
mod commands;
pub mod diagnostics;
pub mod fitness;
pub mod google;
pub mod health;
pub mod index;
pub mod jobs;
mod live;
pub mod money;
pub mod money_import;
pub mod onboarding;
pub mod projects;
pub mod sample;
mod sample_templates;
pub mod settings;
pub mod today;
mod updates;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(live::LiveState::default())
        .manage(updates::Pending::default())
        .manage(health::HealthState::default())
        .setup(|app| {
            // Panics go to the local error log as well as stderr.
            if let Ok(dir) = commands::cache_dir(app.handle()) {
                let default = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |info| {
                    let _ = diagnostics::append(
                        &dir,
                        applications::now_ms(),
                        "panic",
                        &info.to_string(),
                    );
                    default(info);
                }));
            }
            // Leftovers from a crash or a failed cleanup; the app always starts in real mode.
            if let Ok(dir) = commands::cache_dir(app.handle())
                && let Err(e) = sample::cleanup(&dir)
            {
                let _ = diagnostics::append(
                    &dir,
                    applications::now_ms(),
                    "sample",
                    &format!("could not remove old sample data: {e}"),
                );
            }
            let handle = app.handle().clone();
            // Index in the background so the window appears at once.
            std::thread::spawn(move || {
                let vault = commands::config_dir(&handle)
                    .ok()
                    .and_then(|dir| settings::load(&dir).ok())
                    .and_then(|s| s.vault_path)
                    .filter(|p| settings::validate_vault(p).is_ok());
                if let Some(vault) = vault {
                    let _ = live::start(&handle, &vault);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::choose_vault_folder,
            commands::choose_health_folder,
            commands::clear_health_folder,
            commands::get_today,
            commands::save_google_config,
            commands::connect_google,
            commands::disconnect_google,
            commands::get_applications,
            commands::refresh_applications,
            commands::get_jobs,
            commands::get_fitness,
            commands::get_projects,
            commands::get_health,
            commands::get_money,
            commands::add_transaction,
            commands::get_banks,
            commands::preview_import,
            commands::import_csv,
            commands::log_error,
            commands::get_diagnostics,
            commands::set_auto_update,
            commands::check_for_update,
            commands::install_update,
            commands::get_setup,
            commands::skip_setup_item,
            commands::unskip_setup_item,
            commands::dismiss_setup,
            commands::get_mode,
            commands::enter_sample_mode,
            commands::exit_sample_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
