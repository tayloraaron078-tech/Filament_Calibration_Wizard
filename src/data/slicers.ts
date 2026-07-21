import type { SlicerId, SlicerVersionContent } from '../types';

const BAMBU_DEVELOPER_MODE_BEST_PATH =
  'Best path for Bambu printers: enable Bambu Studio Developer mode first. Developer mode keeps your Bambu printer selected while exposing the manual calibration tests: Temperature, Flow Rate coarse/fine (no YOLO), Pressure Advance / Flow Dynamics, Retraction, Max Flow Rate, and VFA.';

const BAMBU_NON_BAMBU_FALLBACK =
  'Fallback only: if you cannot or do not want to use Developer mode, temporarily select any non–Bambu-Lab printer profile to reveal the same Calibration tests, create/run the test, then switch back to your Bambu printer before saving values or doing normal prints.';

/**
 * Version-aware slicer instruction content.
 *
 * All wording is original. Facts (menu locations, defaults, formulas) verified
 * against the official OrcaSlicer wiki (github.com/SoftFever/OrcaSlicer wiki,
 * checked 2026-07-18 against the v2.4.x docs) and the Bambu Lab wiki.
 *
 * To support a new slicer version: copy an entry, adjust, and add it to
 * SLICER_CONTENT. Nothing else in the app needs to change.
 */

