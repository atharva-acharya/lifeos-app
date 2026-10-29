mod commands;
pub mod index;
pub mod jobs;
mod live;
pub mod settings;
pub mod today;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(live::LiveState::default())
        .setup(|app| {
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
            commands::get_today,
            commands::get_jobs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
