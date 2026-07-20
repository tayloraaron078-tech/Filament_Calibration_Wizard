# PerfectFit 1.1.3

Patch release for the experimental Slicer Profile Installer, fixing two bugs
found while using the 1.1.0 build with Bambu Studio.

## Fixes

### Installed Bambu profiles now appear in the slicer

In 1.1.0, generating and installing a filament profile for a **signed-in Bambu
Studio account** wrote the file correctly into the account's preset folder, but
the profile never appeared in Bambu's filament list.

**Cause.** When you are signed in, Bambu Studio identifies filament presets by
their `filament_id` and shows only one preset per id. PerfectFit cloned the
chosen base profile and kept its `filament_id`, so the new preset collided with
the cloud-synced parent it was cloned from and was hidden behind it. This was
confirmed directly in Bambu Studio 2.7.x: a copy of the same profile with a
fresh `filament_id` appeared immediately, while the colliding one never did.

**Fix.** Generated presets now receive a fresh, unique `filament_id` (mirroring
what Bambu does when you duplicate a filament), and the `.info` `base_id` links
to the stock/system ancestor instead of a parent user preset's cloud id. New
profiles now show up as their own filament.

### Baseline suggestions are stock profiles compatible with the printer

In 1.1.0, the "select a base profile" step suggested your own custom presets —
some of which were flagged as not compatible with the selected printer.

Baselines are now drawn only from **stock (system) profiles** — brand-name or
generic — for the calibrated material that are **compatible with the selected
printer**. Your own presets and printer-incompatible presets remain available
under Advanced selection. If no stock profile qualifies, the closest compatible
profile is shown with a clear note.

## Notes for existing users

- **Reinstall this build** for the fixes to take effect — they apply to newly
  generated profiles.
- A profile that 1.1.0 installed into a **signed-in Bambu account** is now stuck
  in Bambu's cloud with the colliding id; editing local files will not unhide
  it. Delete it in Bambu Studio (filament dropdown → Custom → delete the
  `PerfectFit - …` preset), then re-run **Create Slicer Profile**. Your
  calibration data is preserved in PerfectFit, so no re-calibration is needed.

## Unchanged

Everything else from 1.1.0 stands: slicer detection, scanning, clone-and-patch
generation, validation, export, backup/restore, and verified direct install for
Orca Slicer, Bambu Studio, Snapmaker Orca, ElegooSlicer, and Flash Studio on
Windows. See `docs/RELEASE_NOTES_1.1.0.md` and
`docs/SLICER_PROFILE_TEST_MATRIX.md`.
