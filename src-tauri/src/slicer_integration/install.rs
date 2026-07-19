//! Transactional profile installation:
//!   prepare → validate → backup (verified) → temp write → re-read/compare →
//!   atomic move → verify → report; roll back from the backup on any failure.
//!
//! The frontend supplies only slicer id, account id, profile name, and file
//! contents. All paths are resolved and validated here. `install_core` takes
//! explicit directories so integration tests run against temp dirs — never
//! against real slicer data.

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
/// preset dir are invisible to the slicer because they end in .tmp).
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

/// The whole install transaction, with every directory injected.
/// `dest_dir` must already exist. Assumes the running-process check (when
/// wanted) already happened.
#[allow(clippy::too_many_arguments)]
pub fn install_core(
    dest_dir: &Path,
    backups_root: &Path,
    allowed_restore_root: &Path,
    slicer_id: &str,
    profile_name: &str,
    preset_json: &str,
    info_text: &str,
    project_id: &str,
    allow_replace: bool,
) -> RawInstallOutcome {
    // --- validate inputs -----------------------------------------------------
    if security::validate_component(profile_name).is_err() {
        return fail("PROFILE_PARSE_FAILED", format!("Invalid profile name: {profile_name}"));
    }
    let parsed: serde_json::Value = match serde_json::from_str(preset_json) {
        Ok(v) => v,
        Err(e) => return fail("PROFILE_PARSE_FAILED", format!("Preset JSON invalid: {e}")),
    };
    if !parsed.is_object() {
        return fail("PROFILE_PARSE_FAILED", "Preset JSON is not an object".into());
    }
    if parsed["name"].as_str() != Some(profile_name) {
        return fail(
            "PROFILE_PARSE_FAILED",
            "Preset 'name' does not match the requested profile name".into(),
        );
    }

    let dest_json = dest_dir.join(format!("{profile_name}.json"));
    let dest_info = dest_dir.join(format!("{profile_name}.info"));
    for d in [&dest_json, &dest_info] {
        if let Err(e) = security::ensure_target_under(dest_dir, d) {
            return fail("UNKNOWN", e);
        }
    }

    // --- duplicate handling --------------------------------------------------
    let replaced_existing = dest_json.exists();
    if replaced_existing && !allow_replace {
        return fail(
            "DUPLICATE_PROFILE",
            format!("{} already exists", dest_json.display()),
        );
    }

    // --- backup (before touching anything) -----------------------------------
    let manifest = match backup::create_backup(
        backups_root,
        slicer_id,
        None,
        profile_name,
        project_id,
        &[dest_json.clone(), dest_info.clone()],
    ) {
        Ok(m) => m,
        Err(e) => return fail("BACKUP_FAILED", e),
    };
    let backup_id = manifest.backup_id.clone();

    // --- temp write + verify -------------------------------------------------
    let stamp = now_unix();
    let temp_json = dest_dir.join(format!(".perfectfit-{stamp}.json.tmp"));
    let temp_info = dest_dir.join(format!(".perfectfit-{stamp}.info.tmp"));
    let temps = [temp_json.clone(), temp_info.clone()];

    if let Err(e) = write_and_verify_temp(&temp_json, preset_json)
        .and_then(|_| write_and_verify_temp(&temp_info, info_text))
    {
        cleanup(&temps);
        let code = if e.contains("denied") || e.contains("Access is denied") {
            "WRITE_PERMISSION_DENIED"
        } else {
            "ATOMIC_WRITE_FAILED"
        };
        let mut out = fail(code, e);
        out.backup_id = Some(backup_id);
        return out;
    }

    // --- atomic move ---------------------------------------------------------
    if let Err(e) = move_into_place(&temp_json, &dest_json)
        .and_then(|_| move_into_place(&temp_info, &dest_info))
    {
        let rolled_back = backup::restore_backup_inner(&manifest, allowed_restore_root).is_ok();
        cleanup(&temps);
        let mut out = fail(
            if rolled_back { "ATOMIC_WRITE_FAILED" } else { "ROLLBACK_FAILED" },
            e,
        );
        out.backup_id = Some(backup_id);
        out.rolled_back = rolled_back;
        return out;
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
        let rolled_back = backup::restore_backup_inner(&manifest, allowed_restore_root).is_ok();
        let mut out = fail(
            if rolled_back { "INSTALL_VERIFICATION_FAILED" } else { "ROLLBACK_FAILED" },
            e,
        );
        out.backup_id = Some(backup_id);
        out.rolled_back = rolled_back;
        return out;
    }

    RawInstallOutcome {
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
    }
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

    if !skip_process_check {
        match processes::is_slicer_running(&slicer_id) {
            Ok(true) => return Ok(fail("SLICER_RUNNING", "Slicer process detected".into())),
            Ok(false) => {}
            Err(e) => return Ok(fail("UNKNOWN", format!("Process detection failed: {e}"))),
        }
    }

    let backups_root = backup::backups_root(&app)?;
    let data_root = security::platform_data_root()?;
    let slicer = super::descriptor(&slicer_id)?;
    let allowed_restore_root = data_root.join(slicer.data_dir_name);

    Ok(install_core(
        &dest_dir,
        &backups_root,
        &allowed_restore_root,
        &slicer_id,
        &profile_name,
        &preset_json,
        &info_text,
        &project_id,
        allow_replace,
    ))
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

// ---------------------------------------------------------------------------
// Integration tests — always temp directories, never real slicer data.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "perfectfit-test-{tag}-{}-{}",
                std::process::id(),
                now_unix()
            ));
            std::fs::create_dir_all(dir.join("filament")).unwrap();
            std::fs::create_dir_all(dir.join("backups")).unwrap();
            TempRoot(dir)
        }
        fn filament(&self) -> PathBuf {
            self.0.join("filament")
        }
        fn backups(&self) -> PathBuf {
            self.0.join("backups")
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const PRESET: &str = r#"{
    "from": "User",
    "inherits": "Generic PLA",
    "name": "PF Test Preset",
    "nozzle_temperature": ["215"],
    "version": "2.3.1.20"
}"#;
    const INFO: &str = "sync_info = create\nuser_id = \nsetting_id = \nbase_id = X\nupdated_time = 1\n";

    fn run_install(t: &TempRoot, name: &str, json: &str, allow_replace: bool) -> RawInstallOutcome {
        install_core(
            &t.filament(),
            &t.backups(),
            &t.0,
            "orca",
            name,
            json,
            INFO,
            "proj-1",
            allow_replace,
        )
    }

    #[test]
    fn fresh_install_succeeds_and_verifies() {
        let t = TempRoot::new("fresh");
        let out = run_install(&t, "PF Test Preset", PRESET, false);
        assert!(out.success, "{:?}", out.error_detail);
        assert!(out.verification_passed);
        assert!(out.backup_id.is_some());
        let installed = std::fs::read_to_string(t.filament().join("PF Test Preset.json")).unwrap();
        assert_eq!(installed, PRESET);
        let info = std::fs::read_to_string(t.filament().join("PF Test Preset.info")).unwrap();
        assert_eq!(info, INFO);
        // no leftover temp files
        let leftovers: Vec<_> = std::fs::read_dir(t.filament())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn duplicate_without_replace_is_blocked_before_any_change() {
        let t = TempRoot::new("dup");
        std::fs::write(t.filament().join("PF Test Preset.json"), "{\"original\": true}").unwrap();
        let out = run_install(&t, "PF Test Preset", PRESET, false);
        assert!(!out.success);
        assert_eq!(out.error_code.as_deref(), Some("DUPLICATE_PROFILE"));
        // original untouched
        let content = std::fs::read_to_string(t.filament().join("PF Test Preset.json")).unwrap();
        assert_eq!(content, "{\"original\": true}");
        // no backup dir was created for a refused install
        assert_eq!(std::fs::read_dir(t.backups()).unwrap().count(), 0);
    }

    #[test]
    fn replace_backs_up_and_restore_brings_back_the_original() {
        let t = TempRoot::new("replace");
        let original = "{\"name\": \"PF Test Preset\", \"origin\": \"old\"}";
        std::fs::write(t.filament().join("PF Test Preset.json"), original).unwrap();
        let out = run_install(&t, "PF Test Preset", PRESET, true);
        assert!(out.success, "{:?}", out.error_detail);
        assert_eq!(
            std::fs::read_to_string(t.filament().join("PF Test Preset.json")).unwrap(),
            PRESET
        );
        // restore the backup → original returns, new .info removed
        let manifest_path = t
            .backups()
            .join("orca")
            .join(out.backup_id.as_ref().unwrap())
            .join("manifest.json");
        let manifest: backup::ProfileBackupManifest =
            serde_json::from_str(&std::fs::read_to_string(manifest_path).unwrap()).unwrap();
        let (restored, deleted) = backup::restore_backup_inner(&manifest, &t.0).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(deleted.len(), 1); // .info didn't exist before
        assert_eq!(
            std::fs::read_to_string(t.filament().join("PF Test Preset.json")).unwrap(),
            original
        );
        assert!(!t.filament().join("PF Test Preset.info").exists());
    }

    #[test]
    fn invalid_json_is_rejected_without_touching_anything() {
        let t = TempRoot::new("badjson");
        let out = run_install(&t, "PF Test Preset", "{not json", false);
        assert!(!out.success);
        assert_eq!(out.error_code.as_deref(), Some("PROFILE_PARSE_FAILED"));
        assert_eq!(std::fs::read_dir(t.filament()).unwrap().count(), 0);
    }

    #[test]
    fn name_mismatch_is_rejected() {
        let t = TempRoot::new("namemismatch");
        let out = run_install(&t, "Different Name", PRESET, false);
        assert!(!out.success);
        assert_eq!(out.error_code.as_deref(), Some("PROFILE_PARSE_FAILED"));
    }

    #[test]
    fn traversal_names_are_rejected() {
        let t = TempRoot::new("traversal");
        for bad in ["..", "a/b", "a\\b", "con", "x?y"] {
            let json = PRESET.replace("PF Test Preset", bad);
            let out = run_install(&t, bad, &json, false);
            assert!(!out.success, "name {bad:?} must be rejected");
        }
        assert_eq!(std::fs::read_dir(t.filament()).unwrap().count(), 0);
    }

    #[test]
    fn backup_checksum_guards_corrupted_restores() {
        let t = TempRoot::new("corrupt");
        let original = "{\"name\": \"PF Test Preset\"}";
        std::fs::write(t.filament().join("PF Test Preset.json"), original).unwrap();
        let out = run_install(&t, "PF Test Preset", PRESET, true);
        assert!(out.success);
        let backup_dir = t.backups().join("orca").join(out.backup_id.as_ref().unwrap());
        let manifest: backup::ProfileBackupManifest = serde_json::from_str(
            &std::fs::read_to_string(backup_dir.join("manifest.json")).unwrap(),
        )
        .unwrap();
        // corrupt the backed-up copy
        let backed = manifest.files[0].backup_path.clone().unwrap();
        std::fs::write(&backed, "corrupted").unwrap();
        let err = backup::restore_backup_inner(&manifest, &t.0).unwrap_err();
        assert!(err.contains("checksum mismatch"));
        // the live file was not overwritten with corrupted data
        assert_eq!(
            std::fs::read_to_string(t.filament().join("PF Test Preset.json")).unwrap(),
            PRESET
        );
    }
}
