mod commands;
pub mod settings;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::choose_vault_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
