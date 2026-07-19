//! Transactional profile installation:
//!   prepare → validate → backup (verified) → temp write → re-read/compare →
//!   atomic move → verify → report; roll back from the backup on any failure.
//!
//! The frontend supplies only slicer id, account id, profile name, and file
//! contents. All paths are resolved and validated here.

use super::{backup, discovery, now_unix, processes, security};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Default)]
pub struct RawInstallOutcome {
    pub success: bool,
    pub installed_files: Vec<String>,
    pub changed_files: Vec<String>,
    pub backup_id: Option<String>,
    pub verification_passed: bool,
    pub rolled_back: bool,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
}

fn fail(code: &str, detail: String) -> RawInstallOutcome {
    RawInstallOutcome {
        success: false,
        error_code: Some(code.to_string()),
        error_detail: Some(detail),
        ..Default::default()
    }
}

/// Best-effort removal of temp files; errors are ignored (temp files in the
/// preset dir are invisible to the slicer because they have no .json name).
fn cleanup(paths: &[PathBuf]) {
    for p in paths {
        let _ = std::fs::remove_file(p);
    }
}

fn write_and_verify_temp(path: &Path, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("Temp write failed: {e}"))?;
    let reread = std::fs::read_to_string(path).map_err(|e| format!("Temp re-read failed: {e}"))?;
    if reread != content {
        return Err("Temp file content mismatch after write".into());
    }
    Ok(())
}

