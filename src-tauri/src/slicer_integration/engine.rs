//! Automated-calibration slicing engine — native side (Stage 5).
//!
//! Discovery, capability *validation* (never name-trust), a tamper-evident
//! engine manifest (sha256 of the executable), and a safe process runner that
//! captures exit code, duration, timeout, and cancellation but **never stdout**
//! — Orca's CLI output is uncapturable, so success is judged from artifacts and
//! the engine's own `<datadir>/log/` (see Developer HQ DECISIONS 2026-07-26).
//!
//! Only the *installed Orca* engine has a native side here. `manual_export`
//! and `bambu_handoff` are handled entirely in TypeScript; the optional
//! `managed_orca` engine arrives in Stage 9. No Orca binary is bundled or
//! downloaded — this only ever references an install the user already has, or
//! an executable the user explicitly selects.

use super::{iso_from_unix, now_unix, security};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Manifest schema version for persisted engine records.
const ENGINE_MANIFEST_SCHEMA: u32 = 1;
/// An OrcaSlicer install the user already has (or an exe they select).
const INSTALLED_ORCA: &str = "installed_orca";
/// A PerfectFit-managed OrcaSlicer, downloaded on demand into our own engines
/// root (Stage 9). Detection/validation reuse the exact same structural checks
/// and tamper-evident manifest as `installed_orca`; only the *location* differs
/// (our managed root, never the user's Program Files / real Orca datadir).
const MANAGED_ORCA: &str = "managed_orca";

#[cfg(target_os = "windows")]
fn no_window(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(target_os = "windows"))]
fn no_window(cmd: &mut Command) -> &mut Command {
    cmd
}

// --- capability + detection result shapes (snake_case → TS maps to camel) ----

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct EngineCapabilities {
    pub slice: bool,
    pub export_3mf: bool,
    pub export_gcode: bool,
    pub multi_plate: bool,
    pub multi_extruder: bool,
}

impl EngineCapabilities {
    /// Conservative "nothing proven" set — the safe default before validation.
    fn empty() -> Self {
        EngineCapabilities {
            slice: false,
            export_3mf: false,
            export_gcode: false,
            multi_plate: false,
            multi_extruder: false,
        }
    }
}

/// Combined detection + validation payload. The TS side splits this into the
/// `EngineDetectionResult` / `EngineValidationResult` contracts.
#[derive(Serialize, Clone)]
pub struct RawEngineDetection {
    pub engine_id: String,
    pub detected: bool,
    pub display_name: String,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    /// "installed" | "manual" | "none".
    pub source: String,
    pub checksum_sha256: Option<String>,
    pub capabilities: EngineCapabilities,
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub notes: Vec<String>,
}

/// Persisted, tamper-evident record of a vetted engine. The runner reads this
/// rather than accepting an executable path from the frontend, so a slice can
/// only ever launch an executable the user already vetted through detection.
#[derive(Serialize, Deserialize, Clone)]
pub struct StoredEngineManifest {
    pub schema_version: u32,
    pub engine_id: String,
    pub display_name: String,
    pub executable_path: String,
    pub version: Option<String>,
    pub source: String,
    pub checksum_sha256: String,
    pub capabilities: EngineCapabilities,
    pub detected_at: String,
}

// --- executable + capability validation -------------------------------------

/// Stream a file through SHA-256 without loading it all into memory (engine
/// executables are ~100 MB).
fn sha256_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65_536];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("Read failed: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Validate an executable path the user selected via a file dialog: it must be
/// an existing file, and on Windows carry an `.exe` extension. Returns the
/// canonicalized path.
fn validate_manual_exe(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("No executable selected".into());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Executable path contains invalid characters".into());
    }
    let p = Path::new(trimmed);
    if !p.is_file() {
        return Err(format!("Selected file does not exist: {}", p.display()));
    }
    #[cfg(target_os = "windows")]
    {
        let ok = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if !ok {
            return Err("Selected file is not an .exe".into());
        }
    }
    std::fs::canonicalize(p).map_err(|e| format!("Cannot resolve {}: {e}", p.display()))
}

