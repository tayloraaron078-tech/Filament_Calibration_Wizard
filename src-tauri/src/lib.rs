pub mod slicer_integration;

use slicer_integration::{backup, discovery, filesystem, install, processes};

/// Remove service-worker registrations and HTTP caches left behind by previous
/// installs. A cache-first service worker registered by an older version keeps
/// serving that version's index.html, whose hashed bundle no longer exists
/// after an update, wedging the app on the static loading screen. Runs before
/// the webview starts so no files are locked. IndexedDB and Local Storage
/// (user calibration data) are deliberately untouched.
#[cfg(target_os = "windows")]
fn purge_stale_webview_caches() {
  let Ok(local) = std::env::var("LOCALAPPDATA") else { return };
  let profile = std::path::Path::new(&local)
    .join("com.redeemed3d.perfectfit")
    .join("EBWebView")
    .join("Default");
  for dir in ["Service Worker", "Cache", "Code Cache"] {
    let _ = std::fs::remove_dir_all(profile.join(dir));
  }
}

#[cfg(not(target_os = "windows"))]
fn purge_stale_webview_caches() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  purge_stale_webview_caches();
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
