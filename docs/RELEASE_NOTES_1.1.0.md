# PerfectFit 1.1.0 Release Notes

PerfectFit 1.1.0 is the first release prepared with Linux desktop packages in addition to the existing Windows and macOS artifacts. It also rolls up the slicer profile installer work, Bambu Studio Developer mode calibration guidance, documentation improvements, and project-health updates completed since the 1.0.0 release.

## Downloads

The GitHub release workflow builds these desktop artifacts as draft release assets:

- **Windows:** NSIS installer (`.exe`).
- **macOS:** universal Apple Silicon + Intel disk image (`.dmg`).
- **Linux:** Debian package (`.deb`) plus portable AppImage (`.AppImage`) for broad distro coverage.

Linux support is packaging-first in this release: the app can launch on Linux, browser/PWA calibration remains supported, and native profile detection/install behavior remains verified primarily on Windows with macOS export-only caveats documented separately.

## Highlights since 1.0.0

### Slicer profile generation and installation

- Added the experimental profile generator that can turn completed calibration steps into a slicer filament profile instead of requiring all values to be copied manually.
- Added supported slicer adapters for Orca Slicer, Bambu Studio, Snapmaker Orca, ElegooSlicer, and Flash Studio Desktop.
- Added direct install, transactional backups, restore support, diff previews, and conservative validation so PerfectFit only patches values backed by completed calibration steps.
- Verified Windows direct-install flows against real slicer account directories for Orca Slicer and Bambu Studio, including Bambu dual-nozzle array preservation.
- Verified direct-install support for ElegooSlicer, Snapmaker Orca, and Flash Studio Desktop according to the documented test matrix.

### Bambu Studio calibration guidance

- Updated the coached Bambu Studio wizard pages to recommend enabling **Developer mode** as the best way to access manual calibration tests while a Bambu printer remains selected.
- Kept the temporary non-Bambu-printer selection workaround as a fallback only.
- Documented Bambu Studio's available Developer mode tests: Temperature, Flow Rate coarse/fine, Pressure Advance / Flow Dynamics, Retraction, Max Flow Rate, and VFA.
- Clarified that Bambu Studio uses Flow Rate coarse/fine passes and does not expose Orca's YOLO flow method.

### Release packaging

- Added Linux release builds to the GitHub release workflow.
- Updated release automation to build Windows, macOS, and Linux artifacts into one draft GitHub release.
- Added Linux build dependencies required by Tauri on Ubuntu runners.

### Documentation and project health

- Updated README and research notes for the Bambu Developer mode behavior.
- Added issue templates, contribution guidance, security policy, code of conduct, and pull request template.
- Added/expanded automated tests for profile generation, slicer integration adapters, validation, recommendations, import/export, formulas, and Bambu Developer mode guidance.

## Known limitations and caveats

- macOS native slicer path detection remains documented but not fully real-machine verified; browser/PWA and exported-profile workflows remain available.
- Linux native slicer profile detection/install support is not yet claimed as verified. Linux packages are provided so Linux users can run the desktop app and use browser-equivalent workflows while native Linux slicer integration is validated in a future pass.
- Cloud-synchronized Orca/Bambu account directories may later sync, duplicate, re-id, or remove local preset files; PerfectFit surfaces this as a caveat and keeps backups for installed profiles.
- VFA is mentioned where Bambu Developer mode exposes it, but PerfectFit does not currently have a dedicated VFA scoring step.
