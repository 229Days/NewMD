mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::fs::pick_folder,
            commands::fs::pick_file,
            commands::fs::pick_save_path,
            commands::fs::list_dir,
            commands::fs::read_text_file,
            commands::fs::read_binary_file,
            commands::fs::write_text_file,
            commands::fs::write_binary_file,
            commands::fs::create_dir,
            commands::fs::rename_path,
            commands::fs::remove_path,
            commands::fs::path_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
