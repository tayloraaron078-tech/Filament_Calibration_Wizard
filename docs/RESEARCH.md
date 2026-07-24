# Calibration research notes

Research performed 2026-07-18 against the **official OrcaSlicer wiki** (cloned from
`github.com/SoftFever/OrcaSlicer.wiki.git`, the source of the published wiki) and the
**Bambu Lab wiki**. Latest Orca release at research time: **v2.4.2** (2026-07-07).

All wording in the app is original; only facts (formulas, defaults, menu paths) are taken
from the sources below.

## Sources

| Topic | Source |
|---|---|
| Calibration overview & recommended order | OrcaSlicer wiki: `guides/calibration_guide.md` |
| Temperature tower | `calibration/temp_calib.md` |
| Flow ratio (YOLO + 2-pass) | `calibration/flow_ratio_calib.md` |
| Pressure advance (tower/pattern/line) | `calibration/pressure_advance_calib.md` |
| Retraction tower | `calibration/retraction_calib.md` |
| Max volumetric speed | `calibration/volumetric_speed_calib.md` |
| Bambu Studio flow rate / flow dynamics | wiki.bambulab.com (calibration_flow_rate, calibration_pa) |

## Verified formulas (implemented in `src/logic/formulas.ts`)

| Test | Formula | Wiki example |
|---|---|---|
| Flow YOLO | `new = old + modifier` | 0.98 + 0.01 = 0.99 |
| Flow 2-pass / Bambu coarse+fine | `new = old × (100 + modifier)/100` | 0.98 × 105/100 = 1.029; 1.029 × 94/100 = 0.96726 |
| PA tower | `PA = start + step × height_mm` | 0 + 0.002 × 8 = 0.016 |
| Retraction tower | `len = start + step × section` (1 mm sections); authoritative value from `Calib_Retraction_tower` G-code comment | — |
| MVS | `measured = start + height_mm × step` | 5 + 19 × 0.5 = 14.5 mm³/s |
| Volumetric flow | `layer height × line width × speed` | — |

## Key defaults (verified)

- Temp tower: 5 °C per block; tower auto-scales to nozzle diameter.
- Flow YOLO: 11 blocks, ±0.05 in 0.01 steps ("Perfectionist": −0.04…+0.035 step 0.005).
- Flow Pass 1: 9 blocks, ±20% in 5% steps. Pass 2: 10 blocks, −9…0% in 1% steps.
  (Bambu Studio coarse = 80–120% in 5% steps, fine = 91–100% in 1% steps.)
- Retraction test defaults: 0→2 mm step 0.1 (direct drive); wiki suggests 1→6 mm step 0.2 for Bowden.
- MVS test defaults: 5→20 mm³/s, step 0.5 per mm of height; official advice: reduce result 10–20% for production.
- PA has direct-drive and Bowden variants for each method; Marlin needs Linear Advance (M900) compiled in.

## Recommended order

Official Orca order: Temperature → Max Volumetric Speed → Pressure Advance → Flow → Retraction
(then advanced: cornering, input shaping, VFA — out of scope for this app).

This app's default order (Temperature → Flow ×2 → PA → Retraction → MVS → Verification) follows
the product specification; the dependency that actually matters (temperature before everything;
flow before PA judgment) is preserved and the difference is disclosed in each module's
"why this order" note. Users can reorder with dependency warnings.

## Menu locations (version assumptions)

Re-verified 2026-07-23 against each slicer's menu-construction source (`MainFrame.cpp`) and
cross-checked against the installed binaries, after a community report that several paths were
wrong. **The two slicers use different labels for the same tests — never copy a path across.**

- **Orca Slicer 2.4.x**: top menu bar → `Calibration`, whose entries are, in order:
  Temperature / **Max flowrate** / Pressure advance (Line, Pattern, Tower) / **Flow ratio**
  (YOLO Recommended, YOLO Perfectionist, Pass 1 Coarse, Pass 2 Fine) / **Retraction** /
  Cornering / Input Shaping ▸ / VFA / Calibration Guide. There is no `More…` submenu.
  Values saved in Filament settings (Flow ratio, PA, temps, MVS) or Printer settings → Extruder → Retraction.
  After calibrating, start a new project to exit calibration mode.
- **Bambu Studio 1.7+**: two distinct surfaces, easily confused.
  The `Calibration` **tab** in the main tab bar holds the machine's automatic wizards
  (Flow Dynamics / Flow Rate / Vibration) for Bambu printers.
  Develop Mode adds a `Calibration` **menu** to the title bar with the manual Orca-derived
  tests: Temperature / **Flow rate** ▸ (Coarse, Fine) / **Pressure advance** / **Retraction test** /
  **More...** ▸ (Max flowrate, VFA) / Tutorial. Note there is no `Flow Dynamics` entry in
  that menu — the manual PA test is called `Pressure advance`.
  External models/calculators remain fallbacks when Develop Mode is unavailable.
  On Bambu printers, disable machine-side "Flow Calibration" / "Flow Dynamics Calibration"
  checkboxes when printing manual tests.

**Naming differences to keep straight** (each of these bit us once):

| Test | Orca 2.4.x | Bambu Studio |
| --- | --- | --- |
| Flow | `Flow ratio` (named after the setting) | `Flow rate` ▸ Coarse / Fine |
| Retraction | `Retraction` | `Retraction test` |
| Max flow | `Max flowrate`, top level (2nd entry) | `More...` ▸ `Max flowrate` |
| Pressure advance | `Pressure advance` | `Pressure advance` (menu); `Flow Dynamics` is the tab wizard |

## Orca calibration behaviours worth knowing

- **Resonance avoidance is force-disabled.** Every `calib_*` function in `Plater.cpp` sets
  `resonance_avoidance = false` unconditionally — it slows outer walls and would distort results.
  Of Orca's entire stock profile catalog, exactly one machine preset ships it enabled
  (`Snapmaker U1 (0.4 nozzle)`; all other U1 nozzle variants inherit `fdm_U1` → `fdm_toolchanger`,
  neither of which sets the key, so they fall through to the built-in default of `false`).
  Those users get an unsaved-changes dialog offering Transfer/Discard. Confirmed by testing both:
  the choice is irrelevant, because `new_project()` runs *before* the forced `false`, so Orca
  overwrites the outcome either way.
- **Calibration tests always target filament slot 1.** Each `calib_*` function reads
  `params.extruder_id`, which is initialised to `0` and never set by any calibration dialog —
  none of them expose an extruder picker. Multi-tool users must either load the filament under
  test into slot 1 or reassign every object's filament by hand after the plate is generated.
- **Tests scale to the preset's nozzle diameter.** The model is scaled by `nozzle_diameter ÷ 0.4`
  and layer height set to `nozzle_diameter ÷ 2`, so running a test against the wrong nozzle
  variant of a printer preset silently invalidates the result.
- **System presets cannot be overwritten.** `SavePresetDialog.cpp` formats the save name as
  `"<name> - Copy"` whenever `is_system` is true, so Save during a calibration creates a user
  copy rather than corrupting the stock preset.

## Version-dependence strategy

All menu paths, step text, and per-test availability live in `src/data/slicers.ts`
(`SLICER_CONTENT`), keyed by slicer + version family with a `verifiedOn` date.
Supporting a new version = adding a new entry; no app logic changes.
