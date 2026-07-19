# Profile Installer — Manual Test Checklist

Run this checklist per slicer/version/OS before flipping
`directInstallVerified` in `src/slicerIntegration/registry.ts`. Record results
in `docs/SLICER_PROFILE_TEST_MATRIX.md`.

**Safety first:** use a disposable preset and a machine/account you can
recover. Never run these steps against presets you care about without a
PerfectFit backup AND your own copy.

## A. Preparation

- [ ] Note the slicer version (Help → About) and OS.
- [ ] Close the slicer.
- [ ] In the slicer's user filament folder, note the existing preset files
      (`%APPDATA%\<Slicer>\user\<active>\filament\`).
- [ ] Complete (or reuse) a PerfectFit calibration project with at least
      temperature + flow completed.

## B. Detection & scanning (read-only)

- [ ] PerfectFit desktop → project → Create Slicer Profile.
- [ ] The slicer appears with the correct version.
- [ ] All user-data locations are listed; the one marked **active** matches
      the slicer's actual active account (check the slicer's preset dropdown).
- [ ] Profile scan lists your user presets, system presets, and cache
      (`filament/base`) presets with correct source labels.
- [ ] The recommended base profile makes sense; the explanation lists real
      matches only.

## C. Generation & export

- [ ] Select the recommended base, keep the default name, generate.
- [ ] Preview shows ONLY: your calibrated values as changes, identity fields
      (name / filament_settings_id) as identity, and nothing else.
- [ ] Validation passes (or reports honest, understandable problems).
- [ ] Export the profile to a temp folder.
- [ ] Open the exported .json in a text editor: `name` matches, values match,
      unrelated fields match the base profile, `version`/`inherits` copied.

## D. Manual import round trip

- [ ] Open the slicer → import the exported profile
      (drag & drop into the window, or Filament settings → import).
- [ ] The preset appears with the PerfectFit name.
- [ ] Every calibrated value shows the calibrated number.
- [ ] Inherited/unchanged settings match the base profile.
- [ ] Slice any model with the preset — no errors, sane G-code preview.
- [ ] Delete the imported preset (cleanup).

## E. Direct installation (desktop only)

- [ ] Close the slicer. PerfectFit → Install into slicer.
- [ ] With the slicer OPEN, the install is refused with the
      “slicer is running” message and a working **Check again** flow.
- [ ] With the slicer closed, install succeeds and reports:
      backup id, verified write, restart note.
- [ ] `<profile>.json` and `<profile>.info` exist in the user filament dir.
- [ ] Settings → Slicer profile backups lists the new backup.
- [ ] Reopen the slicer → the preset appears without any import.
- [ ] Values and inheritance correct; slice test passes.
- [ ] Duplicate handling: install again with the same name → PerfectFit asks
      (replace / rename / cancel); replace makes a second backup.

## F. Backup restore

- [ ] Close the slicer.
- [ ] Settings → Slicer profile backups → Restore the install backup.
- [ ] The installed preset files are removed (fresh install) or the previous
      versions are back byte-for-byte (replace).
- [ ] Reopen the slicer → preset gone / back to previous state; no errors.

## G. Cloud/account caveats (Orca with account, Bambu Studio)

- [ ] Install into an account-linked location only after reading the warning.
- [ ] After the slicer syncs (log in, wait), note what happened to the preset
      (kept / duplicated / re-identified / removed) and record it in the
      research doc.

## H. Failure handling spot checks

- [ ] Make the filament dir read-only → install fails with a clear
      permission error, nothing half-written, backup intact.
- [ ] Diagnostics: Copy Diagnostic Report produces a redacted, useful report.

## Existing-app regression sweep (after any installer change)

- [ ] Dashboard, project view, wizard steps, report, card, help, settings all
      load with no console errors.
- [ ] Export/import full backup round-trips (projects with and without
      generated profiles).
- [ ] Browser/PWA build: calibration flow unaffected; profile page offers
      manual file + download only.
