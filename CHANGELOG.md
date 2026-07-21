# Changelog

## Unreleased

Backups now happen where the risk actually starts. Until now the only automatic backup was made at the very end of the flow, when a generated profile was installed — but the wizard directs you to hand-edit your filament and printer profiles from the first calibration step onward, and none of those files were protected. Prompted by a Discord suggestion that profile backups should be offered up front, not only at install time.

### Added

- **Whole-library preset snapshots.** A new native command backs up every user preset (`filament/`, `machine/`, and `process/` folders of each slicer account) into the existing checksummed backup store — same manifest format, so the Settings list, verified restore, and delete all work unchanged. Slicer-managed `base/` caches and non-preset files are excluded.
- **Pre-calibration backup prompt on every project.** Projects with remaining calibration steps show a callout offering a one-click snapshot of the project's slicer presets (falling back to all detected slicers) before any profile edits are suggested. The outcome — backed up or skipped — is recorded on the project and in its timeline. The browser build, which cannot write backups, shows manual backup guidance instead.
- **First-run backup prompt.** On first use of the desktop app (once a slicer with user presets is detected), the dashboard offers to back up all detected slicers' preset libraries. Shown once; dismissible.
- **Manual snapshots in Settings.** "Back up all slicer presets now" in Settings → Slicer profile backups snapshots every detected slicer on demand.

## 1.1.5 - 2026-07-20

Fixes generated Bambu profiles still not appearing in the slicer when cloned from a stock (system) preset — the normal path since 1.1.4 started recommending stock baselines. Diagnosed against a real signed-in Bambu Studio 2.7.x install (H2S). See [docs/RELEASE_NOTES_1.1.5.md](docs/RELEASE_NOTES_1.1.5.md).

### Fixed

- **Profiles cloned from stock presets now match what Bambu Studio itself writes, so it actually shows them.** Diagnosed by field-presence survey across all 70+ presets Bambu Studio 2.7.x had written into the real account folder vs the two invisible PerfectFit ones:
  - Clones carried stock-preset plumbing no Bambu-written user preset has: `type`, `instantiation`, and `include` — and `include` references template files that don't resolve from user folders. All three are now stripped (their contents flow through `inherits` instead).
  - Every visible preset declares `filament_extruder_variant` (the legend mapping per-slot values to hardware — e.g. `["Direct Drive Standard","Direct Drive High Flow"]` on an H2S); clones had none. Now added, sized to the preset's slots.
  - Every visible preset carries a `version` — the vendor library version from `system/BBL.json` (zero-stripped, e.g. `02.07.00.08` → `2.7.0.8`), which **no preset inside the library declares**. The native scan now reads vendor manifests and clones are stamped with it.
  - Clones kept the stock leaf's own `inherits` (an abstract `@base` preset Bambu never exposes). Bambu saves user presets inheriting the **concrete** system preset by name; clones now do the same.
  - The fresh `filament_id` introduced in 1.1.3 was only assigned when the base already declared one — stock leaves inherit theirs, so clones of stock presets had none. Now always assigned (validation blocks a missing or colliding id).
  - The `.info` sidecar always shipped an empty `user_id`; presets in an account folder carry the account id. The installer now stamps the target account's id at install time.

### Changed

- **The "Multi-tool profile" step no longer claims single-nozzle printers have two nozzles.** Bambu filament presets index per-slot arrays by (tool × hotend variant): on an H2S/P1S the two slots are the **Standard vs High Flow hotends**, not two nozzles. The wizard now explains both meanings and labels the slots accordingly, so calibration lands in the slot matching your actual hotend.

## 1.1.4 - 2026-07-20

