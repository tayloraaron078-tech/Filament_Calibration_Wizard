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

## 2026-07-19 — Phases 2–6: implementation

- **Native layer** (`src-tauri/src/slicer_integration/`): detection (conf
  version + active `preset_folder`), read-only scanning (user / base-cache /
  system vendor libraries), process detection via `tasklist`/`ps` image names,
  SHA-256 checksummed backups with manifests, transactional install
  (`install_core` with injected roots for testability), semantic verify,
  save-dialog export (`tauri-plugin-dialog`). All frontend-supplied names are
  validated (`security.rs`): traversal, separators, reserved names, extension
  allowlist; writes only ever resolve inside slicer `user/*/filament` dirs or
  the PerfectFit backup root.
- **TS engine** (`src/slicerIntegration/`): shared Orca-family parser +
  clone-and-patch (`orcaFamily.ts`), five thin adapters over a common base
  with per-slicer quirks, deterministic recommendations with reason lists,
  generator gated on completed calibration steps only, diff summarizer that
  flags any non-calibrated drift as an error, validation (limits never
  clamped), installer/export orchestration, diagnostics with path redaction,
  feature flags (separate localStorage key).
- **UI**: `#/profile/:id` wizard (slicer → base profile → configure → preview
  → install/export), completion CTA + generated-profile records in project
  view, Settings cards for experimental flags and backup management.
- **Schema v2**: `CalibrationProject.generatedProfiles`; migration normalizes
  older files; backups include the records.
- **Tests**: 48 new vitest tests (fixture round trips incl. dual-nozzle
  Bambu and unknown-field preservation) + 7 cargo integration tests in temp
  dirs (fresh install, duplicate, replace+restore, checksum corruption guard,
  traversal). One pre-existing migration test updated for v2 (expected).
- **Verification runs** (2026-07-19, Windows 11): browser-mode E2E in dev
  server (manual file → generate → preview → export/save; no console
  errors); read-only native probes detected all five real slicer installs
  with correct versions/active dirs/preset counts and scanned ElegooSlicer
  (3 user / 2 cache / 310 system presets).
- **Gating decision:** `directInstallVerified` stays **false** for all five
  slicers until the real-slicer manual checklist passes
  (docs/PROFILE_INSTALLER_MANUAL_TESTS.md); install UI shows export-only
  messaging for unverified versions.

**Decisions:**

- Generated preset identity: `name` + `filament_settings_id` = new name; `version`
  copied from base profile (never invented); `from: "User"`; `.info` written with
  `sync_info = create`, empty ids, `base_id` from base system preset when known.
- v1 does not patch bed temperature (plate-specific key family in Orca lineage).
- `pressure_advance` patch also sets `enable_pressure_advance = ["1"]`.
- `user_backup-v*` folders and `filament/base/` caches are excluded from the
  user-preset scan (the latter shown separately as read-only clone sources).
