# Changelog

## 1.1.3 - 2026-07-20

Patch release fixing two profile-installer bugs found while using the 1.1.0
build with Bambu Studio. See [docs/RELEASE_NOTES_1.1.3.md](docs/RELEASE_NOTES_1.1.3.md).

### Fixed

- **Installed Bambu profiles now appear in the slicer.** In 1.1.0 a profile installed for a signed-in Bambu account was written correctly but never showed up in the filament list. Cause: when signed in, Bambu Studio dedupes filament presets by `filament_id`, so a clone that kept its parent's `filament_id` was hidden behind the cloud-synced parent it was cloned from. Confirmed directly in Bambu Studio 2.7.x — a copy with a fresh `filament_id` appears immediately; the colliding one never does. Fix: generated presets now get a fresh unique `filament_id`, and the `.info` `base_id` chains to the stock/system ancestor instead of a parent user preset's cloud id.
- **Baseline suggestions are now stock profiles compatible with the selected printer.** In 1.1.0 the "select a base profile" step suggested the user's own custom presets (some flagged as incompatible with the printer). It now recommends only stock (system) profiles — brand-name or generic — for the calibrated material that are compatible with the selected printer. User and incompatible-printer presets remain available under Advanced selection.

### Notes for existing users

- Reinstall this build for the fixes to take effect (the fix applies to newly generated profiles).
- A profile installed by 1.1.0 into a signed-in Bambu account is stuck in Bambu's cloud with the colliding id; editing local files won't unhide it. Delete it in Bambu Studio (filament dropdown → Custom → delete), then re-run "Create Slicer Profile" — your calibration data is preserved in PerfectFit.

## 1.1.0 - 2026-07-19

See [docs/RELEASE_NOTES_1.1.0.md](docs/RELEASE_NOTES_1.1.0.md) for the full release notes.

### Added

- Linux desktop release packaging via `.deb` and AppImage artifacts.
- Experimental slicer profile generation and direct install workflows for supported Orca-family slicers.
- Bambu Studio Developer mode guidance for manual calibration tests with Bambu printers selected.
- Regression tests covering Bambu Developer mode instructions, coarse/fine Flow Rate wording, and VFA mention.

### Changed

- Release workflow now builds Windows, macOS, and Linux artifacts into draft GitHub releases.
- README and research notes now document Bambu Developer mode availability for Retraction, Max Flow Rate, and VFA.

### Known limitations

- Linux packages are generated, but Linux native slicer detection/install behavior is not yet verified.
- macOS native slicer detection/install behavior remains export-oriented pending real-machine verification.
