//! Read-only detection of installed slicers: data directories, versions,
//! active preset folder, user-data locations, and executables.

use super::{descriptor, security, SLICERS};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct RawUserDataLocation {
    pub account_id: String,
    pub path: String,
    pub active: bool,
    pub filament_profile_count: usize,
}

#[derive(Serialize, Clone)]
pub struct RawDetectedSlicer {
    pub slicer_id: String,
    pub data_dir: Option<String>,
    pub conf_version: Option<String>,
    pub preset_folder: Option<String>,
    pub executable_path: Option<String>,
    pub user_locations: Vec<RawUserDataLocation>,
    pub notes: Vec<String>,
}

/// Parse the slicer's `.conf` (JSON followed by a `# MD5 checksum` line) and
/// extract `app.version` and `app.preset_folder`. Strictly read-only.
fn read_conf(data_dir: &Path, data_dir_name: &str) -> (Option<String>, Option<String>, Vec<String>) {
    let mut notes = Vec::new();
    let conf_path = data_dir.join(format!("{data_dir_name}.conf"));
    let raw = match std::fs::read_to_string(&conf_path) {
        Ok(r) => r,
        Err(_) => {
            notes.push(format!("Config file not readable: {}", conf_path.display()));
            return (None, None, notes);
        }
    };
    let body = raw.split("# MD5 checksum").next().unwrap_or("");
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(v) => {
            let app = &v["app"];
            let version = app["version"].as_str().map(|s| s.to_string());
            let preset_folder = app["preset_folder"].as_str().map(|s| s.to_string());
            (version, preset_folder, notes)
        }
        Err(e) => {
            notes.push(format!("Config parse failed: {e}"));
            (None, None, notes)
        }
    }
}

fn count_filament_presets(user_dir: &Path) -> usize {
    let filament = user_dir.join("filament");
    match std::fs::read_dir(&filament) {
        Ok(rd) => rd
            .flatten()
            .filter(|e| {
                e.path().is_file()
                    && e.file_name()
                        .to_str()
                        .map(|n| n.to_ascii_lowercase().ends_with(".json"))
                        .unwrap_or(false)
            })
            .count(),
        Err(_) => 0,
    }
}

fn find_user_locations(data_dir: &Path, preset_folder: &Option<String>) -> Vec<RawUserDataLocation> {
    let user_root = data_dir.join("user");
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&user_root) else {
        return out;
    };
    let active_id = preset_folder
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "default".to_string());
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        // Only preset-shaped account dirs (they contain a filament/ or machine/ dir).
        if !p.join("filament").is_dir() && !p.join("machine").is_dir() {
            continue;
        }
        out.push(RawUserDataLocation {
            active: name == active_id,
            filament_profile_count: count_filament_presets(&p),
            path: p.display().to_string(),
            account_id: name,
        });
    }
    // Active first, then by profile count.
    out.sort_by(|a, b| {
        b.active
            .cmp(&a.active)
            .then(b.filament_profile_count.cmp(&a.filament_profile_count))
    });
    out
}

fn find_executable(candidates: &[&str], macos_candidates: &[&str]) -> Option<PathBuf> {
    let _ = (candidates, macos_candidates); // each cfg branch uses one of them
    for root in security::program_roots() {
        #[cfg(target_os = "windows")]
        for cand in candidates {
            let p = root.join(cand);
            if p.is_file() {
                return Some(p);
            }
        }
        #[cfg(target_os = "macos")]
        for cand in macos_candidates {
            let p = root.join(cand);
            if p.exists() {
                return Some(p);
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = (&root, candidates, macos_candidates);
        }
    }
    None
}

#[tauri::command]
pub fn detect_supported_slicers() -> Result<Vec<RawDetectedSlicer>, String> {
    let data_root = security::platform_data_root()?;
    let mut result = Vec::new();
    for s in SLICERS {
        let data_dir = data_root.join(s.data_dir_name);
        let exe = find_executable(s.windows_exe_candidates, s.macos_app_candidates);
        if !data_dir.is_dir() && exe.is_none() {
            continue; // not installed
        }
        let (version, preset_folder, notes) = if data_dir.is_dir() {
            read_conf(&data_dir, s.data_dir_name)
        } else {
            (None, None, vec!["Data directory not found; the slicer may never have been started.".into()])
        };
        let user_locations = if data_dir.is_dir() {
            find_user_locations(&data_dir, &preset_folder)
        } else {
            Vec::new()
        };
        result.push(RawDetectedSlicer {
            slicer_id: s.id.to_string(),
            data_dir: data_dir.is_dir().then(|| data_dir.display().to_string()),
            conf_version: version,
            preset_folder,
            executable_path: exe.map(|p| p.display().to_string()),
            user_locations,
            notes,
        });
    }
    Ok(result)
}

/// Resolve and validate the filament directory for a slicer + account id.
pub fn filament_dir(slicer_id: &str, account_id: &str) -> Result<PathBuf, String> {
    security::validate_component(account_id)?;
    let s = descriptor(slicer_id)?;
    let data_root = security::platform_data_root()?;
    let dir = data_root
        .join(s.data_dir_name)
        .join("user")
        .join(account_id)
        .join("filament");
    if !dir.is_dir() {
        return Err(format!("USER_DATA_NOT_FOUND: {}", dir.display()));
    }
    // Belt and braces: the resolved dir must stay inside the slicer's data dir.
    security::ensure_under(&data_root.join(s.data_dir_name), &dir)?;
    Ok(dir)
}

#[derive(Serialize)]
pub struct PlatformInfo {
    pub platform: String,
    pub os_version: String,
}

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    PlatformInfo {
        platform: platform.to_string(),
        os_version: std::env::consts::OS.to_string(),
    }
}
