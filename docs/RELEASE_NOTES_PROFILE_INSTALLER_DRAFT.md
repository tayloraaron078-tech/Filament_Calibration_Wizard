# PerfectFit Filament Calibration Wizard
## Upcoming Release: Slicer Profile Integration (DRAFT)

> Draft release notes for the `feature/slicer-profile-installer` branch.
> Keep this file current as functionality lands. Do not publish without
> explicit approval and a current test matrix.

### Headline Feature

PerfectFit can now turn completed calibration results into a ready-to-use
filament profile for supported slicers. Finish calibrating, pick the
recommended base profile, review exactly what will change, and export the
profile — or (once verified per slicer version) install it directly with an
automatic backup.

### New Features

- **Slicer detection (desktop):** finds Orca Slicer, Bambu Studio, Snapmaker
  Orca, ElegooSlicer, and Flash Studio Desktop (Orca-Flashforge), including
  version, executable, and every user-preset location — with the slicer's
  *active* account folder identified from its own configuration.
- **Profile scanning (desktop, read-only):** lists user, cloud-account,
  cached, and system filament presets with vendor/material/printer/nozzle
  metadata.
- **Recommended base profiles:** transparent, deterministic scoring (material,
  vendor, printer, nozzle, starting profile, source) with a plain-language
  "why this is recommended" explanation. Materially different filaments are
  never collapsed: PLA ≠ PLA+, PETG ≠ PETG-HF ≠ PCTG, and a different family
  can never be auto-recommended.
- **Advanced selection:** every detected profile in a searchable, filterable
  table; compatibility filtering can be disabled with explicit risk warnings;
  a profile file can be picked directly (works in the browser build too).
- **Clone-and-patch generation:** the base profile is deep-cloned and only
  calibrated values are changed. Unknown and future slicer fields survive
  round trips byte-for-byte; per-nozzle/tool arrays keep their shape, and on
  multi-tool profiles you choose which tool receives the calibration.
- **Profile diff:** every change shown as before → after with units; identity
  changes listed separately; full JSON diff for advanced users; unchanged
  fields never appear as changes.
- **Validation:** schema, identity, inheritance, array shape, numeric limits
  (against your printer profile), duplicate names, and a round-trip
  preservation check. Out-of-range values are never silently clamped — the
  conflict is shown with both numbers.
- **Profile export:** save-dialog export on desktop, download in the browser,
  with per-slicer import instructions. Works for every slicer and version.
- **Automatic installation (experimental, per-version gated):** transactional
  install — verified backup → temp write → verify → atomic move → re-read
  verification → rollback on any failure. Refuses to run while the slicer is
  open. Disabled for slicer versions that have not passed the manual test
  matrix; export remains available everywhere.
- **Backup and restore:** timestamped, SHA-256-checksummed backups of every
  file an installation touches, with a manifest linking back to the
  calibration project. Managed from Settings (view, open folder, restore,
  delete).
- **Installation verification:** the installed file is re-read and compared
  to the generated profile before success is claimed; verification can be
  re-run later.
- **Project integration:** generated profiles are stored in the calibration
  project (base profile, fingerprint, changed fields, validation, install
  history) and included in PerfectFit JSON backups.
- **Diagnostics:** copy/save a redacted diagnostic report (detected slicers,
  versions, locations, capabilities) for bug reports.

### Supported Slicers (current honest status)

| Slicer | Scan | Generate | Export | Auto-install |
|---|---|---|---|---|
| ElegooSlicer 1.5.x (Windows) | ✅ verified | ✅ verified | ✅ | ✅ **verified & enabled** (full E2E incl. slice + restore) |
| Flash Studio (Orca-Flashforge) 01.10.x (Windows) | ✅ verified | ✅ verified | ✅ | ✅ **verified & enabled** (full E2E incl. slice + restore) |
| Snapmaker Orca 01.10.x (Windows) | ✅ verified | ✅ verified | ✅ | ✅ **verified & enabled** (full E2E on multi-tool U1 incl. slice + restore) |
| Orca Slicer 2.4.x (Windows) | ✅ verified | ✅ verified | ✅ | ⏳ install mechanics verified (local dir); active dir is cloud-linked, GUI+slice pending |
| Bambu Studio 02.07.x (Windows) | ✅ verified | ✅ verified (incl. dual-nozzle) | ✅ | ⏳ install mechanics verified (local dir); active dir is cloud-linked, GUI+slice pending |
| macOS (all) | ⏳ unverified paths | ✅ | ✅ | ✖ disabled |

Automatic installation is enabled only where `docs/SLICER_PROFILE_TEST_MATRIX.md`
records a full real-slicer pass. As of 2026-07-19 that is **ElegooSlicer 1.5.x,
Flash Studio (Orca-Flashforge) 01.10.x, and Snapmaker Orca 01.10.x on Windows**
— each installed, appeared, loaded the calibrated values, sliced a model, and
restored cleanly (Snapmaker on its multi-tool U1). Orca Slicer and Bambu Studio
stay export-only: their active preset folders are cloud-linked, so only the
install mechanics were verified (into a local dir) — an account-dir-safe
GUI+slice test is the remaining step.

### Safety

- A verified backup is created **before** any slicer file is touched; failed
  installs roll back automatically.
- Installation requires the slicer to be closed (process-checked, never
  force-killed).
- Support is verified per slicer **version**; unverified versions are
  export-only.
- Base/system profiles are never modified; the clone gets a new identity and
  the source account/cloud IDs are stripped.
- The browser build never touches the filesystem: manual file selection and
  download only.

### Improvements

- Project schema v2 with safe migration (older backups import cleanly;
  existing projects are normalized on load).
- Experimental-feature switches in Settings, including disabling the whole
  installer.

### Known Limitations

- Automatic installation is enabled for ElegooSlicer 1.5.x, Flash Studio 01.10.x,
  and Snapmaker Orca 01.10.x on Windows (full real-slicer passes). Orca Slicer
  and Bambu Studio remain export-only pending an account-dir-safe GUI+slice test
  (their active preset dirs are cloud-linked).
- macOS: slicer paths documented upstream but not yet verified; detection is
  best-effort and install stays disabled.
- Cloud-synchronized preset folders (Bambu/Orca accounts): the slicer may
  later sync, duplicate, re-identify, or remove locally installed presets.
  PerfectFit warns but cannot prevent this.
- Multi-tool: per-tool patching is implemented and fixture-tested; a real
  multi-tool install has not been run yet. Unsupported cases fail safely to
  export.
- Bed temperature is not patched (plate-type-specific keys in Orca-family
  slicers).
- Linux is untested and unsupported for detection/install.

### Upgrade Notes

- Data schema moves from v1 to v2 (adds `generatedProfiles` to projects).
  v1 backups import without changes; nothing else is migrated.
- Recommended before updating: Settings → Export all data.

### Fixes

- (none yet — new feature branch; existing calibration behavior unchanged)
