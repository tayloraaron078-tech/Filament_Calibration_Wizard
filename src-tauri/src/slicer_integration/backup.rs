//! Timestamped, checksummed backups of slicer files before installation,
//! with verified restore. Backups live in PerfectFit's own app-data folder:
//!
//! {app_data}/slicer-backups/{slicer-id}/{backup-id}/
//!     manifest.json
//!     files/0.json, 1.info, …
//!
//! Restore only ever writes back to the exact original paths recorded in the
//! manifest, re-validated against the slicer data roots at restore time.

use super::{iso_from_unix, now_unix, security};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileEntry {
    pub original_path: String,
    pub backup_path: Option<String>,
    pub checksum_sha256: Option<String>,
    pub existed_before: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBackupManifest {
    pub backup_id: String,
    pub slicer_id: String,
    pub slicer_version: Option<String>,
    pub created_at: String,
    pub installed_profile_name: String,
    pub perfect_fit_project_id: String,
    pub files: Vec<BackupFileEntry>,
    pub backup_root: String,
}

#[derive(Serialize)]
pub struct RawBackupSummary {
    pub backup_id: String,
    pub slicer_id: String,
    pub created_at: String,
    pub installed_profile_name: String,
    pub perfectfit_project_id: String,
    pub file_count: usize,
    pub backup_root: String,
}

pub fn backups_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("slicer-backups");
    Ok(dir)
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Read failed {}: {e}", path.display()))?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(format!("{:x}", h.finalize()))
}

/// Create and verify a backup covering `paths` (files that are about to be
/// created or replaced). Files that do not exist yet are recorded with
/// `existed_before: false` so restore knows to delete them.
pub fn create_backup(
    app: &tauri::AppHandle,
    slicer_id: &str,
    slicer_version: Option<String>,
    profile_name: &str,
    project_id: &str,
    paths: &[PathBuf],
) -> Result<ProfileBackupManifest, String> {
    let now = now_unix();
    let backup_id = format!("{now}-{}", std::process::id());
    let root = backups_root(app)?.join(slicer_id).join(&backup_id);
    let files_dir = root.join("files");
    std::fs::create_dir_all(&files_dir).map_err(|e| format!("Cannot create backup dir: {e}"))?;

    let mut entries = Vec::new();
    for (i, p) in paths.iter().enumerate() {
        if p.is_file() {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("bin")
                .to_ascii_lowercase();
            let dest = files_dir.join(format!("{i}.{ext}"));
            std::fs::copy(p, &dest).map_err(|e| format!("Backup copy failed for {}: {e}", p.display()))?;
            let src_sum = sha256_file(p)?;
            let dest_sum = sha256_file(&dest)?;
            if src_sum != dest_sum {
                return Err(format!("Backup verification failed for {}", p.display()));
            }
            entries.push(BackupFileEntry {
                original_path: p.display().to_string(),
                backup_path: Some(dest.display().to_string()),
                checksum_sha256: Some(src_sum),
                existed_before: true,
            });
        } else {
            entries.push(BackupFileEntry {
                original_path: p.display().to_string(),
                backup_path: None,
                checksum_sha256: None,
                existed_before: false,
            });
        }
    }

    let manifest = ProfileBackupManifest {
        backup_id: backup_id.clone(),
        slicer_id: slicer_id.to_string(),
        slicer_version,
        created_at: iso_from_unix(now),
        installed_profile_name: profile_name.to_string(),
        perfect_fit_project_id: project_id.to_string(),
        files: entries,
        backup_root: root.display().to_string(),
    };
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Manifest serialize failed: {e}"))?;
    let manifest_path = root.join("manifest.json");
    std::fs::write(&manifest_path, &manifest_json)
        .map_err(|e| format!("Manifest write failed: {e}"))?;
    // Verify the manifest is readable back.
    let reread = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Manifest re-read failed: {e}"))?;
    serde_json::from_str::<ProfileBackupManifest>(&reread)
        .map_err(|e| format!("Manifest re-parse failed: {e}"))?;
    Ok(manifest)
}

fn load_manifest(app: &tauri::AppHandle, backup_id: &str) -> Result<ProfileBackupManifest, String> {
    security::validate_component(backup_id)?;
    let root = backups_root(app)?;
    for slicer_dir in std::fs::read_dir(&root)
        .map_err(|e| format!("No backups found: {e}"))?
        .flatten()
    {
        let candidate = slicer_dir.path().join(backup_id).join("manifest.json");
        if candidate.is_file() {
            let raw = std::fs::read_to_string(&candidate)
                .map_err(|e| format!("Manifest read failed: {e}"))?;
            return serde_json::from_str(&raw).map_err(|e| format!("Manifest parse failed: {e}"));
        }
    }
    Err(format!("Backup {backup_id} not found"))
}

