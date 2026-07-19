//! Read-only profile scanning. Never writes to slicer directories.

use super::{descriptor, discovery, security};
use serde::Serialize;
use std::path::Path;

/// Files larger than this are skipped (a filament preset is a few KB;
/// anything huge is not a preset and must not be shipped to the frontend).
const MAX_PRESET_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
pub struct RawProfileFile {
    pub file_name: String,
    pub path: String,
    pub dir_kind: String, // "user" | "user_base" | "system"
    pub account_id: Option<String>,
    pub vendor: Option<String>,
    pub json: String,
    pub info: Option<String>,
    pub writable: bool,
}

fn read_preset_file(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_PRESET_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn scan_dir(
    dir: &Path,
    dir_kind: &str,
    account_id: Option<&str>,
    vendor: Option<&str>,
    writable: bool,
    out: &mut Vec<RawProfileFile>,
) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if !name.to_ascii_lowercase().ends_with(".json") {
            continue;
        }
        let Some(json) = read_preset_file(&p) else {
            continue;
        };
        let info_path = p.with_extension("info");
        let info = if info_path.is_file() {
            std::fs::read_to_string(&info_path).ok()
        } else {
            None
        };
        out.push(RawProfileFile {
            file_name: name,
            path: p.display().to_string(),
            dir_kind: dir_kind.to_string(),
            account_id: account_id.map(String::from),
            vendor: vendor.map(String::from),
            json,
            info,
            writable,
        });
    }
}

/// Scan a slicer's filament presets: the chosen account's user presets, its
/// `base/` cache, and the system vendor libraries (read-only clone sources).
#[tauri::command]
pub fn scan_slicer_profiles(
    slicer_id: String,
    account_id: String,
) -> Result<Vec<RawProfileFile>, String> {
    let s = descriptor(&slicer_id)?;
    let user_filament = discovery::filament_dir(&slicer_id, &account_id)?;
    let mut out = Vec::new();

    scan_dir(&user_filament, "user", Some(&account_id), None, true, &mut out);
    let base = user_filament.join("base");
    if base.is_dir() {
        scan_dir(&base, "user_base", Some(&account_id), None, false, &mut out);
    }

    // System vendor libraries: system/{Vendor}/filament/*.json
    let data_root = security::platform_data_root()?;
    let system_root = data_root.join(s.data_dir_name).join("system");
    if let Ok(rd) = std::fs::read_dir(&system_root) {
        for entry in rd.flatten() {
            let vendor_dir = entry.path();
            if !vendor_dir.is_dir() {
                continue;
            }
            let Some(vendor) = vendor_dir.file_name().and_then(|n| n.to_str()).map(String::from)
            else {
                continue;
            };
            let filament_dir = vendor_dir.join("filament");
            if filament_dir.is_dir() {
                scan_dir(&filament_dir, "system", None, Some(&vendor), false, &mut out);
            }
        }
    }
    Ok(out)
}