/// Auto-detect an installed OrcaSlicer executable under the program-files roots.
fn find_installed_orca() -> Option<PathBuf> {
    let s = super::descriptor("orca").ok()?;
    for root in security::program_roots() {
        #[cfg(target_os = "windows")]
        for cand in s.windows_exe_candidates {
            let p = root.join(cand);
            if p.is_file() {
                return Some(p);
            }
        }
        #[cfg(target_os = "macos")]
        for cand in s.macos_app_candidates {
            let p = root.join(cand);
            if p.exists() {
                return Some(p);
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            let _ = (&root, s);
        }
    }
    None
}

/// The PerfectFit-managed Orca root (`<engines_root>/managed-orca`). The
/// download-on-demand acquisition (Stage 9 incr. 2) extracts an Orca build here;
/// this stays a pure path helper so detection works before any installer exists.
fn managed_orca_root() -> Result<PathBuf, String> {
    Ok(security::engines_root()?.join("managed-orca"))
}

/// Locate the managed Orca executable, if it has been installed. A portable Orca
/// build extracts either flat (`managed-orca/orca-slicer.exe`) or under its own
/// folder (`managed-orca/OrcaSlicer/orca-slicer.exe`); both layouts are accepted,
/// and validation (below) still requires a real `resources/` tree beside the exe.
fn find_managed_orca() -> Option<PathBuf> {
    find_managed_orca_in(&managed_orca_root().ok()?)
}

/// Root-parameterized so the flat-vs-foldered layout logic is unit-testable
/// without touching the real engines root.
fn find_managed_orca_in(root: &Path) -> Option<PathBuf> {
    let s = super::descriptor("orca").ok()?;
    #[cfg(target_os = "windows")]
    {
        let foldered = root.join(s.windows_exe_candidates[0]); // OrcaSlicer\orca-slicer.exe
        let flat = Path::new(s.windows_exe_candidates[0])
            .file_name()
            .map(|f| root.join(f)); // orca-slicer.exe
        for cand in [Some(foldered), flat].into_iter().flatten() {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    #[cfg(target_os = "macos")]
    for cand in s.macos_app_candidates {
        let p = root.join(cand);
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (root, s);
    }
    None
}

/// Version the acquisition step recorded next to the managed build, if any.
/// Absent (returns `None`) until Stage 9 incr. 2 writes it — never fabricated.
fn managed_orca_version() -> Option<String> {
    let v = managed_orca_root().ok()?.join("version.txt");
    std::fs::read_to_string(v).ok().and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

/// Resolve and validate the PerfectFit-managed Orca engine, persisting its
/// manifest. Mirrors `detect_installed_orca` but reads only from our managed
/// root — there is no manual-exe path here (the location is ours, not chosen).
fn detect_managed_orca() -> Result<RawEngineDetection, String> {
    let mut notes = Vec::new();
    let Some(exe) = find_managed_orca() else {
        return Ok(RawEngineDetection {
            engine_id: MANAGED_ORCA.into(),
            detected: false,
            display_name: "Managed OrcaSlicer".into(),
            version: None,
            executable_path: None,
            source: "none".into(),
            checksum_sha256: None,
            capabilities: EngineCapabilities::empty(),
            valid: false,
            errors: vec![
                "The managed OrcaSlicer engine has not been installed yet.".into(),
            ],
            warnings: Vec::new(),
            notes,
        });
    };

    let (capabilities, errors, warnings) = validate_orca_capabilities(&exe);
    let valid = errors.is_empty();
    let version = managed_orca_version();
    if valid && version.is_none() {
        notes.push("Managed Orca version file missing — reinstall to record it".into());
    }

    let checksum = if valid {
        match sha256_file(&exe) {
            Ok(c) => Some(c),
            Err(e) => {
                notes.push(format!("Checksum unavailable: {e}"));
                None
            }
        }
    } else {
        None
    };

    if valid {
        if let Some(ref checksum) = checksum {
            let manifest = StoredEngineManifest {
                schema_version: ENGINE_MANIFEST_SCHEMA,
                engine_id: MANAGED_ORCA.into(),
                display_name: "Managed OrcaSlicer".into(),
                executable_path: exe.display().to_string(),
                version: version.clone(),
                source: "managed".into(),
                checksum_sha256: checksum.clone(),
                capabilities,
                detected_at: iso_from_unix(now_unix()),
            };
            match security::engines_root() {
                Ok(dir) => {
                    if let Err(e) = write_manifest_to(&dir, &manifest) {
                        notes.push(format!("Could not persist engine manifest: {e}"));
                    }
                }
                Err(e) => notes.push(format!("Could not locate engines directory: {e}")),
            }
        }
    }

    Ok(RawEngineDetection {
        engine_id: MANAGED_ORCA.into(),
        detected: true,
        display_name: "Managed OrcaSlicer".into(),
        version,
        executable_path: Some(exe.display().to_string()),
        source: "managed".into(),
        checksum_sha256: checksum,
        capabilities,
        valid,
        errors,
        warnings,
        notes,
    })
}

/// Locate the `resources/` directory that ships beside an Orca executable.
/// On macOS the executable lives inside the `.app` bundle, so walk up to it.
pub(crate) fn resources_dir_for(exe: &Path) -> Option<PathBuf> {
    // Windows/Linux: <install>/orca-slicer.exe → <install>/resources.
    if let Some(parent) = exe.parent() {
        let r = parent.join("resources");
        if r.is_dir() {
            return Some(r);
        }
        // macOS bundle: …/OrcaSlicer.app/Contents/MacOS/exe → …/Contents/Resources.
        if let Some(contents) = parent.parent() {
            let r = contents.join("Resources").join("resources");
            if r.is_dir() {
                return Some(r);
            }
            let r2 = contents.join("Resources");
            if r2.join("calib").is_dir() {
                return Some(r2);
            }
        }
    }
    None
}

/// Capability validation by *structure*, not by executable name. A real Orca
/// calibration-capable install ships `resources/calib` (the calibration models)
/// and `resources/profiles` (the vendor preset trees) — the very things the
/// automated pipeline depends on. An executable that merely *claims* to be Orca
/// but lacks them is reported invalid.
fn validate_orca_capabilities(exe: &Path) -> (EngineCapabilities, Vec<String>, Vec<String>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    if !exe.is_file() {
        errors.push("Executable not found".into());
        return (EngineCapabilities::empty(), errors, warnings);
    }
    let Some(resources) = resources_dir_for(exe) else {
        errors.push(
            "No resources/ directory beside the executable — cannot confirm this is a slicing engine".into(),
        );
        return (EngineCapabilities::empty(), errors, warnings);
    };
    let has_calib = resources.join("calib").is_dir();
    let has_profiles = resources.join("profiles").is_dir();
    if !has_calib {
        errors.push("resources/calib not found — calibration models are missing".into());
    }
    if !has_profiles {
        errors.push("resources/profiles not found — printer preset trees are missing".into());
    }
    if !errors.is_empty() {
        return (EngineCapabilities::empty(), errors, warnings);
    }
    // Proven from structure: can headless-slice a self-contained project 3mf to
    // g-code, and can consume/produce project 3mf. Multi-plate / multi-extruder
    // are real Orca features but not cheaply verifiable without slicing, so they
    // stay conservatively false rather than name-trusted.
    warnings.push("Multi-plate and multi-extruder support not verified without a trial slice".into());
    (
        EngineCapabilities {
            slice: true,
            export_3mf: true,
            export_gcode: true,
            multi_plate: false,
            multi_extruder: false,
        },
        errors,
        warnings,
    )
}

/// Best-effort Orca version from the installed slicer's `.conf` (read-only).
/// Only meaningful for the standard install; a portable/manual exe reports
/// `None` with a note rather than a fabricated version.
fn installed_orca_version() -> Option<String> {
    let data_dir = security::platform_data_root().ok()?.join("OrcaSlicer");
    let conf = data_dir.join("OrcaSlicer.conf");
    let raw = std::fs::read_to_string(conf).ok()?;
    let body = raw.split("# MD5 checksum").next().unwrap_or("");
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    v["app"]["version"].as_str().map(|s| s.to_string())
}

// --- manifest persistence ----------------------------------------------------

fn manifest_path(dir: &Path, engine_id: &str) -> PathBuf {
    dir.join(format!("{engine_id}.json"))
}

fn write_manifest_to(dir: &Path, m: &StoredEngineManifest) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(m).map_err(|e| format!("Serialize failed: {e}"))?;
    let path = manifest_path(dir, &m.engine_id);
    std::fs::write(&path, json).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

/// The `resources/` root of a vetted engine, resolved from its persisted
/// manifest. Used to confine a calibration template to the user's own install.
pub(crate) fn engine_resources_root(engine_id: &str) -> Option<PathBuf> {
    let dir = security::engines_root().ok()?;
    let m = read_manifest_from(&dir, engine_id).ok()??;
    resources_dir_for(Path::new(&m.executable_path))
}

fn read_manifest_from(dir: &Path, engine_id: &str) -> Result<Option<StoredEngineManifest>, String> {
    let path = manifest_path(dir, engine_id);
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Corrupt engine manifest {}: {e}", path.display())),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read {}: {e}", path.display())),
    }
}

// --- detection / validation core --------------------------------------------

/// Resolve and validate the installed-Orca engine, optionally from a
/// user-selected executable, and persist its manifest.
fn detect_installed_orca(manual_exe_path: Option<String>) -> Result<RawEngineDetection, String> {
    let mut notes = Vec::new();
    let (exe, source) = match manual_exe_path {
        Some(p) => (validate_manual_exe(&p)?, "manual"),
        None => match find_installed_orca() {
            Some(p) => (p, "installed"),
            None => {
                return Ok(RawEngineDetection {
                    engine_id: INSTALLED_ORCA.into(),
                    detected: false,
                    display_name: "Installed OrcaSlicer".into(),
                    version: None,
                    executable_path: None,
                    source: "none".into(),
                    checksum_sha256: None,
                    capabilities: EngineCapabilities::empty(),
                    valid: false,
                    errors: vec!["OrcaSlicer was not found in Program Files. Install it or select the executable manually.".into()],
                    warnings: Vec::new(),
                    notes,
                });
            }
        },
    };

    let (capabilities, errors, warnings) = validate_orca_capabilities(&exe);
    let valid = errors.is_empty();
    let version = if source == "installed" {
        installed_orca_version()
    } else {
        notes.push("Version cannot be read for a manually-selected executable".into());
        None
    };

    let checksum = if valid {
        match sha256_file(&exe) {
            Ok(c) => Some(c),
            Err(e) => {
                notes.push(format!("Checksum unavailable: {e}"));
                None
            }
        }
    } else {
        None
    };

    // Persist a manifest only for a vetted engine so the runner has something
    // trustworthy to launch. An invalid engine is reported but not recorded.
    if valid {
        if let Some(ref checksum) = checksum {
            let manifest = StoredEngineManifest {
                schema_version: ENGINE_MANIFEST_SCHEMA,
                engine_id: INSTALLED_ORCA.into(),
                display_name: "Installed OrcaSlicer".into(),
                executable_path: exe.display().to_string(),
                version: version.clone(),
                source: source.into(),
                checksum_sha256: checksum.clone(),
                capabilities,
                detected_at: iso_from_unix(now_unix()),
            };
            match security::engines_root() {
                Ok(dir) => {
                    if let Err(e) = write_manifest_to(&dir, &manifest) {
                        notes.push(format!("Could not persist engine manifest: {e}"));
                    }
                }
                Err(e) => notes.push(format!("Could not locate engines directory: {e}")),
            }
        }
    }

    Ok(RawEngineDetection {
        engine_id: INSTALLED_ORCA.into(),
        detected: true,
        display_name: "Installed OrcaSlicer".into(),
        version,
        executable_path: Some(exe.display().to_string()),
        source: source.into(),
        checksum_sha256: checksum,
        capabilities,
        valid,
        errors,
        warnings,
        notes,
    })
}

/// Detect (and validate) a slicing engine. `manual_exe_path` lets the user pick
/// an OrcaSlicer executable a standard scan wouldn't find (a portable copy or a
/// non-default install location).
#[tauri::command]
pub fn detect_slicing_engine(
    engine_id: String,
    manual_exe_path: Option<String>,
) -> Result<RawEngineDetection, String> {
    if engine_id == INSTALLED_ORCA {
        detect_installed_orca(manual_exe_path)
    } else if engine_id == MANAGED_ORCA {
        detect_managed_orca()
    } else {
        // manual_export / bambu_handoff have no native detection.
        Ok(RawEngineDetection {
            engine_id: engine_id.clone(),
            detected: false,
            display_name: engine_id.clone(),
            version: None,
            executable_path: None,
            source: "none".into(),
            checksum_sha256: None,
            capabilities: EngineCapabilities::empty(),
            valid: false,
            errors: vec![format!("No native detection for engine '{engine_id}'")],
            warnings: Vec::new(),
            notes: Vec::new(),
        })
    }
}

/// Re-validate a previously-detected engine from its persisted manifest: the
/// executable must still exist and its checksum still match, guarding against a
/// replaced or upgraded binary between sessions.
#[tauri::command]
pub fn validate_slicing_engine(engine_id: String) -> Result<RawEngineDetection, String> {
    // Only the manifest-backed Orca engines re-validate against a stored
    // checksum; anything else falls back to plain detection.
    if engine_id != INSTALLED_ORCA && engine_id != MANAGED_ORCA {
        return detect_slicing_engine(engine_id, None);
    }
    let dir = security::engines_root()?;
    let Some(m) = read_manifest_from(&dir, &engine_id)? else {
        return Ok(RawEngineDetection {
            engine_id,
            detected: false,
            display_name: "OrcaSlicer".into(),
            version: None,
            executable_path: None,
            source: "none".into(),
            checksum_sha256: None,
            capabilities: EngineCapabilities::empty(),
            valid: false,
            errors: vec!["Engine has not been detected yet — run detection first".into()],
            warnings: Vec::new(),
            notes: Vec::new(),
        });
    };

    let exe = PathBuf::from(&m.executable_path);
    let (capabilities, mut errors, warnings) = validate_orca_capabilities(&exe);
    let mut notes = Vec::new();
    let mut checksum = Some(m.checksum_sha256.clone());
    if errors.is_empty() {
        match sha256_file(&exe) {
            Ok(current) => {
                if current != m.checksum_sha256 {
                    errors.push(
                        "Engine executable changed since it was validated — re-run detection".into(),
                    );
                    checksum = Some(current);
                }
            }
            Err(e) => notes.push(format!("Checksum unavailable: {e}")),
        }
    }

    Ok(RawEngineDetection {
        engine_id: m.engine_id.clone(),
        detected: true,
        display_name: m.display_name,
        version: m.version,
        executable_path: Some(m.executable_path),
        source: m.source,
        checksum_sha256: checksum,
        valid: errors.is_empty(),
        capabilities,
        errors,
        warnings,
        notes,
    })
}

// --- process runner ----------------------------------------------------------

/// Global registry of in-flight slices, so `cancel_calibration_slice` can signal
/// a running runner thread by its opaque token.
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static R: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ProcessOutcome {
    exit_code: Option<i32>,
    duration_ms: u128,
    timed_out: bool,
    cancelled: bool,
}

/// Spawn and supervise a child process: no stdout/stderr capture (Orca's is
/// uncapturable and a headless spawn has no console anyway), enforce a timeout,
/// and honor a cooperative cancel flag. Always reaps the child, so neither a
/// timeout nor a cancel can leave an orphaned process.
fn run_process_controlled(
    mut command: Command,
    timeout_ms: u64,
    cancel: Arc<AtomicBool>,
) -> Result<ProcessOutcome, String> {
    no_window(command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null()));

    let start = Instant::now();
    let mut child = command.spawn().map_err(|e| format!("Failed to launch engine: {e}"))?;
    // timeout_ms == 0 means "no timeout".
    let deadline = if timeout_ms == 0 {
        None
    } else {
        Some(Duration::from_millis(timeout_ms))
    };

    let mut timed_out = false;
    let mut cancelled = false;
    loop {
        match child.try_wait().map_err(|e| format!("Wait failed: {e}"))? {
            Some(status) => {
                return Ok(ProcessOutcome {
                    exit_code: status.code(),
                    duration_ms: start.elapsed().as_millis(),
                    timed_out,
                    cancelled,
                });
            }
            None => {
                if cancel.load(Ordering::SeqCst) {
                    cancelled = true;
                } else if deadline.map(|d| start.elapsed() >= d).unwrap_or(false) {
                    timed_out = true;
                }
                if timed_out || cancelled {
                    let _ = child.kill();
                    let status = child.wait().ok();
                    return Ok(ProcessOutcome {
                        exit_code: status.and_then(|s| s.code()),
                        duration_ms: start.elapsed().as_millis(),
                        timed_out,
                        cancelled,
                    });
                }
                std::thread::sleep(Duration::from_millis(75));
            }
        }
    }
}

