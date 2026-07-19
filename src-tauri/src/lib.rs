pub mod slicer_integration;

use slicer_integration::{backup, discovery, filesystem, install, processes};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      discovery::detect_supported_slicers,
      discovery::get_platform_info,
      filesystem::scan_slicer_profiles,
      processes::detect_running_slicer_process,
      processes::open_slicer,
      processes::open_profile_directory,
      backup::list_profile_backups,
      backup::get_profile_backup_manifest,
      backup::restore_profile_backup,
      backup::delete_profile_backup,
      backup::open_backup_directory,
      install::install_generated_profile,
      install::verify_generated_profile,
      install::save_exported_profile,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
