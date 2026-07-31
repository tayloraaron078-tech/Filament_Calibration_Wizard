//! Slicer profile integration — native side.
//!
//! Narrowly-scoped commands for detecting supported slicers, scanning their
//! filament presets read-only, and installing generated presets with backup,
//! atomic writes, verification, and rollback. All paths are validated in
//! `security`; the frontend can never write arbitrary files.
//!
//! Verified slicer data (folder names, executables, process names) comes from
//! docs/SLICER_PROFILE_RESEARCH.md. Do not add entries without verification.
//! Anything not yet verified on a real install is marked provisional inline and
//! in that doc — currently: the Linux layout for Snapmaker Orca, ElegooSlicer,
//! and Flash Studio (intentionally empty `linux_exe_candidates`).

pub mod backup;
pub mod discovery;
pub mod filesystem;
pub mod install;
pub mod processes;
pub mod security;

/// Static, verified per-slicer detection data.
pub struct SlicerDescriptor {
    pub id: &'static str,
    pub display_name: &'static str,
    /// Folder under %APPDATA% (Windows) / ~/Library/Application Support (macOS).
    pub data_dir_name: &'static str,
    /// Executable candidates relative to the program-files root (Windows).
    pub windows_exe_candidates: &'static [&'static str],
    /// App bundle candidates under /Applications (macOS).
    pub macos_app_candidates: &'static [&'static str],
    /// Executable candidates relative to a program root (Linux).
    pub linux_exe_candidates: &'static [&'static str],
    /// Process image names for running-detection (case-insensitive).
    pub process_names: &'static [&'static str],
}

pub const SLICERS: &[SlicerDescriptor] = &[
    SlicerDescriptor {
        id: "orca",
        display_name: "Orca Slicer",
        data_dir_name: "OrcaSlicer",
        windows_exe_candidates: &["OrcaSlicer\\orca-slicer.exe"],
        macos_app_candidates: &["OrcaSlicer.app"],
        // Native package (/usr/bin/orca-slicer) and AppImage-style integration
        // (/opt/orca-slicer/AppRun), both verified 2026-07-28 on Linux.
        linux_exe_candidates: &["orca-slicer", "orca-slicer/AppRun"],
        // Linux comm= name confirmed 2026-07-28 via `ps -axo comm=` against a
        // running instance (likely truncated at the 15-byte Linux comm limit —
        // matching is fine either way since detection uses the same `ps` call).
        process_names: &["orca-slicer.exe", "OrcaSlicer", "orcaslicer_main"],
    },
    SlicerDescriptor {
        id: "bambu",
        display_name: "Bambu Studio",
        data_dir_name: "BambuStudio",
        windows_exe_candidates: &["Bambu Studio\\bambu-studio.exe"],
        macos_app_candidates: &["BambuStudio.app"],
        // Native package (/usr/bin/bambu-studio), verified 2026-07-28 on Linux.
        linux_exe_candidates: &["bambu-studio"],
        // Linux comm= name confirmed 2026-07-28 via `ps -axo comm=` against a
        // running instance.
        process_names: &["bambu-studio.exe", "BambuStudio", "bambustu_main"],
    },
    SlicerDescriptor {
        id: "snapmaker-orca",
        display_name: "Snapmaker Orca",
        data_dir_name: "Snapmaker_Orca",
        windows_exe_candidates: &["Snapmaker_Orca\\snapmaker-orca.exe"],
        macos_app_candidates: &["Snapmaker Orca.app", "Snapmaker_Orca.app"],
        // Linux install layout unverified — intentionally empty.
        linux_exe_candidates: &[],
        process_names: &["snapmaker-orca.exe", "Snapmaker Orca"],
    },
    SlicerDescriptor {
        id: "elegoo",
        display_name: "ElegooSlicer",
        data_dir_name: "ElegooSlicer",
        windows_exe_candidates: &["ElegooSlicer\\elegoo-slicer.exe"],
        macos_app_candidates: &["ElegooSlicer.app"],
        // Linux install layout unverified — intentionally empty.
        linux_exe_candidates: &[],
        process_names: &["elegoo-slicer.exe", "ElegooSlicer"],
    },
    SlicerDescriptor {
        id: "flash-studio",
        display_name: "Flash Studio (Orca-Flashforge)",
        data_dir_name: "Orca-Flashforge",
        windows_exe_candidates: &[
            "Flashforge\\Orca-Flashforge\\flash studio.exe",
            "Flashforge\\Orca-Flashforge\\Orca-Flashforge.exe",
        ],
        macos_app_candidates: &["Orca-Flashforge.app", "Flash Studio.app"],
        // Linux install layout unverified — intentionally empty.
        linux_exe_candidates: &[],
        process_names: &["flash studio.exe", "Orca-Flashforge.exe", "Orca-Flashforge"],
    },
];

pub fn descriptor(slicer_id: &str) -> Result<&'static SlicerDescriptor, String> {
    SLICERS
        .iter()
        .find(|s| s.id == slicer_id)
        .ok_or_else(|| format!("Unknown slicer id: {slicer_id}"))
}

/// Format a unix timestamp (seconds) as an ISO-8601 UTC string without
/// pulling in a date crate. Standard civil-from-days algorithm.
pub fn iso_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mth <= 2 { y + 1 } else { y };
    format!("{y:04}-{mth:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the confirmed Linux `comm=` names (docs/SLICER_PROFILE_RESEARCH.md,
    /// verified 2026-07-28 via `ps -axo comm=` against live instances). Neither
    /// is the plain executable basename — that was the original, wrong guess —
    /// so this guards against silently reverting to it.
    #[test]
    fn linux_process_names_match_confirmed_comm_output() {
        let orca = descriptor("orca").unwrap();
        assert!(orca.process_names.contains(&"orcaslicer_main"));
        assert!(!orca.process_names.contains(&"orca-slicer"));

        let bambu = descriptor("bambu").unwrap();
        assert!(bambu.process_names.contains(&"bambustu_main"));
        assert!(!bambu.process_names.contains(&"bambu-studio"));
    }
}