/// Move temp into place. Windows rename fails when the destination exists, so
/// replacement removes the destination first — safe because a verified backup
/// of it already exists.
fn move_into_place(temp: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| format!("Could not replace {}: {e}", dest.display()))?;
    }
    std::fs::rename(temp, dest).map_err(|e| format!("Atomic move failed: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn install_generated_profile(
    app: tauri::AppHandle,
    slicer_id: String,
    account_id: String,
    profile_name: String,
    preset_json: String,
    info_text: String,
    project_id: String,
    allow_replace: bool,
    skip_process_check: bool,
) -> Result<RawInstallOutcome, String> {
    // --- prepare & validate -------------------------------------------------
    if security::validate_component(&profile_name).is_err() {
        return Ok(fail("PROFILE_PARSE_FAILED", format!("Invalid profile name: {profile_name}")));
    }
    let parsed: serde_json::Value = match serde_json::from_str(&preset_json) {
        Ok(v) => v,
        Err(e) => return Ok(fail("PROFILE_PARSE_FAILED", format!("Preset JSON invalid: {e}"))),
    };
    if !parsed.is_object() {
        return Ok(fail("PROFILE_PARSE_FAILED", "Preset JSON is not an object".into()));
    }
    if parsed["name"].as_str() != Some(profile_name.as_str()) {
        return Ok(fail(
            "PROFILE_PARSE_FAILED",
            "Preset 'name' does not match the requested profile name".into(),
        ));
    }

    let dest_dir = match discovery::filament_dir(&slicer_id, &account_id) {
        Ok(d) => d,
        Err(e) => {
            let code = if e.starts_with("USER_DATA_NOT_FOUND") {
                "USER_DATA_NOT_FOUND"
            } else {
                "UNKNOWN"
            };
            return Ok(fail(code, e));
        }
    };

    // --- running slicer check ----------------------------------------------
    if !skip_process_check {
        match processes::is_slicer_running(&slicer_id) {
            Ok(true) => return Ok(fail("SLICER_RUNNING", "Slicer process detected".into())),
            Ok(false) => {}
            Err(e) => return Ok(fail("UNKNOWN", format!("Process detection failed: {e}"))),
        }
    }

    let dest_json = dest_dir.join(format!("{profile_name}.json"));
    let dest_info = dest_dir.join(format!("{profile_name}.info"));
    for d in [&dest_json, &dest_info] {
        if let Err(e) = security::ensure_target_under(&dest_dir, d) {
            return Ok(fail("UNKNOWN", e));
        }
    }

    // --- duplicate handling -------------------------------------------------
    if dest_json.exists() && !allow_replace {
        return Ok(fail(
            "DUPLICATE_PROFILE",
            format!("{} already exists", dest_json.display()),
        ));
    }

    // --- backup (before touching anything) ----------------------------------
    let slicer_version = None; // recorded by the frontend in its own records
    let manifest = match backup::create_backup(
        &app,
        &slicer_id,
        slicer_version,
        &profile_name,
        &project_id,
        &[dest_json.clone(), dest_info.clone()],
    ) {
        Ok(m) => m,
        Err(e) => return Ok(fail("BACKUP_FAILED", e)),
    };
    let backup_id = manifest.backup_id.clone();

    // --- temp write + verify -------------------------------------------------
    let stamp = now_unix();
    let temp_json = dest_dir.join(format!(".perfectfit-{stamp}.json.tmp"));
    let temp_info = dest_dir.join(format!(".perfectfit-{stamp}.info.tmp"));
    let temps = [temp_json.clone(), temp_info.clone()];

    if let Err(e) = write_and_verify_temp(&temp_json, &preset_json)
        .and_then(|_| write_and_verify_temp(&temp_info, &info_text))
    {
        cleanup(&temps);
        let code = if e.contains("denied") || e.contains("Access is denied") {
            "WRITE_PERMISSION_DENIED"
        } else {
            "ATOMIC_WRITE_FAILED"
        };
        let mut out = fail(code, e);
        out.backup_id = Some(backup_id);
        return Ok(out);
    }

    // --- atomic move ---------------------------------------------------------
    let replaced_existing = dest_json.exists();
    if let Err(e) = move_into_place(&temp_json, &dest_json)
        .and_then(|_| move_into_place(&temp_info, &dest_info))
    {
        // Roll back whatever landed, then report.
        let rolled_back = backup::restore_backup_inner(&app, &manifest).is_ok();
        cleanup(&temps);
        let mut out = fail(
            if rolled_back { "ATOMIC_WRITE_FAILED" } else { "ROLLBACK_FAILED" },
            e,
        );
        out.backup_id = Some(backup_id);
        out.rolled_back = rolled_back;
        return Ok(out);
    }

    // --- post-install verification ------------------------------------------
    let verification = std::fs::read_to_string(&dest_json)
        .map_err(|e| format!("Installed file unreadable: {e}"))
        .and_then(|installed| {
            let installed_val: serde_json::Value = serde_json::from_str(&installed)
                .map_err(|e| format!("Installed file is not valid JSON: {e}"))?;
            if installed_val == parsed {
                Ok(())
            } else {
                Err("Installed file does not match the generated profile".into())
            }
        })
        .and_then(|_| {
            let info = std::fs::read_to_string(&dest_info)
                .map_err(|e| format!("Installed .info unreadable: {e}"))?;
            if info == info_text {
                Ok(())
            } else {
                Err("Installed .info does not match".into())
            }
        });

    if let Err(e) = verification {
        let rolled_back = backup::restore_backup_inner(&app, &manifest).is_ok();
        let mut out = fail(
            if rolled_back { "INSTALL_VERIFICATION_FAILED" } else { "ROLLBACK_FAILED" },
            e,
        );
        out.backup_id = Some(backup_id);
        out.rolled_back = rolled_back;
        return Ok(out);
    }

    Ok(RawInstallOutcome {
        success: true,
        installed_files: vec![dest_json.display().to_string(), dest_info.display().to_string()],
        changed_files: if replaced_existing {
            vec![dest_json.display().to_string(), dest_info.display().to_string()]
        } else {
            Vec::new()
        },
        backup_id: Some(backup_id),
        verification_passed: true,
        rolled_back: false,
        error_code: None,
        error_detail: None,
    })
}

#[derive(Serialize)]
pub struct VerifyResult {
    pub verified: bool,
    pub detail: String,
}

/// Re-verify an installed profile file against expected content (semantic
/// JSON comparison). Read-only; path must live inside a slicer data dir.
#[tauri::command]
pub fn verify_generated_profile(path: String, expected_json: String) -> Result<VerifyResult, String> {
    let p = PathBuf::from(&path);
    let data_root = security::platform_data_root()?;
    let mut allowed = false;
    for s in super::SLICERS {
        let root = data_root.join(s.data_dir_name);
        if root.is_dir() && security::ensure_under(&root, &p).is_ok() {
            allowed = true;
            break;
        }
    }
    if !allowed {
        return Err("Path is outside slicer data directories".into());
    }
    security::validate_preset_extension(p.file_name().and_then(|n| n.to_str()).unwrap_or(""))?;
    let actual = match std::fs::read_to_string(&p) {
        Ok(a) => a,
        Err(e) => {
            return Ok(VerifyResult {
                verified: false,
                detail: format!("File unreadable: {e}"),
            })
        }
    };
    let a: serde_json::Value = match serde_json::from_str(&actual) {
        Ok(v) => v,
        Err(e) => {
            return Ok(VerifyResult {
                verified: false,
                detail: format!("Installed file is not valid JSON: {e}"),
            })
        }
    };
    let b: serde_json::Value =
        serde_json::from_str(&expected_json).map_err(|e| format!("Expected JSON invalid: {e}"))?;
    if a == b {
        Ok(VerifyResult {
            verified: true,
            detail: "Installed profile matches the generated profile".into(),
        })
    } else {
        Ok(VerifyResult {
            verified: false,
            detail: "Installed profile differs from the generated profile".into(),
        })
    }
}

/// Export via a native save dialog. The user picks the destination, which is
/// the authorization for that single write. Content is written, re-read, and
/// verified before reporting the saved path.
#[tauri::command]
pub async fn save_exported_profile(
    app: tauri::AppHandle,
    default_file_name: String,
    preset_json: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if security::validate_component(&default_file_name).is_err() {
        return Err("Invalid default file name".into());
    }
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_file_name)
        .add_filter("Filament preset", &["json"])
        .blocking_save_file();
    let Some(file_path) = picked else {
        return Ok(None); // user cancelled
    };
    let mut path = file_path
        .into_path()
        .map_err(|e| format!("Unsupported save location: {e}"))?;
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("json"))
        .unwrap_or(true)
    {
        path.set_extension("json");
    }
    std::fs::write(&path, &preset_json).map_err(|e| format!("Save failed: {e}"))?;
    let reread = std::fs::read_to_string(&path).map_err(|e| format!("Verification read failed: {e}"))?;
    if reread != preset_json {
        return Err("Saved file did not verify".into());
    }
    Ok(Some(path.display().to_string()))
}
