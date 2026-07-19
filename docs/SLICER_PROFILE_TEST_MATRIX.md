# Slicer Profile Installer — Test Matrix

Only rows with recorded evidence count as supported. "Auto" = automatic
installation. Automatic installation stays **disabled by default** for every
slicer until its row shows a passing manual install + restart + slice test
(then flip `directInstallVerified` in `src/slicerIntegration/registry.ts`).

Legend: ✅ verified on the real slicer · 🧪 machinery tested (temp-dir integration tests) · — not tested · n/a not applicable

Real-slicer manual pass performed 2026-07-19 on Windows 11 x64 by Claude (computer-use), using the experimental build installed over 1.0.0. Each install used the production `install_core` (verified backup → temp write → verify → atomic move → re-verify) against the slicer's real preset directory, with the slicer closed. Directories were captured (SHA-256) before and restored + re-hashed after; every touched directory returned byte-identical to baseline and no test file remained anywhere.

| Slicer | Version | OS | Arch | Scan | Parse | Generate | Install+backup | Appears in UI | Values in UI | Slice | Backup restore | Multi-tool | Auto-install enabled | Tester | Date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ElegooSlicer | 1.5.2.2 | Win 11 | x64 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | **Yes** | Claude | 2026-07-19 |
| Flash Studio (Orca-Flashforge) | 01.10.01.50 | Win 11 | x64 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | **Yes** | Claude | 2026-07-19 |
| Snapmaker Orca | 01.10.01.50 | Win 11 | x64 | ✅ | ✅ | ✅ | ✅ | ✅ | on-disk✅ | ✅ | ✅ | ✅ (sliced on U1 with preset on tool 1) | **Yes** | Claude | 2026-07-19 |
| Orca Slicer | 2.4.2 | Win 11 | x64 | ✅ | ✅ | ✅ | ✅ (account dir) | ✅ | on-disk✅ | ✅ | ✅ | n/a | **Yes** | Claude | 2026-07-19 |
| Bambu Studio | 02.07.01.62 | Win 11 | x64 | ✅ | ✅ | ✅¹ | ✅ (account dir) | ✅ | ✅ | ✅ | ✅ | ✅ (dual-nozzle: tool 0 patched, tool 1 preserved, in real slicer) | **Yes** | Claude | 2026-07-19 |
| any | any | macOS | — | — | ✅³ | ✅³ | — | — | — | — | — | — | No | — | — |

¹ Bambu dual-nozzle H2S per-nozzle patching + array preservation covered by automated fixture tests.
² (Resolved 2026-07-19) Orca and Bambu were fully tested in their real cloud-linked account dirs after confirming with the repo owner that dropping presets into those folders is their normal, working workflow. Both signed-in slicers showed the preset, sliced cleanly, and restored byte-identical. A one-line cloud caveat remains in the UI: a signed-in slicer may later sync/duplicate/re-id a locally installed preset (cosmetic, not data loss).
³ Parsing/generation are platform-independent pure data transforms (covered by the automated fixture suite).

Evidence detail per slicer:
- **ElegooSlicer — full pass.** Cloned a printer-compatible base (`PolyMaker_Petg@Giga_0.6_Nozzle`, delta preset inheriting `Generic PETG HF @System`). Installed; preset appeared under User presets; Material settings showed nozzle 213 °C (other layers), first-layer 255 °C correctly inherited (not calibrated), flow 1.03, PA 0.041 with pressure-advance enabled, MVS 17, PETG/PolyMaker/density preserved; a cube sliced to completion; backup restore removed both files and the dir returned byte-identical (6 files).
- **Flash Studio — full pass.** Preset appeared under User presets; Material settings showed Type TPU, flow 1.03, PA 0.041 enabled — correct; a cube sliced to completion (Preview toolpath + estimates); restore returned baseline (10 files).
- **Snapmaker Orca (multi-tool U1) — full pass.** Preset appeared and was selectable as tool 1's filament (validates the multi-tool path); on-disk values correct; a cube sliced to completion on the U1 (G-code generated, ~26 min estimate); restore returned baseline (10 files). In-GUI value display was not separately opened (the settings pencil opened the parent preset), but the successful slice exercises the applied values.
- **Orca Slicer — full pass (real cloud account dir).** Signed in to Orca Cloud (User 266bd4). Cloned `ELEGOO_PETG_GF`; installed into the active UUID account dir; selected the Elegoo OrangeStorm Giga 0.6 nozzle printer; preset appeared under User presets; a cube sliced to completion (42.86 m, ~1h57m est.). Restored → account dir byte-identical (16/16). The printer selection I changed to make the preset visible was set back to the original (Bambu H2S 0.4).
- **Bambu Studio — full pass (real cloud account dir), incl. real dual-nozzle.** Signed in as user_3964423668. Cloned the dual-nozzle `3D-Fuel PCTG Pro @Bambu Lab H2S 0.4 nozzle` and patched only tool 0; installed into the active account dir; preset appeared under Custom presets; Filament settings showed Type PCTG / 3D-Fuel / flow 1.03; on disk the per-nozzle arrays were preserved (temp `["213","260"]`, flow `["1.03","0.98"]` — tool 1 untouched); a cube sliced to completion (4.65 m, ~44 min est.). Restored → account dir byte-identical (138/138). Printer set back to the original H2D.

## Automated coverage backing the 🧪 cells

- `tests/slicerIntegration/*` (vitest, 48 tests): parsing, classification,
  recommendation, clone-and-patch round trips on sanitized real fixtures from
  all five slicers, unknown-field preservation, diff, validation.
- `src-tauri/src/slicer_integration/install.rs` (cargo, 7 tests): fresh
  install, duplicate refusal, replace-with-backup + restore, checksum
  corruption guard, traversal rejection — all in temp directories.
- Read-only probes (`cargo test -- --ignored`, run manually 2026-07-19):
  real detection of all five slicers and a real read-only scan of
  ElegooSlicer.

## Remaining manual tests before enabling auto-install per slicer

See `docs/PROFILE_INSTALLER_MANUAL_TESTS.md`. The minimum bar per slicer:
manual import of an exported PerfectFit profile → all values correct →
direct install with slicer closed → reopen → preset appears and inherits
correctly → slice test → restore backup → preset gone, originals intact.