export const SLICER_CONTENT: SlicerVersionContent[] = [
  {
    slicer: 'orca',
    slicerLabel: 'Orca Slicer',
    version: '2.4.x',
    verifiedOn: '2026-07-18',
    docsUrl: 'https://github.com/SoftFever/OrcaSlicer/wiki/Calibration',
    calibrationMenuPath: 'Top menu bar → Calibration',
    perTest: {
      temperature: {
        available: true, builtIn: true,
        menuPath: 'Calibration → Temperature',
        steps: [
          'Open Orca Slicer and select the printer, the filament profile you are calibrating, and a standard process profile (0.2 mm quality is fine).',
          'In the top menu bar, open Calibration and choose Temperature.',
          'In the dialog, set the start (hotter) and end (cooler) temperatures from the range below. Orca steps the tower 5 °C per block.',
          'Click OK. Orca creates a new project containing the temp tower, scaled to your nozzle size.',
          'Slice the plate and check the Preview: each tower block should show its temperature.',
          'Print it (export G-code or send directly to the printer).',
          'When done: create a NEW project before doing normal prints — calibration mode changes settings you don\'t want to keep.'
        ],
        saveTo: {
          path: 'Filament settings (edit the filament profile) → Filament tab',
          field: 'Nozzle temperature — set "Other layers" to your chosen temp; optionally set "First layer" 5–10 °C hotter for adhesion',
          scope: 'filament',
          note: 'Save with the floppy-disk icon as a NEW user preset (e.g. "Brand PETG Blue - X1C - 0.4") — do not overwrite the stock generic preset.'
        },
        gotchas: [
          'The tower is generated in-slicer — you do not need to download a model.',
          'If every block looks bad, the problem is likely wet filament or a partial clog, not temperature.'
        ]
      },
      'flow-pass1': {
        available: true, builtIn: true,
        menuPath: 'Calibration → Flow rate',
        steps: [
          'Select the printer AND the filament profile you are calibrating — the test math builds on the profile\'s current flow ratio, so the right filament must be active.',
          'Note the profile\'s current Flow ratio (Filament settings → Filament tab) — the app asks for it below.',
          'Open Calibration → Flow rate. Choose "YOLO (Recommended)" for the one-pass method, or "Pass 1" for the legacy coarse pass.',
          'YOLO: a plate of eleven blocks appears, each labeled with an absolute modifier from −0.05 to +0.05 in 0.01 steps. Pass 1: nine blocks labeled −20 to +20 in 5% steps.',
          'Slice and print the plate.',
          'Pick the best block using the evaluation guide, then let this app compute the new flow ratio.',
          'Bambu printers only: in the print dialog, UNCHECK the machine\'s own "Flow Calibration" option — it would recalibrate on top of the test.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio (a decimal near 1.0 — never a percentage)',
          scope: 'filament',
          note: 'Save the profile after entering the value; Pass 2 / YOLO verification builds on the SAVED value.'
        },
        disableFirst: ['Bambu printers: the "Flow Calibration" checkbox in the send-to-print dialog'],
        gotchas: ['YOLO modifiers are absolute (+0.01), legacy Pass 1/2 modifiers are percentages (+5). Don\'t mix the two formulas — this app applies the right one for the method you pick.']
      },
      'flow-pass2': {
        available: true, builtIn: true,
        menuPath: 'Calibration → Flow rate → Pass 2',
        steps: [
          'FIRST verify the Pass 1 result is entered AND saved in the filament profile — Pass 2 builds on it.',
          'Open Calibration → Flow rate and choose Pass 2.',
          'A plate of ten blocks appears with modifiers from −9 to 0 (percent, 1% steps).',
          'Slice and print, then pick the smoothest block.',
          'Enter the modifier below; the final ratio = saved ratio × (100 + modifier) / 100.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio',
          scope: 'filament',
          note: 'Overwrite the Pass-1 value with this final one and save the user preset again.'
        }
      },
      'pressure-advance': {
        available: true, builtIn: true,
        menuPath: 'Calibration → Pressure advance',
        steps: [
          'Select printer, filament, and process profile.',
          'Open Calibration → Pressure advance and pick a method: Tower, Pattern, or Line. Each method has direct-drive (DDE) and Bowden variants — pick the one matching your extruder.',
          'Enter start / end / step from the range below (the dialog pre-fills sensible defaults per extruder type).',
          'Slice and print the generated plate.',
          'Marlin firmware: Linear Advance must be compiled in (M900). If the print shows no change across samples, the firmware is ignoring PA.',
          'Klipper/Bambu: works out of the box.',
          'Bambu printers: uncheck the machine "Flow Dynamics Calibration" option in the print dialog so the printer doesn\'t overwrite the test.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab → Advanced',
          field: 'Enable pressure advance (check) + Pressure advance value',
          scope: 'filament',
          note: 'Per-filament value. Save the user preset. (Setting it in printer/process would apply to every filament — not what you want.)'
        },
        disableFirst: ['Bambu printers: "Flow Dynamics Calibration" checkbox in the print dialog'],
        gotchas: [
          'Tower: PA = start + step × best_height_mm (the tower steps PA once per mm of height).',
          'Line/Pattern: values are printed next to the lines — read them directly rather than counting samples when possible.'
        ]
      },
      'flow-verify': {
        available: true, builtIn: true,
        menuPath: 'Calibration → Flow rate → Pass 2',
        steps: [
          'Verify BOTH your calibrated flow ratio AND the new Pressure Advance value are saved in the filament profile — this re-check tests flow under the new PA.',
          'Open Calibration → Flow rate and choose Pass 2 (the same fine plate as before: −9 to 0, 1% steps).',
          'Slice and print.',
          'Pick the smoothest block. If the 0 block wins, your flow ratio is confirmed; a neighbor winning means PA was masking a small flow error.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio',
          scope: 'filament',
          note: 'Only update the value if a block other than 0 won; then save the user preset again.'
        }
      },
      retraction: {
        available: true, builtIn: true,
        menuPath: 'Calibration → Retraction test',
        steps: [
          'Select printer, filament, and process profile.',
          'Open Calibration → Retraction test.',
          'Set start / end / step. Defaults 0→2 mm step 0.1 suit direct drive; try 1→6 mm step 0.2 for Bowden.',
          'Slice and print the twin-tower test.',
          'Find the LOWEST height where the towers stay clean (strings stop).',
          'Measure that height with calipers, then read the true retraction length at that height from the sliced G-code preview: search the G-code for the "Calib_Retraction_tower" comments (don\'t trust raw retract commands — wipe settings distort them). This app also computes it from start + step × height.',
        ],
        saveTo: {
          path: 'Printer settings → Extruder → Retraction  (or per-filament: Filament settings → Setting overrides)',
          field: 'Length (mm) — and optionally Retraction speed',
          scope: 'printer',
          note: 'Retraction is PRINTER-scoped by default. If this filament needs a different value than your usual, use the filament profile\'s "Setting overrides" section instead of changing the printer profile.'
        },
        gotchas: [
          'If the tower is clean from the very bottom, set a small nonzero value (0.2–0.4 mm direct drive) rather than 0.',
          'If the top is STILL stringy, dry the filament and check the nozzle for leaks — more retraction won\'t fix moisture.'
        ]
      },
      'max-volumetric-speed': {
        available: true, builtIn: true,
        menuPath: 'Calibration → More… → Max flowrate',
        steps: [
          'Select printer, filament (with calibrated temperature saved), and process profile.',
          'Open Calibration → More… and choose Max flowrate.',
          'Set start / end / step (defaults 5→20 mm³/s, step 0.5 per mm of height are good unless you already know the ballpark).',
          'Slice and print the test tower.',
          'Watch and listen during the print — note the height where clicking or visible defects start.',
          'Measure with calipers the height just BELOW where defects begin.',
          'Alternative reading: in Preview, set the color scheme to "Flow" and find the flow value at your measured layer.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Max volumetric speed (mm³/s)',
          scope: 'filament',
          note: 'Enter the PRODUCTION value (with safety margin applied), not the raw measured maximum.'
        },
        gotchas: ['This test measures a best-case scenario. The official guidance is to reduce the measured value by 10–20% for real prints — this app applies your configured margin automatically.']
      },
      shrinkage: {
        available: true, builtIn: false,
        menuPath: '(external test model — no calibration menu entry)',
        steps: [
          'Orca has no built-in shrinkage test — use one of the external tools from the models list (the free Printables shrinkage tool reads the percentage directly off a printed vernier scale).',
          'Before slicing the tool, open Filament settings → Filament and make sure Shrinkage is 100% (no compensation) — the test measures what the compensation SHOULD be.',
          'Print at 100% scale with your calibrated filament profile and normal process profile.',
          'Let the parts cool fully to room temperature before measuring/reading.',
          'Enter the reading(s) in the result step; the app combines X and Y into the value to save.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Shrinkage (labeled "Shrinkage (XY)" in newer Orca versions) — a percentage',
          scope: 'filament',
          note: 'Enter as a percentage (e.g. 99.4). Orca scales XY geometry up by 100/shrinkage% at slicing time. Save the user preset.'
        },
        gotchas: [
          'Re-slice existing plates after changing shrinkage — compensation is applied at slicing time.',
          'Newer Orca versions have a separate Z shrinkage field; the CaliLantern measures Z too if you want to fill it.'
        ]
      },
      'final-verification': {
        available: true, builtIn: false,
        menuPath: '(normal printing — no calibration menu)',
        steps: [
          'Start a NEW project (File → New) to make sure no calibration mode is active.',
          'Select your printer, the newly saved filament user preset, and your normal process profile.',
          'Import a verification model (see the models list — e.g. 3DBenchy) or a real part of yours.',
          'Confirm the filament preset shows all your calibrated values (temperature, flow ratio, PA, max volumetric speed) and the printer/override retraction is set.',
          'Slice, check the Preview for anything odd, and print.',
          'Inspect using the checklist in the next step.'
        ],
        saveTo: {
          path: '—', field: '—', scope: 'calibration-only',
          note: 'Nothing to save; this validates the preset you already saved.'
        }
      }
    }
  },
  {
    slicer: 'bambu',
    slicerLabel: 'Bambu Studio',
    version: '1.7+',
    verifiedOn: '2026-07-19',
    docsUrl: 'https://wiki.bambulab.com/en/software/bambu-studio/manual-calibration',
    // NOTE: In current Bambu Studio (verified 2.7.x), Developer mode exposes
    // Bambu's manual calibration tests while a Bambu Lab printer is selected.
    // Temporarily selecting a non–Bambu-Lab printer profile remains documented
    // only as a fallback for users who cannot enable Developer mode (issue #1).
    calibrationMenuPath: 'Calibration menu (top bar) — enable Developer mode if tests are hidden with a Bambu printer selected',
    perTest: {
      temperature: {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Temperature',
        steps: [
          'Select the Bambu printer and the filament preset you are calibrating.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open the Calibration tab and choose the Temperature test.',
          'Set the start and end temperatures from the range below (5 °C steps).',
          'Slice and print the tower.',
          'Pick the best block using the evaluation guide.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Nozzle temperature (Other layers; optionally First layer)',
          scope: 'filament',
          note: 'Save as a NEW user preset — avoid overwriting Bambu system presets (they reset on updates anyway).'
        },
        gotchas: [
          'Bambu Studio Developer mode is the preferred fix when Temperature is hidden, because it exposes the calibration test without leaving the selected Bambu printer profile.',
          BAMBU_NON_BAMBU_FALLBACK,
          'Bambu machines also offer on-device/automatic calibration; this wizard uses the manual test so you make the judgment.'
        ]
      },
      'flow-pass1': {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Flow Rate → Coarse (Pass 1)',
        steps: [
          'Select the Bambu printer and the filament preset to calibrate (its current flow ratio is the baseline).',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open the Calibration tab → Flow Rate and choose the coarse test (Pass 1). Manual mode prints blocks with modifiers around ±20% in 5% steps. Bambu Studio does not offer Orca\'s YOLO flow method.',
          'X1/P1 with lidar also offer automatic flow calibration — this wizard covers the MANUAL path so you stay in control of the judgment.',
          'Slice and print; pick the smoothest block.',
          'New ratio = old × (100 + modifier) / 100 — computed for you below.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio (decimal)',
          scope: 'filament',
          note: 'Save the user preset before running the fine pass.'
        },
        gotchas: [
          'Bambu Studio Developer mode is the preferred fix when Flow Rate is hidden, because it exposes both coarse and fine Flow Rate tests with the Bambu printer still selected.',
          BAMBU_NON_BAMBU_FALLBACK
        ]
      },
      'flow-pass2': {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Flow Rate → Fine (Pass 2)',
        steps: [
          'Verify the coarse result is saved in the filament preset.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open Calibration tab → Flow Rate → fine calibration: blocks from −9% to 0% in 1% steps. Bambu Studio does not offer Orca\'s YOLO flow method.',
          'Slice, print, pick the best block; final ratio = saved ratio × (100 + modifier) / 100.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio',
          scope: 'filament',
          note: 'Overwrite the coarse value with the final one and save.'
        },
        gotchas: [
          'Same visibility caveat as the coarse pass: Developer mode is preferred because Pass 2 depends on the saved Bambu filament profile staying selected.',
          BAMBU_NON_BAMBU_FALLBACK
        ]
      },
      'pressure-advance': {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Flow Dynamics',
        steps: [
          'Bambu Studio calls Pressure Advance "Flow Dynamics Calibration"; the value is the K factor.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open the Calibration tab → Flow Dynamics. Choose Manual mode (lidar-equipped X1/P1 can run Automatic, but manual keeps you in control and works for every material).',
          'The manual test prints a series of labeled lines at increasing K values.',
          'Pick the line with the most uniform width — no bulges at speed changes, no thin breaks.',
          'Enter the K value in the result step; it is usually labeled directly on the plate.'
        ],
        saveTo: {
          path: 'Filament preset → Flow Dynamics (K value saved per filament + printer combination)',
          field: 'K factor',
          scope: 'filament',
          note: 'Bambu Studio stores K per filament/nozzle pairing; saving the calibration in the dialog attaches it to the filament preset.'
        },
        gotchas: [
          'Bambu Studio Developer mode is the preferred fix when Flow Dynamics is hidden, because it exposes the manual K-factor test without leaving the selected Bambu printer profile.',
          BAMBU_NON_BAMBU_FALLBACK,
          'Lidar-equipped X1/P1 can also run automatic Flow Dynamics on the machine.'
        ]
      },
      'flow-verify': {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Flow Rate → Fine (Pass 2)',
        steps: [
          'Verify BOTH your calibrated flow ratio AND the new K factor (Flow Dynamics) are saved — this re-check tests flow under the new pressure timing.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open Calibration tab → Flow Rate → fine calibration (−9% to 0%, 1% steps) — the same plate as the earlier fine pass.',
          'Slice, print, pick the smoothest block. The 0% block winning means your flow ratio is confirmed.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Flow ratio',
          scope: 'filament',
          note: 'Only update if a non-zero block won; then save the user preset.'
        },
        gotchas: [BAMBU_NON_BAMBU_FALLBACK]
      },
      retraction: {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Retraction test (Developer mode)',
        steps: [
          'Select the Bambu printer, filament preset, and normal process profile.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open the Calibration tab and choose the Retraction test.',
          'Run the generated stringing/retraction test, changing one variable at a time: distance first, then speed if needed.',
          'If Developer mode is not available, fall back to Orca Slicer or an external stringing test model and copy the resulting distance/speed into Bambu Studio.'
        ],
        saveTo: {
          path: 'Printer settings → Extruder → Retraction',
          field: 'Length (mm), Retraction speed',
          scope: 'printer',
          note: 'Printer-scoped; per-filament overrides exist under the filament\'s setting overrides.'
        },
        gotchas: [BAMBU_NON_BAMBU_FALLBACK]
      },
      'max-volumetric-speed': {
        available: true, builtIn: true,
        menuPath: 'Calibration tab → Max Flow Rate (Developer mode)',
        steps: [
          'Select the Bambu printer and the filament preset with calibrated temperature and flow saved.',
          BAMBU_DEVELOPER_MODE_BEST_PATH,
          'Open the Calibration tab and choose Max Flow Rate.',
          'Slice and print the generated max-flow test; note where surface quality, layer bonding, or extruder sounds first degrade.',
          'Use the last good flow as the raw result, then enter a conservative production value with safety margin in the filament preset.',
          'Developer mode also exposes VFA calibration in Bambu Studio. PerfectFit does not currently score VFA as a separate wizard step, but you can run it from the same Calibration area when diagnosing speed-related ringing or vertical fine artifacts.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Max volumetric speed (mm³/s)',
          scope: 'filament',
          note: 'Enter the production (margin-applied) value.'
        },
        gotchas: [BAMBU_NON_BAMBU_FALLBACK]
      },
      shrinkage: {
        available: true, builtIn: false,
        menuPath: '(external test model — no calibration menu entry)',
        steps: [
          'Bambu Studio has no built-in shrinkage test — use one of the external tools from the models list (the free Printables shrinkage tool reads the percentage directly off a printed vernier scale).',
          'Before slicing, open Filament settings → Filament and set Shrinkage to 100% (no compensation) — the test measures what the compensation SHOULD be.',
          'Print at 100% scale with your calibrated filament preset and normal process profile.',
          'Let the parts cool fully before reading — enclosure materials (ABS/ASA) keep contracting for a while.',
          'Enter the reading(s) in the result step.'
        ],
        saveTo: {
          path: 'Filament settings → Filament tab',
          field: 'Shrinkage — a percentage',
          scope: 'filament',
          note: 'Enter as a percentage (e.g. 99.4); Bambu Studio scales XY geometry up by 100/shrinkage%. Save as your user preset.'
        },
        gotchas: ['Re-slice existing plates after changing shrinkage — compensation is applied at slicing time.']
      },
      'final-verification': {
        available: true, builtIn: false,
        menuPath: '(normal printing)',
        steps: [
          'Start a fresh project; select printer, your saved filament user preset, and normal process profile.',
          'Import a verification model or a real part.',
          'Confirm the preset contains your calibrated values; slice, preview, print.',
          'Inspect with the checklist in the next step.'
        ],
        saveTo: { path: '—', field: '—', scope: 'calibration-only', note: 'Nothing to save.' }
      }
    }
  }
];

export function getSlicerContent(slicer: SlicerId, version?: string): SlicerVersionContent {
  const all = SLICER_CONTENT.filter(c => c.slicer === slicer);
  if (version) {
    const exact = all.find(c => c.version === version);
    if (exact) return exact;
  }
  return all[all.length - 1];
}

export function slicerVersionOptions(): { slicer: SlicerId; label: string; version: string }[] {
  return SLICER_CONTENT.map(c => ({ slicer: c.slicer, label: `${c.slicerLabel} ${c.version}`, version: c.version }));
}
