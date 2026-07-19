# Slicer Profile Installer — Test Matrix

Only rows with recorded evidence count as supported. "Auto" = automatic
installation. Automatic installation stays **disabled by default** for every
slicer until its row shows a passing manual install + restart + slice test
(then flip `directInstallVerified` in `src/slicerIntegration/registry.ts`).

Legend: ✅ verified · 🧪 machinery tested (temp-dir integration tests), real-slicer run pending · — not tested · n/a not applicable

| Slicer | Version | OS | Arch | Scan | Parse | Generate | Manual import | Auto install | Restart detect | Install verify | Backup restore | Multi-tool | Tester | Date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Orca Slicer | 2.4.2 | Win 11 | x64 | ✅ | ✅ | ✅ | — | 🧪 | n/a¹ | 🧪 | 🧪 | n/a | Claude (dev machine) | 2026-07-19 | Detection/scan verified against real install (8+3 user presets found, account dir active). Round-trip fixture tests pass. |
| Bambu Studio | 02.07.01.62 | Win 11 | x64 | ✅ | ✅ | ✅ | — | 🧪 | n/a¹ | 🧪 | 🧪 | ✅² | Claude (dev machine) | 2026-07-19 | 3 account dirs correctly resolved (69/21/0 presets; active dir from conf). Dual-nozzle H2S preset round-trips with per-nozzle patching. |
| Snapmaker Orca | 01.10.01.50 | Win 11 | x64 | ✅ | ✅ | ✅ | — | 🧪 | n/a¹ | 🧪 | 🧪 | — | Claude (dev machine) | 2026-07-19 | 5 user presets found. |
| ElegooSlicer | 1.5.2.2 | Win 11 | x64 | ✅ | ✅ | ✅ | — | 🧪 | n/a¹ | 🧪 | 🧪 | n/a | Claude (dev machine) | 2026-07-19 | Scan: 3 user + 2 base + 310 system presets. |
| Flash Studio (Orca-Flashforge) | 01.10.01.50 | Win 11 | x64 | ✅ | ✅ | ✅ | — | 🧪 | n/a¹ | 🧪 | 🧪 | — | Claude (dev machine) | 2026-07-19 | 7 user presets found; presets without .info sidecars parse fine. |
| any | any | macOS | — | — | ✅³ | ✅³ | — | — | — | — | — | — | — | — | macOS paths unverified; detection data marked likely, install stays off. |

¹ Restart detection: the profile appears after slicer restart (PrusaSlicer-lineage startup scan). "n/a" until the manual restart test is run per slicer.
² Multi-tool: dual-nozzle array preservation + per-tool patching covered by automated fixture tests; a real dual-nozzle install has not been run.
³ Parsing/generation are platform-independent (pure data transforms, covered by the automated fixture suite on every platform CI runs on).

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