Fixes the stock-baseline suggestions that 1.1.3 promised but did not reliably deliver, plus discoverability fixes prompted by [#10](https://github.com/tayloraaron078-tech/Filament_Calibration_Wizard/issues/10): the 1.1.3 notes told users to "re-run Create Slicer Profile", but the feature went by three different names in the app and had no entry point on the dashboard, so it couldn't be found by that name. See [docs/RELEASE_NOTES_1.1.4.md](docs/RELEASE_NOTES_1.1.4.md).

### Fixed

- **Fixed the app hanging on "Loading PerfectFit…" after updating.** The PWA service worker (registered inside the Tauri webview, where it serves no purpose) cached `index.html` cache-first; after an update it kept serving the old version's HTML, whose hashed JS bundle no longer exists, so the app never started — and uninstall/reinstall didn't help because WebView2 profile data survives uninstall. The desktop app no longer registers a service worker and unregisters any left by older versions; on Windows the app also removes stale service-worker/HTTP-cache directories from the WebView2 profile at startup, before the webview loads (calibration data in IndexedDB/localStorage is untouched). The service worker itself (web/PWA use) is now network-first for HTML so it can never pin an old shell again.
- **Stock baselines are now found and correctly matched (verified against a real Bambu Studio 2.7.x install with an H2S).** Three related defects:
  - The native scan of system vendor libraries was not recursive, missing presets in subdirectories (e.g. `system/BBL/filament/{P1P, Polymaker, SUNLU}/` — 150 presets on the dev machine). System scans now recurse (depth-limited).
  - Printer-specific system leaves (e.g. `Bambu ABS @BBL H2S`) declare `compatible_printers` but inherit `filament_type`/`filament_vendor` from abstract parents, so they could not be material-matched: they scored below user presets and, worse, "qualified" for every material. The scanner now resolves inherited metadata through the system inheritance chain. The same resolution fills `compatible_printers` for user delta presets, which previously looked compatible with every printer and polluted fallback suggestions.
  - Recommendation eligibility now requires an affirmative material-family match; presets whose material remains unknown are no longer recommendable (they stay available in Advanced mode).
- **Wizard step 2 now shows a scan summary** (`Scanned N preset(s): X stock · Y user · …`) with an explicit warning when zero stock presets arrive from the scan, so this failure mode is visible instead of silently falling back to user presets.

### Changed

- **The profile feature is now called "Create Slicer Profile" everywhere.** The project-page button (previously "Create slicer profile"), the wizard page title (previously "Create and Install Filament Profile"), and the re-run button on the generated-profiles card (previously "Open profile wizard", now "Re-run Create Slicer Profile") all use the same name, matching the release notes and documentation.
- **Create Slicer Profile is now reachable from the dashboard.** Project cards show a 🧵 Create Slicer Profile button as soon as the project has at least one calibrated value — no need to open the project first.
- **Clarified the 1.1.3 "Notes for existing users"** in the changelog and release notes: the profile is regenerated in PerfectFit (project page → 🧵 Create Slicer Profile), not via Bambu Studio's "Create New" dialog, which does not know about PerfectFit calibration data.

## 1.1.3 - 2026-07-20

Patch release fixing two profile-installer bugs found while using the 1.1.0
build with Bambu Studio. See [docs/RELEASE_NOTES_1.1.3.md](docs/RELEASE_NOTES_1.1.3.md).

### Fixed

- **Installed Bambu profiles now appear in the slicer.** In 1.1.0 a profile installed for a signed-in Bambu account was written correctly but never showed up in the filament list. Cause: when signed in, Bambu Studio dedupes filament presets by `filament_id`, so a clone that kept its parent's `filament_id` was hidden behind the cloud-synced parent it was cloned from. Confirmed directly in Bambu Studio 2.7.x — a copy with a fresh `filament_id` appears immediately; the colliding one never does. Fix: generated presets now get a fresh unique `filament_id`, and the `.info` `base_id` chains to the stock/system ancestor instead of a parent user preset's cloud id.
- **Baseline suggestions are now stock profiles compatible with the selected printer.** In 1.1.0 the "select a base profile" step suggested the user's own custom presets (some flagged as incompatible with the printer). It now recommends only stock (system) profiles — brand-name or generic — for the calibrated material that are compatible with the selected printer. User and incompatible-printer presets remain available under Advanced selection.

### Notes for existing users

- Reinstall this build for the fixes to take effect (the fix applies to newly generated profiles).
- A profile installed by 1.1.0 into a signed-in Bambu account is stuck in Bambu's cloud with the colliding id; editing local files won't unhide it. Remove it in Bambu Studio: select the preset, open it for editing (the edit/pencil icon opens the Filament settings dialog), and click the small **'X' (delete) icon in the upper-right of that edit dialog** — this removes it from your cloud sync. Then regenerate the profile **in PerfectFit** (not Bambu Studio): open your calibration project from the PerfectFit dashboard and click **🧵 Create Slicer Profile** on the project page, then follow the wizard through to install/export. Your calibration data is preserved in PerfectFit, so no re-calibration is needed.

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
