# PerfectFit 1.1.4

Patch release for the experimental Slicer Profile Installer. 1.1.3 promised
that baseline suggestions would be stock profiles compatible with the selected
printer, but on real Bambu Studio installs the fix was starved of data and the
wizard still fell back to user presets (reported with a Bambu Lab H2S). 1.1.4
fixes the three underlying defects, verified against a real Bambu Studio 2.7.x
install with an H2S.

## Fixes

### Stock baselines are now found and correctly matched

Three related defects, all diagnosed on a live install:

1. **The system-library scan was not recursive.** Bambu Studio keeps some
   vendor presets in subdirectories (e.g.
   `system/BBL/filament/{P1P, Polymaker, SUNLU}/` — 150 presets on the dev
   machine), and the native scan only read the top-level folder. System scans
   now recurse (depth-limited).
2. **Printer-specific stock leaves could not be material-matched.** Presets
   like `Bambu ABS @BBL H2S` declare `compatible_printers` but inherit
   `filament_type`/`filament_vendor` from abstract parents, so the scanner saw
   them with no material: they scored below user presets and "qualified" for
   every material. The scanner now resolves inherited metadata through the
   system inheritance chain. The same resolution fills `compatible_printers`
   for user delta presets, which previously looked compatible with every
   printer and polluted fallback suggestions.
3. **Recommendations now require an affirmative material match.** Presets
   whose material remains unknown are no longer recommendable; they stay
   available under Advanced selection.

### The scan is no longer silent when it fails

Wizard step 2 now shows a scan summary
(`Scanned N preset(s): X stock · Y user · …`) with an explicit warning when
zero stock presets arrive from the scan. If stock baselines are ever missing
again, the wizard says so instead of quietly suggesting user presets.

## Changes

- **The feature is now called "Create Slicer Profile" everywhere** — the
  project-page button, the wizard page title, and the re-run button on the
  generated-profiles card all use the same name, matching the release notes
  and documentation (previously three different labels; see
  [#10](https://github.com/tayloraaron078-tech/Filament_Calibration_Wizard/issues/10)).
- **Create Slicer Profile is reachable from the dashboard.** Project cards
  show a 🧵 Create Slicer Profile button as soon as the project has at least
  one calibrated value — no need to open the project first.

## Notes for existing users

- Reinstall this build, then re-run **🧵 Create Slicer Profile** (dashboard
  card or project page). With a Bambu printer selected, step 2 should now
  recommend stock `Bambu <material> @BBL <printer>` (or Generic) baselines and
  show the scan-summary line.
- The 1.1.3 guidance for removing a cloud-stuck preset from a signed-in Bambu
  account still applies; see `docs/RELEASE_NOTES_1.1.3.md`.

## Unchanged

Everything else from 1.1.0/1.1.3 stands: slicer detection, clone-and-patch
generation, validation, export, backup/restore, and verified direct install
for Orca Slicer, Bambu Studio, Snapmaker Orca, ElegooSlicer, and Flash Studio
on Windows.