/// List regular files in a directory, returning the first `*.gcode` (the sliced
/// artifact) plus every file found. Non-recursive — Orca writes plates flat.
fn scan_artifacts(out: &Path) -> (Option<PathBuf>, Vec<PathBuf>) {
    let mut all: Vec<PathBuf> = match std::fs::read_dir(out) {
        Ok(rd) => rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect(),
        Err(_) => Vec::new(),
    };
    all.sort();
    let gcode = all
        .iter()
        .find(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("gcode"))
                .unwrap_or(false)
        })
        .cloned();
    (gcode, all)
}

/// Result of one slice attempt. Success is derived from the artifact, never
/// from stdout.
#[derive(Serialize, Clone)]
pub struct RawSliceRun {
    pub engine_id: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub timed_out: bool,
    pub cancelled: bool,
    pub output_dir: String,
    pub gcode_path: Option<String>,
    pub artifact_paths: Vec<String>,
    pub log_dir: Option<String>,
    pub succeeded: bool,
}

/// Slice a staged calibration project with the vetted installed-Orca engine.
///
/// The frontend passes only validated ids and a file name — never raw paths;
/// the job workspace, isolated datadir, and output dir are all resolved under
/// PerfectFit's managed root. The executable comes from the persisted manifest,
/// so a slice can only launch a binary the user already vetted via detection.
#[tauri::command]
pub fn run_calibration_slice(
    engine_id: String,
    session_id: String,
    job_id: String,
    project_file_name: String,
    timeout_ms: u64,
    cancellation_token: Option<String>,
) -> Result<RawSliceRun, String> {
    if engine_id != INSTALLED_ORCA {
        return Err(format!("Engine '{engine_id}' has no native slice runner"));
    }
    // Resolve the vetted executable from the manifest (never from the frontend).
    let engines_dir = security::engines_root()?;
    let manifest = read_manifest_from(&engines_dir, &engine_id)?
        .ok_or_else(|| "Engine not detected — run detection before slicing".to_string())?;
    let exe = PathBuf::from(&manifest.executable_path);
    if !exe.is_file() {
        return Err("Engine executable is missing — re-run detection".into());
    }

    // Resolve managed, per-job paths.
    security::validate_component(&project_file_name)?;
    if !project_file_name.to_ascii_lowercase().ends_with(".3mf") {
        return Err("Project file must be a .3mf".into());
    }
    let job = security::job_root(&session_id, &job_id)?;
    let workspace = job.join("workspace");
    let project = workspace.join(&project_file_name);
    if !project.is_file() {
        return Err(format!(
            "Staged project not found: {} — prepare the job first",
            project.display()
        ));
    }
    let datadir = job.join("datadir");
    let out = job.join("out");
    std::fs::create_dir_all(&datadir).map_err(|e| format!("Cannot create datadir: {e}"))?;
    std::fs::create_dir_all(&out).map_err(|e| format!("Cannot create output dir: {e}"))?;

    // Build the headless slice command (see DECISIONS 2026-07-26 project-3mf).
    let mut cmd = Command::new(&exe);
    cmd.arg("--datadir")
        .arg(&datadir)
        .arg("--outputdir")
        .arg(&out)
        .arg("--slice")
        .arg("0")
        .arg(&project);

    // Register a cancel flag before spawning so a concurrent cancel can win.
    let cancel = Arc::new(AtomicBool::new(false));
    let token = cancellation_token.filter(|t| !t.is_empty());
    if let Some(tok) = &token {
        cancel_registry()
            .lock()
            .map_err(|_| "cancel registry poisoned".to_string())?
            .insert(tok.clone(), cancel.clone());
    }

    let outcome = run_process_controlled(cmd, timeout_ms, cancel.clone());

    if let Some(tok) = &token {
        if let Ok(mut reg) = cancel_registry().lock() {
            reg.remove(tok);
        }
    }
    let outcome = outcome?;

    let (gcode, artifacts) = scan_artifacts(&out);
    let log_dir = {
        let l = datadir.join("log");
        l.is_dir().then(|| l.display().to_string())
    };
    let nonempty_gcode = gcode
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() > 0)
        .unwrap_or(false);
    let succeeded = !outcome.timed_out
        && !outcome.cancelled
        && outcome.exit_code == Some(0)
        && nonempty_gcode;

    Ok(RawSliceRun {
        engine_id,
        exit_code: outcome.exit_code,
        duration_ms: outcome.duration_ms,
        timed_out: outcome.timed_out,
        cancelled: outcome.cancelled,
        output_dir: out.display().to_string(),
        gcode_path: gcode.map(|p| p.display().to_string()),
        artifact_paths: artifacts.iter().map(|p| p.display().to_string()).collect(),
        log_dir,
        succeeded,
    })
}

