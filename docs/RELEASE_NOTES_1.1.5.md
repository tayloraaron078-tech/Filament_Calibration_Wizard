# PerfectFit 1.1.5

Patch release for the experimental Slicer Profile Installer. 1.1.4 fixed the
wizard so it recommends stock baselines — and thereby exposed the next bug:
profiles cloned from a **stock** preset were installed correctly but never
appeared in a signed-in Bambu Studio. Diagnosed by structurally comparing a
PerfectFit-installed preset against presets Bambu Studio 2.7.x itself writes
into the same account folder (H2S).

## Fixes

### Profiles cloned from stock presets now appear in Bambu Studio

Diagnosed by surveying every preset Bambu Studio 2.7.x itself had written
into a real signed-in account folder (70+) against the invisible
PerfectFit-installed ones, and matching the invariants exactly:

1. **Stock-preset plumbing removed.** Clones carried `type`,
   `instantiation`, and `include` — keys no Bambu-written user preset has.
   `include` is the worst: it references template files that don't resolve
   from a user folder. All three are stripped; everything they provided
   still flows through `inherits`.
2. **`filament_extruder_variant` added.** Every visible preset declares this
   legend mapping per-slot values to hardware (on an H2S:
   `["Direct Drive Standard","Direct Drive High Flow"]`). Variant-aware
   Bambu Studio does not show user presets without it.
3. **`version` stamped from the vendor manifest.** Every visible preset
   carries the vendor library version from `system/BBL.json` (zero-stripped:
   `02.07.00.08` → `2.7.0.8`) — a value no preset inside the library
   declares. The native scan now reads vendor manifests to supply it.
4. **Concrete `inherits`.** Clones kept the stock leaf's own `inherits`
   (an abstract `@base` preset). Bambu saves user presets inheriting the
   concrete system preset by name; clones now do the same.
5. **Fresh `filament_id`, always.** The 1.1.3 fix only fired when the base
   declared an id — stock leaves inherit theirs, so clones of stock presets
   had none. Now always assigned; validation blocks missing/colliding ids.
6. **Account `user_id` in the `.info` sidecar**, stamped at install time
   (local, non-account installs stay empty), matching Bambu-written presets.

If a `PerfectFit - …` preset you installed earlier never showed up, reinstall
this build and re-run **🧵 Create Slicer Profile**; installing under the same
name replaces the invisible file.

### The wizard no longer calls the H2S a dual-nozzle printer

Bambu filament presets index per-slot arrays by (tool × hotend variant). On
single-nozzle printers with interchangeable hotends (H2S, P1S, …) the two
slots are the **Standard** and **High Flow** hotends — not two nozzles. The
"Multi-tool profile" step (now "Per-tool / per-hotend values") explains both
meanings and labels the slots, so calibrated values land in the slot matching
the hotend you actually calibrated with. Pick slot 1 for the Standard hotend,
slot 2 for High Flow.

## Unchanged

Everything from 1.1.4 stands: the startup-hang fix (stale service worker),
recursive stock-preset scanning, inherited-metadata resolution, and the
stock-only baseline recommendations.
