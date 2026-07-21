# PerfectFit 1.1.5

Patch release for the experimental Slicer Profile Installer. 1.1.4 fixed the
wizard so it recommends stock baselines — and thereby exposed the next bug:
profiles cloned from a **stock** preset were installed correctly but never
appeared in a signed-in Bambu Studio. Diagnosed by structurally comparing a
PerfectFit-installed preset against presets Bambu Studio 2.7.x itself writes
into the same account folder (H2S).

## Fixes

### Profiles cloned from stock presets now appear in Bambu Studio

A preset PerfectFit installed differed from a Bambu-written user preset in
three ways, each traced to the same root pattern — metadata that stock leaves
inherit rather than declare:

1. **No `filament_id`.** The 1.1.3 fix assigned a fresh id only when the base
   already declared one. Stock leaves (e.g. `Generic ASA @BBL H2S 0.4 nozzle`)
   inherit their id from the abstract `@base` parent, so clones of stock
   presets shipped with no id at all — and the signed-in slicer, which keys
   filaments by `filament_id`, never adopted them. The id is now always
   freshly assigned, and validation blocks a missing or colliding id.
2. **Abstract `inherits`.** Clones kept the stock leaf's own `inherits`
   (`Generic ASA @base` — an abstract preset Bambu never exposes). Bambu
   Studio saves user presets inheriting the concrete system preset by name;
   clones now do the same, and the schema `version` is filled from the
   resolved inheritance chain.
3. **Empty `user_id` in the `.info` sidecar.** Presets Bambu Studio writes
   into an account folder carry the owning account id; PerfectFit always
   wrote an empty one. The installer now stamps the target account's id at
   install time (local, non-account installs stay empty).

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