/// Signal a running slice (identified by its opaque token) to cancel. Returns
/// true when a matching in-flight slice was found.
#[tauri::command]
pub fn cancel_calibration_slice(cancellation_token: String) -> Result<bool, String> {
    let reg = cancel_registry()
        .lock()
        .map_err(|_| "cancel registry poisoned".to_string())?;
    match reg.get(&cancellation_token) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Unique temp dir under the OS temp root (no external crates).
    fn temp_dir(tag: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("pf_engine_test_{tag}_{}_{n}", now_unix()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(target_os = "windows")]
    fn exiter(code: i32) -> Command {
        let mut c = Command::new("cmd");
        c.args(["/C", &format!("exit {code}")]);
        c
    }
    #[cfg(not(target_os = "windows"))]
    fn exiter(code: i32) -> Command {
        let mut c = Command::new("sh");
        c.args(["-c", &format!("exit {code}")]);
        c
    }
    #[cfg(target_os = "windows")]
    fn sleeper() -> Command {
        let mut c = Command::new("cmd");
        // ping self ~5s; a portable sleep that needs no extra tools.
        c.args(["/C", "ping -n 6 127.0.0.1"]);
        c
    }
    #[cfg(not(target_os = "windows"))]
    fn sleeper() -> Command {
        let mut c = Command::new("sh");
        c.args(["-c", "sleep 5"]);
        c
    }

    #[test]
    fn sha256_of_known_bytes() {
        let d = temp_dir("sha");
        let f = d.join("x.bin");
        std::fs::write(&f, b"abc").unwrap();
        // Well-known SHA-256("abc").
        assert_eq!(
            sha256_file(&f).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_dir_all(&d).ok();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn managed_orca_layout_flat_and_foldered() {
        // Absent → None.
        let root = temp_dir("managed_absent");
        assert!(find_managed_orca_in(&root).is_none());
        std::fs::remove_dir_all(&root).ok();

        // Flat layout: managed-orca/orca-slicer.exe.
        let flat = temp_dir("managed_flat");
        let exe = flat.join("orca-slicer.exe");
        std::fs::write(&exe, b"x").unwrap();
        assert_eq!(find_managed_orca_in(&flat), Some(exe));
        std::fs::remove_dir_all(&flat).ok();

        // Foldered layout: managed-orca/OrcaSlicer/orca-slicer.exe.
        let fold = temp_dir("managed_fold");
        let inner = fold.join("OrcaSlicer");
        std::fs::create_dir_all(&inner).unwrap();
        let fexe = inner.join("orca-slicer.exe");
        std::fs::write(&fexe, b"x").unwrap();
        assert_eq!(find_managed_orca_in(&fold), Some(fexe));
        std::fs::remove_dir_all(&fold).ok();
    }

    #[test]
    fn capability_signature_requires_calib_and_profiles() {
        let d = temp_dir("caps");
        let exe = d.join("orca-slicer.exe");
        std::fs::write(&exe, b"not a real binary").unwrap();
        // No resources yet → invalid.
        let (_, errors, _) = validate_orca_capabilities(&exe);
        assert!(!errors.is_empty());
        // Add resources/calib only → still invalid (profiles missing).
        std::fs::create_dir_all(d.join("resources").join("calib")).unwrap();
        let (caps, errors, _) = validate_orca_capabilities(&exe);
        assert!(!caps.slice);
        assert!(errors.iter().any(|e| e.contains("profiles")));
        // Add resources/profiles → valid, slice+export proven, multi-* stay false.
        std::fs::create_dir_all(d.join("resources").join("profiles")).unwrap();
        let (caps, errors, warnings) = validate_orca_capabilities(&exe);
        assert!(errors.is_empty());
        assert!(caps.slice && caps.export_3mf && caps.export_gcode);
        assert!(!caps.multi_plate && !caps.multi_extruder);
        assert!(!warnings.is_empty());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn capability_validation_rejects_missing_executable() {
        let d = temp_dir("missing");
        let exe = d.join("nope.exe");
        let (caps, errors, _) = validate_orca_capabilities(&exe);
        assert_eq!(caps, EngineCapabilities::empty());
        assert!(errors.iter().any(|e| e.contains("Executable not found")));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn manifest_roundtrips() {
        let d = temp_dir("manifest");
        let m = StoredEngineManifest {
            schema_version: ENGINE_MANIFEST_SCHEMA,
            engine_id: INSTALLED_ORCA.into(),
            display_name: "Installed OrcaSlicer".into(),
            executable_path: "C:/x/orca-slicer.exe".into(),
            version: Some("2.4.2".into()),
            source: "installed".into(),
            checksum_sha256: "deadbeef".into(),
            capabilities: EngineCapabilities {
                slice: true,
                export_3mf: true,
                export_gcode: true,
                multi_plate: false,
                multi_extruder: false,
            },
            detected_at: "2026-07-26T00:00:00Z".into(),
        };
        write_manifest_to(&d, &m).unwrap();
        let back = read_manifest_from(&d, INSTALLED_ORCA).unwrap().unwrap();
        assert_eq!(back.checksum_sha256, "deadbeef");
        assert_eq!(back.version.as_deref(), Some("2.4.2"));
        assert!(back.capabilities.slice);
        // Unknown engine id → None, not an error.
        assert!(read_manifest_from(&d, "no_such").unwrap().is_none());
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn scan_artifacts_finds_gcode_among_files() {
        let d = temp_dir("scan");
        std::fs::write(d.join("plate_1.gcode"), b"G1\n").unwrap();
        std::fs::write(d.join("meta.json"), b"{}").unwrap();
        let (gcode, all) = scan_artifacts(&d);
        assert!(gcode.unwrap().file_name().unwrap() == "plate_1.gcode");
        assert_eq!(all.len(), 2);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn process_runner_captures_exit_code() {
        let cancel = Arc::new(AtomicBool::new(false));
        let out = run_process_controlled(exiter(0), 10_000, cancel.clone()).unwrap();
        assert_eq!(out.exit_code, Some(0));
        assert!(!out.timed_out && !out.cancelled);

        let out = run_process_controlled(exiter(3), 10_000, cancel).unwrap();
        assert_eq!(out.exit_code, Some(3));
    }

    #[test]
    fn process_runner_enforces_timeout() {
        let cancel = Arc::new(AtomicBool::new(false));
        let out = run_process_controlled(sleeper(), 150, cancel).unwrap();
        assert!(out.timed_out, "expected a timeout");
        assert!(!out.cancelled);
    }

    #[test]
    fn process_runner_honors_cancellation() {
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            flag.store(true, Ordering::SeqCst);
        });
        let out = run_process_controlled(sleeper(), 0, cancel).unwrap();
        assert!(out.cancelled, "expected cancellation");
        assert!(!out.timed_out);
    }

    #[test]
    fn cancel_registry_signals_by_token() {
        let cancel = Arc::new(AtomicBool::new(false));
        cancel_registry()
            .lock()
            .unwrap()
            .insert("tok-abc".into(), cancel.clone());
        assert!(cancel_calibration_slice("tok-abc".into()).unwrap());
        assert!(cancel.load(Ordering::SeqCst));
        // Unknown token → false, not an error.
        assert!(!cancel_calibration_slice("tok-missing".into()).unwrap());
        cancel_registry().lock().unwrap().remove("tok-abc");
    }

    #[test]
    fn manual_exe_rejects_nonexistent() {
        assert!(validate_manual_exe("").is_err());
        assert!(validate_manual_exe("Z:/definitely/not/here.exe").is_err());
    }
}
