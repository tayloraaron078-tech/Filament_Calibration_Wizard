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

- **Orca Slicer 2.4.x**: top menu bar → `Calibration` → Temperature / Flow rate (YOLO, Pass 1, Pass 2) /
  Pressure advance (Line, Pattern, Tower) / Retraction test / More… → Max flowrate.
  Values saved in Filament settings (Flow ratio, PA, temps, MVS) or Printer settings → Extruder → Retraction.
  After calibrating, start a new project to exit calibration mode.
- **Bambu Studio 1.7+**: `Calibration` tab → Temperature / Flow Rate (coarse/fine) / Flow Dynamics (K).
  No built-in retraction tower or max-flow test (app provides fallbacks).
  On Bambu printers, disable machine-side "Flow Calibration" / "Flow Dynamics Calibration"
  checkboxes when printing manual tests.

## Version-dependence strategy

All menu paths, step text, and per-test availability live in `src/data/slicers.ts`
(`SLICER_CONTENT`), keyed by slicer + version family with a `verifiedOn` date.
Supporting a new version = adding a new entry; no app logic changes.
