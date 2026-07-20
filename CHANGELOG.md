# Changelog

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
- Baseline profile suggestions now come from **stock (system) profiles** for the calibrated material that are compatible with the selected printer, instead of the user's own presets. User and incompatible-printer presets remain available in Advanced selection.

### Fixed

- **Installed Bambu profiles now appear in the slicer.** When signed in, Bambu Studio dedupes filament presets by `filament_id` and hid a generated preset behind the cloud-synced parent it was cloned from. Generated presets now receive a fresh unique `filament_id` (and the `.info` `base_id` chains to the system ancestor rather than a parent user preset's cloud id), so they show up as their own filament. Verified in Bambu Studio 2.7.x.
- Baseline recommendations no longer suggest profiles that are incompatible with the selected printer.

### Known limitations

- Linux packages are generated, but Linux native slicer detection/install behavior is not yet verified.
- macOS native slicer detection/install behavior remains export-oriented pending real-machine verification.
