# Profile Installer — Developer Changelog

Working log of implementation decisions for the slicer profile generator/installer.
Branch: `feature/slicer-profile-installer`.

## 2026-07-19 — Phase 1: baseline + research

**Baseline recorded on `main` (a1106fe) before any changes:**

- `npm test` (vitest): **61/61 passing** in 4 files.
- `npm run build` (tsc --noEmit + vite): **passes**, 106 modules, 182.39 kB JS.
- `npm run tauri build`: **passes**, produces `PerfectFit.exe` + NSIS installer
  `PerfectFit_1.0.0_x64-setup.exe`.
- No pre-existing failures.

**Research completed** — see `docs/SLICER_PROFILE_RESEARCH.md`. All five slicers
(Orca 2.4.2, Bambu Studio 02.07.01.62, Snapmaker Orca 01.10.01.50,
ElegooSlicer 1.5.2.2, Orca-Flashforge/Flash Studio 01.10.01.50) inspected on a real
Windows 11 machine with real user presets.

Key design-driving discoveries:

1. All five share the Orca-family layout (`user/{account|default}/filament/*.json`
   + `.info` sidecar). One shared Orca-family engine + per-slicer adapter data is the
   right shape.
2. `app.preset_folder` in the slicer `.conf` names the active account directory —
   deterministic resolution of the multi-account ambiguity (Bambu had 3 candidate
   dirs on the dev machine).
3. Preset values are string arrays **per extruder** with `"nil"` sentinels; a dual-
   nozzle Bambu H2S preset carries 2-element arrays. Array shape must be preserved
   and patching must be per-tool-aware.
4. User presets come in two shapes: delta (only overridden keys + `inherits`) and
   full snapshot (Bambu, `inherits: ""`, 139 keys). Both must round-trip.
5. `.conf` files end in a `# MD5 checksum` line → we treat them as strictly read-only
   and never touch them (presets appear without conf changes).
6. Sanitized real fixtures collected from all five slicers into
   `tests/slicerIntegration/fixtures/` (account ids stripped; no personal data in
   preset bodies).

**Decisions:**

- Generated preset identity: `name` + `filament_settings_id` = new name; `version`
  copied from base profile (never invented); `from: "User"`; `.info` written with
  `sync_info = create`, empty ids, `base_id` from base system preset when known.
- v1 does not patch bed temperature (plate-specific key family in Orca lineage).
- `pressure_advance` patch also sets `enable_pressure_advance = ["1"]`.
- `user_backup-v*` folders and `filament/base/` caches are excluded from the
  user-preset scan (the latter shown separately as read-only clone sources).