/// Restore a backup: copy back every file that existed before (after checksum
/// verification of the backed-up copy) and delete files that did not exist.
/// Original paths are re-validated against the slicer data roots.
pub fn restore_backup_inner(
    app: &tauri::AppHandle,
    manifest: &ProfileBackupManifest,
) -> Result<(Vec<String>, Vec<String>), String> {
    let data_root = security::platform_data_root()?;
    let slicer = super::descriptor(&manifest.slicer_id)?;
    let allowed_root = data_root.join(slicer.data_dir_name);
    let _ = app;

    let mut restored = Vec::new();
    let mut deleted = Vec::new();
    for f in &manifest.files {
        let original = PathBuf::from(&f.original_path);
        security::ensure_target_under(&allowed_root, &original)?;
        security::validate_preset_extension(
            original.file_name().and_then(|n| n.to_str()).unwrap_or(""),
        )?;
        if f.existed_before {
            let backup_path = f
                .backup_path
                .as_ref()
                .ok_or_else(|| "Manifest entry missing backup path".to_string())?;
            let bp = PathBuf::from(backup_path);
            let sum = sha256_file(&bp)?;
            if Some(&sum) != f.checksum_sha256.as_ref() {
                return Err(format!(
                    "Backup file checksum mismatch for {} — refusing to restore corrupted data",
                    bp.display()
                ));
            }
            std::fs::copy(&bp, &original)
                .map_err(|e| format!("Restore copy failed for {}: {e}", original.display()))?;
            let restored_sum = sha256_file(&original)?;
            if restored_sum != sum {
                return Err(format!("Restore verification failed for {}", original.display()));
            }
            restored.push(f.original_path.clone());
        } else if original.is_file() {
            std::fs::remove_file(&original)
                .map_err(|e| format!("Restore delete failed for {}: {e}", original.display()))?;
            deleted.push(f.original_path.clone());
        }
    }
    Ok((restored, deleted))
}

#[derive(Serialize)]
pub struct RestoreResult {
    pub restored_files: Vec<String>,
    pub deleted_files: Vec<String>,
}

#[tauri::command]
pub fn list_profile_backups(app: tauri::AppHandle) -> Result<Vec<RawBackupSummary>, String> {
    let root = backups_root(&app)?;
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(&root) else {
        return Ok(out);
    };
    for slicer_dir in rd.flatten() {
        let Ok(inner) = std::fs::read_dir(slicer_dir.path()) else {
            continue;
        };
        for b in inner.flatten() {
            let manifest_path = b.path().join("manifest.json");
            if !manifest_path.is_file() {
                continue;
            }
            if let Ok(raw) = std::fs::read_to_string(&manifest_path) {
                if let Ok(m) = serde_json::from_str::<ProfileBackupManifest>(&raw) {
                    out.push(RawBackupSummary {
                        backup_id: m.backup_id,
                        slicer_id: m.slicer_id,
                        created_at: m.created_at,
                        installed_profile_name: m.installed_profile_name,
                        perfectfit_project_id: m.perfect_fit_project_id,
                        file_count: m.files.len(),
                        backup_root: m.backup_root,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub fn get_profile_backup_manifest(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<ProfileBackupManifest, String> {
    load_manifest(&app, &backup_id)
}

#[tauri::command]
pub fn restore_profile_backup(
    app: tauri::AppHandle,
    backup_id: String,
) -> Result<RestoreResult, String> {
    let manifest = load_manifest(&app, &backup_id)?;
    let (restored_files, deleted_files) = restore_backup_inner(&app, &manifest)?;
    Ok(RestoreResult {
        restored_files,
        deleted_files,
    })
}

#[tauri::command]
pub fn delete_profile_backup(app: tauri::AppHandle, backup_id: String) -> Result<(), String> {
    security::validate_component(&backup_id)?;
    let root = backups_root(&app)?;
    for slicer_dir in std::fs::read_dir(&root)
        .map_err(|e| format!("No backups found: {e}"))?
        .flatten()
    {
        let dir = slicer_dir.path().join(&backup_id);
        if dir.join("manifest.json").is_file() {
            security::ensure_under(&root, &dir)?;
            std::fs::remove_dir_all(&dir).map_err(|e| format!("Delete failed: {e}"))?;
            return Ok(());
        }
    }
    Err(format!("Backup {backup_id} not found"))
}

#[tauri::command]
pub fn open_backup_directory(app: tauri::AppHandle, backup_id: String) -> Result<(), String> {
    let manifest = load_manifest(&app, &backup_id)?;
    let root = backups_root(&app)?;
    super::processes::open_directory_checked(Path::new(&manifest.backup_root), &[root])
}
