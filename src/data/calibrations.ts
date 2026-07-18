import type { CalibrationDef, CalibrationId, VerificationCategory } from '../types';

/**
 * Calibration test definitions — structured data, not hard-coded pages.
 * The wizard renders every module from these objects; adding a test means
 * adding an entry here (plus slicer instructions in data/slicers.ts).
 */

export const DEFAULT_ORDER: CalibrationId[] = [
  'temperature',
  'flow-pass1',
  'flow-pass2',
  'pressure-advance',
  'retraction',
  'max-volumetric-speed',
  'final-verification'
];

export const CALIBRATIONS: Record<CalibrationId, CalibrationDef> = {
  temperature: {
    id: 'temperature',
    name: 'Nozzle Temperature (Temp Tower)',
    shortName: 'Temperature',
    icon: '🌡️',
    purpose:
      'Finds the nozzle temperature where this filament flows well and layers weld together. ' +
      'Temperature affects almost everything you can see on a print: stringing, glossiness, ' +
      'overhangs, bridging, and — most importantly — how strongly layers stick to each other.',
    whyThisOrder:
      'Temperature comes first because every other test depends on how the plastic flows. ' +
      'Calibrating flow or pressure advance at the wrong temperature means redoing them.',
    whyExpanded:
      'The nozzle temperature controls how runny (viscous) the melted plastic is. Too cold and the plastic ' +
      'doesn\'t fully weld to the layer below — parts snap easily along layer lines and the extruder may skip. ' +
      'Too hot and the plastic sags on overhangs, strings across gaps, and can cook inside the nozzle. ' +
      'A temperature tower prints the same small test section over and over, each at a different temperature, ' +
      'so you can compare them side by side on one print instead of printing many separate tests.',
    dependencies: [],
    prerequisites: [
      { id: 'dry', label: 'Filament is dry (or fresh from a sealed bag)', coachNote: 'Wet filament pops, strings and looks bad at every temperature — drying first saves you from calibrating the moisture instead of the filament.' },
      { id: 'clean-nozzle', label: 'Nozzle is clean and not partially clogged', coachNote: 'A partial clog mimics under-extrusion and will mislead every test.' },
      { id: 'adhesion', label: 'First layer / bed adhesion is reliable on this printer', coachNote: 'If first layers regularly fail, fix bed leveling and Z-offset before calibrating filament.' },
      { id: 'profile-selected', label: 'A sensible starting filament profile is selected in the slicer', coachNote: 'Start from the closest generic profile (e.g. "Generic PETG") for your material.' }
    ],
    methods: [
      { id: 'orca-tower', label: 'Built-in temp tower (recommended)', description: 'The slicer generates a tower where each block prints at a different temperature. No downloads needed.', slicers: ['orca', 'bambu'], recommended: true }
    ],
    evaluationGuide: [
      { title: 'Layer adhesion (most important)', look: 'Try to snap each block by flexing the tower with pliers or fingers (wear eye protection). Blocks that crack easily along layer lines were printed too cold.', meaning: 'Higher temperature = stronger layer welding. Never pick a temperature only because it looks cleanest — a pretty but weak print fails in use.', severity: 'bad' },
      { title: 'Stringing / fine hairs', look: 'Wisps or hairs between the tower\'s towers or across gaps.', meaning: 'More stringing usually means too hot (or wet filament).', severity: 'adjust' },
      { title: 'Overhangs', look: 'The sloped/overhang section: drooping, curling edges, or rough undersides.', meaning: 'Sagging overhangs suggest too hot; rough but stiff overhangs can also be a cooling issue.', severity: 'adjust' },
      { title: 'Bridging', look: 'The horizontal bridge span: sagging or broken strands underneath.', meaning: 'Cleaner bridges usually happen at the cooler end of the workable range.', severity: 'adjust' },
      { title: 'Surface finish & gloss', look: 'Shiny vs matte bands; blobs and zits.', meaning: 'Gloss changes with temperature. Pick the finish you prefer, but only within the range that passed the adhesion check.', severity: 'good' },
      { title: 'Small features / lettering', look: 'The printed temperature numbers and any fine details: are they crisp or melted?', meaning: 'Melted details = too hot for fine work at this cooling level.', severity: 'adjust' }
    ],
    resultPrecision: 0,
    slicerDestination: { scope: 'filament', note: 'Filament settings → Filament → Nozzle temperature (plus optional separate first-layer temperature).' },
    versionNotes: [
      'Orca Slicer scales the tower to your nozzle diameter automatically (v2.x behavior).',
      'The official Orca guide recommends: if several blocks look equal, choose the middle of that range — or the hotter end if you plan to print fast.'
    ]
  },

  'flow-pass1': {
    id: 'flow-pass1',
    name: 'Flow Ratio — Pass 1 (coarse)',
    shortName: 'Flow pass 1',
    icon: '💧',
    purpose:
      'Sets how much plastic the printer pushes out per millimeter of movement. ' +
      'Too little leaves gaps between lines and weak parts; too much makes rough, bulging surfaces ' +
      'and inaccurate dimensions. Pass 1 finds the right neighborhood; Pass 2 fine-tunes it.',
    whyThisOrder:
      'Flow is calibrated right after temperature because the amount of plastic that actually comes out ' +
      'depends on how well it melts. Calibrating flow before temperature risks compensating for a melt problem with a flow number.',
    whyExpanded:
      'Slicers compute how much filament to feed from the line width, layer height, and movement distance. ' +
      'Real filament varies in diameter and how it flows, so a correction factor — the Flow Ratio — scales that amount. ' +
      'It is a small decimal near 1.0 (like 0.98), NOT a percentage. It is different from Pressure Advance ' +
      '(which times pressure changes but doesn\'t change total volume) and from Max Volumetric Speed ' +
      '(which caps how fast plastic can flow, not how much). Line width is a geometry setting, not a correction. ' +
      'Keep these separate — fixing one with another is the most common calibration mistake.',
    dependencies: ['temperature'],
    prerequisites: [
      { id: 'temp-done', label: 'Nozzle temperature is calibrated (or a known-good temp is set)', coachNote: 'Flow tests printed at a bad temperature give misleading surfaces.' },
      { id: 'profile', label: 'The filament profile you\'re calibrating is active in the slicer', coachNote: 'The test bases its math on the profile\'s CURRENT flow ratio — the wrong profile ruins the math.' },
      { id: 'plate-clean', label: 'Build plate is clean (top surfaces show fingerprint grease)', coachNote: 'You\'ll judge top surfaces — grease and dust show up as defects that aren\'t flow related.' }
    ],
    methods: [
      { id: 'yolo', label: 'YOLO — one-pass (Orca, recommended)', description: 'Eleven blocks with absolute modifiers (±0.05 in 0.01 steps). New ratio = old ratio + modifier. Usually accurate enough in a single pass; a "Perfectionist" variant offers 0.005 steps.', slicers: ['orca'], recommended: true },
      { id: 'pass1', label: 'Pass 1 — coarse (Orca legacy & Bambu Studio)', description: 'Nine blocks with percentage modifiers in 5% steps. New ratio = old × (100 + modifier) / 100. Follow with Pass 2.', slicers: ['orca', 'bambu'] }
    ],
    evaluationGuide: [
      { title: 'Top surface smoothness', look: 'Look across each block\'s top at a shallow angle in good light; run a fingernail across it.', meaning: 'The best block feels smooth and shows no valleys between lines (under-extrusion) and no ridges or roughness (over-extrusion).', severity: 'good' },
      { title: 'Gaps between lines', look: 'Tiny parallel grooves or pinholes between extrusion lines.', meaning: 'Under-extrusion — flow too low on that block.', severity: 'bad' },
      { title: 'Ridges / rough weave', look: 'Raised lines, a bumpy "corduroy" texture, or material pushed up at line crossings.', meaning: 'Over-extrusion — flow too high on that block.', severity: 'bad' },
      { title: 'Archimedean pattern: spiral joint line', look: 'On the YOLO blocks, check the line where the inner spiral meets the outer arcs.', meaning: 'A strongly visible joint or material build-up means too much flow; gaps opening between arcs mean too little.', severity: 'adjust' }
    ],
    resultPrecision: 3,
    slicerDestination: { scope: 'filament', note: 'Filament settings → Filament → Flow ratio. A decimal near 1.0 — never enter a percentage here.' },
    versionNotes: [
      'Orca v2.x offers YOLO (recommended), YOLO perfectionist, and the legacy Pass 1/Pass 2 under Calibration → Flow rate.',
      'Bambu Studio calls this Flow Rate calibration (coarse ±20% in 5% steps, fine 1% steps).',
      'On Bambu printers, disable the printer\'s own "Flow Calibration" option before printing the test — it would fight the test.'
    ]
  },

  'flow-pass2': {
    id: 'flow-pass2',
    name: 'Flow Ratio — Pass 2 (fine)',
    shortName: 'Flow pass 2',
    icon: '🎯',
    purpose:
      'Narrows the flow ratio found in Pass 1 to a final value. Pass 1 steps are coarse (5%); ' +
      'Pass 2 re-runs the test in fine (1%) steps below the Pass 1 result.',
    whyThisOrder:
      'Runs immediately after Pass 1, using the value Pass 1 produced. If you used the one-pass YOLO method ' +
      'with good results, you can skip Pass 2 — YOLO\'s 0.01 steps already land within fine range.',
    whyExpanded:
      'Because Pass 1 modifies flow in 5% jumps, the truth usually lies between two blocks. ' +
      'Pass 2 prints ten blocks from −9% to 0% around the Pass-1 result in 1% steps, ' +
      'letting you land within 1% of ideal. The formula is identical: new = old × (100 + modifier) / 100 ' +
      '— "old" now being the Pass 1 result you saved.',
    dependencies: ['flow-pass1'],
    prerequisites: [
      { id: 'pass1-saved', label: 'Pass 1 result is saved in the filament profile', coachNote: 'Pass 2\'s blocks are computed from the CURRENT profile value — if you didn\'t save Pass 1\'s result, Pass 2 tests the wrong range.' },
      { id: 'same-conditions', label: 'Same temperature, plate, and cooling as Pass 1', coachNote: 'Changing conditions between passes makes the two results incomparable.' }
    ],
    methods: [
      { id: 'pass2', label: 'Pass 2 — fine (−9% to 0%, 1% steps)', description: 'Ten blocks; pick the smoothest and apply new = old × (100 + modifier) / 100.', slicers: ['orca', 'bambu'], recommended: true }
    ],
    evaluationGuide: [
      { title: 'Top surface at fine scale', look: 'Differences are subtle now — use raking light (hold the blocks up near a lamp at a low angle) and compare neighboring blocks directly.', meaning: 'Pick the first block (counting from the most-negative modifier) whose lines fully close with no ridging.', severity: 'good' },
      { title: 'Fingernail test', look: 'Drag a nail perpendicular to the top lines on candidate blocks.', meaning: 'Catching in grooves = still under-extruded; smooth glassy drag = good; bumping over ridges = over-extruded.', severity: 'adjust' }
    ],
    resultPrecision: 3,
    slicerDestination: { scope: 'filament', note: 'Filament settings → Filament → Flow ratio (overwrite the Pass 1 value with the final one).' },
    versionNotes: [
      'Pass 2 modifiers run −9 to 0 (percent) in both Orca legacy flow calibration and Bambu Studio fine calibration.'
    ]
  },

  'pressure-advance': {
    id: 'pressure-advance',
    name: 'Pressure Advance',
    shortName: 'Pressure Advance',
    icon: '🏎️',
    purpose:
      'Tunes the timing of extrusion pressure so corners come out sharp instead of bulging or rounded, ' +
      'and lines stay a constant width when the printer speeds up and slows down. ' +
      'It does not change HOW MUCH plastic is extruded overall — that\'s Flow Ratio.',
    whyThisOrder:
      'PA is tuned after flow because judging corner bulges requires correct line widths. ' +
      'With flow wrong, every corner looks wrong no matter the PA value.',
    whyExpanded:
      'Molten plastic in the nozzle acts like a compressed spring: when the print head accelerates, pressure ' +
      'takes a moment to build, so lines start thin; when it decelerates into a corner, leftover pressure keeps ' +
      'oozing, so corners bulge. Pressure Advance (Klipper term; "Linear Advance / K-factor" on Marlin) tells the ' +
      'firmware to push extra filament slightly BEFORE speed-ups and back off BEFORE slow-downs. ' +
      'Direct-drive extruders need small values (~0.02–0.05); Bowden systems, with their long tube, need much ' +
      'larger ones (~0.2–1.0+). Marlin printers must have Linear Advance enabled in firmware for this to work at all — not all do.',
    dependencies: ['flow-pass1'],
    prerequisites: [
      { id: 'flow-done', label: 'Flow ratio is calibrated', coachNote: 'PA evaluation reads line width consistency — impossible to judge with the wrong flow.' },
      { id: 'la-enabled', label: 'Printer firmware supports PA / Linear Advance (Klipper: built in; Marlin: M900 must be enabled in the firmware build)', coachNote: 'If the tower shows zero change from bottom to top, your firmware is likely ignoring the command.' },
      { id: 'first-layer', label: 'First layer is reliable (needed for the Line method especially)', coachNote: 'The line test lives entirely on the first layer; bed mesh leveling helps.' }
    ],
    methods: [
      { id: 'tower', label: 'Tower method', description: 'A square tower where PA increases with height. Slower, but doesn\'t depend on first-layer quality. Judge the best-looking corners and measure that height.', slicers: ['orca', 'bambu'], recommended: true },
      { id: 'pattern', label: 'Pattern method (Ellis-style)', description: 'V-shaped corner patterns printed at increasing PA values, labeled on the plate. Good balance of speed and readability.', slicers: ['orca'] },
      { id: 'line', label: 'Line method', description: 'Fastest: pairs of fast/slow line segments at increasing PA values with printed labels. Accuracy depends heavily on a good first layer.', slicers: ['orca'] }
    ],
    evaluationGuide: [
      { title: 'Corner bulges', look: 'Corners that look swollen, rounded outward, or have a blob exactly at the corner.', meaning: 'PA too LOW — pressure isn\'t released early enough before the corner.', severity: 'bad' },
      { title: 'Gaps or thin lines after corners', look: 'The line goes faint, thin, or breaks just AFTER a direction change; corners look chamfered/cut off.', meaning: 'PA too HIGH — pressure drops too aggressively.', severity: 'bad' },
      { title: 'Inconsistent line width', look: 'Lines that pulse thick-thin along fast/slow transitions.', meaning: 'PA wrong in either direction; find the sample where width stays constant through speed changes.', severity: 'adjust' },
      { title: 'The transition zone', look: 'On towers/patterns, find where corners change from bulging (low) to gapped (high).', meaning: 'The best value sits at the cleanest point between those two failure modes — sharp corners, even width, no gaps.', severity: 'good' }
    ],
    resultPrecision: 3,
    slicerDestination: { scope: 'filament', note: 'Filament settings → Filament → Advanced → Enable pressure advance + value. (Saved per filament; on Bambu printers this is the "K" factor.)' },
    versionNotes: [
      'Orca v2.x: Calibration → Pressure advance offers Line, Pattern (adapted from Ellis\' generator), and Tower, each with direct-drive and Bowden defaults.',
      'Orca also offers Adaptive PA (per-flow-rate table) for high-speed printers — out of scope for this wizard\'s v1.',
      'Bambu Studio calls this "Flow Dynamics Calibration" (K value), with manual line test or automatic on X1/P1 lidar models.',
      'On Bambu printers, uncheck the printer-side "Flow Dynamics Calibration" option when printing a manual test.'
    ]
  },

  retraction: {
    id: 'retraction',
    name: 'Retraction',
    shortName: 'Retraction',
    icon: '🧵',
    purpose:
      'Finds the smallest amount of filament pull-back that stops stringing and oozing when the print head ' +
      'travels between parts. Too little leaves hairs and blobs; too much causes clogs, grinding, and gaps ' +
      'when printing resumes.',
    whyThisOrder:
      'Retraction is tuned near the end because temperature (ooze), flow (pressure), and PA all change how much ' +
      'the nozzle oozes during travel. Tuning retraction first would bake those errors into the distance.',
    whyExpanded:
      'When the print head moves without printing, melted plastic keeps dripping out of the nozzle unless it\'s ' +
      'pulled back — retracted — first. The retraction DISTANCE is how many millimeters of filament get pulled; ' +
      'SPEED is how fast. Direct-drive extruders sit right on top of the nozzle, so 0.2–2 mm usually suffices. ' +
      'Bowden systems must also take up the slack in the long PTFE tube, needing 1–6 mm. ' +
      'More is not better: every retraction drags soft plastic up into the cool zone of the hotend. Excessive distance ' +
      'causes heat creep jams, grinds the filament, and leaves under-extruded gaps after each travel. ' +
      'The goal is the SHORTEST distance that gives an acceptably clean tower.',
    dependencies: ['temperature', 'pressure-advance'],
    prerequisites: [
      { id: 'temp-done2', label: 'Temperature is calibrated (stringing is temperature-sensitive)', coachNote: 'If you skipped the temp tower, strings may be a temperature problem — you\'d be fixing the wrong thing.' },
      { id: 'dry2', label: 'Filament is dry', coachNote: 'Moisture boils in the nozzle and causes stringing no retraction can fix. If drying is impossible right now, expect limited results.' },
      { id: 'pa-done', label: 'Pressure advance is set (or consciously skipped)', coachNote: 'PA affects ooze pressure at travel starts.' }
    ],
    methods: [
      { id: 'tower', label: 'Built-in retraction tower', description: 'Twin towers with travel moves between them; retraction length increases with height. Find the lowest height that\'s clean.', slicers: ['orca'], recommended: true },
      { id: 'bambu-manual', label: 'Manual test model (Bambu Studio)', description: 'Bambu Studio has no retraction tower generator; use a stringing test model and change retraction per print, one variable at a time.', slicers: ['bambu'] }
    ],
    evaluationGuide: [
      { title: 'Fine hairs', look: 'Thin wispy strands between the two towers, easily brushed off.', meaning: 'Mild under-retraction (or slightly wet filament) at that height.', severity: 'adjust' },
      { title: 'Thick strings & branching', look: 'Heavier strands, or strings with droplets/branches.', meaning: 'Clear under-retraction at that height — or filament that badly needs drying if it never improves.', severity: 'bad' },
      { title: 'Blobs and nozzle scars', look: 'Blobs where travels begin, or dragged scar marks on surfaces.', meaning: 'Ooze at travel start; more retraction (or slightly faster retraction speed) helps.', severity: 'adjust' },
      { title: 'Gaps after travel (over-retraction)', look: 'Missing or thin extrusion right where printing resumes after a travel move.', meaning: 'Too much retraction — the nozzle re-primes late. Prefer a lower section that\'s clean.', severity: 'bad' },
      { title: 'Grinding / clicking during the print', look: 'Listen: rhythmic clicking, or filament with chewed-out divots.', meaning: 'The extruder is struggling — retraction distance or speed too high for this setup. Stop increasing.', severity: 'bad' },
      { title: 'Already clean at the bottom?', look: 'Tower looks clean from the very first sections.', meaning: 'Low-ooze filament (common for dry PLA/ABS): pick a small value like 0.2–0.4 mm (direct drive) instead of zero, per the official guide.', severity: 'good' }
    ],
    resultPrecision: 2,
    slicerDestination: { scope: 'printer', note: 'Printer settings → Extruder → Retraction (length, speed). NOTE: retraction lives in the PRINTER profile, not the filament profile — Orca can also override it per-filament under Filament → Setting overrides.' },
    versionNotes: [
      'Orca v2.x defaults: 0→2 mm step 0.1 (direct drive); the wiki suggests 1→6 mm step 0.2 for Bowden.',
      'Find the best height, then read the exact length from the G-code preview: search for the Calib_Retraction_tower comment (the plain "retract" lines can be misleading with wipe settings).',
      'Bambu Studio has no retraction tower; calibrate with a stringing model, changing only one variable per print.'
    ]
  },

  'max-volumetric-speed': {
    id: 'max-volumetric-speed',
    name: 'Max Volumetric Speed',
    shortName: 'Max flow',
    icon: '⚡',
    purpose:
      'Finds how many cubic millimeters of plastic per second your hotend can actually melt for THIS filament. ' +
      'The slicer then automatically slows any move that would exceed it — preventing under-extrusion, weak layers, ' +
      'and extruder clicking on fast prints.',
    whyThisOrder:
      'Run near the end: it needs the calibrated temperature (melt rate depends strongly on temperature) and flow. ' +
      'Note the official Orca guide runs it earlier (right after temperature) — either works; what matters is temperature first.',
    whyExpanded:
      'In beginner terms: your hotend is a wax melter with a speed limit. Push plastic through faster than it can melt, ' +
      'and the plastic comes out thin, weak, or not at all — the extruder skips and clicks. ' +
      'In technical terms: every print move consumes Volumetric Flow = layer height × line width × speed (mm³/s). ' +
      'The filament\'s Max Volumetric Speed setting caps that product; the slicer slows moves to respect it. ' +
      'This is why "print speed" alone is meaningless: 300 mm/s at a 0.2 mm layer and 0.42 mm line is 25.2 mm³/s — ' +
      'beyond many hotends. The test ramps flow continuously up a tower; where quality collapses is your ceiling. ' +
      'Because it\'s a best-case measurement, production values keep a safety margin below it.',
    dependencies: ['temperature', 'flow-pass1'],
    prerequisites: [
      { id: 'temp-final', label: 'Printing at your calibrated (ideally high-end) temperature', coachNote: 'Max flow rises with temperature. Calibrate at the temp you\'ll actually use — or the high-flow temp you chose in the temp tower.' },
      { id: 'flow-final', label: 'Flow ratio is calibrated', coachNote: 'Wrong flow shifts where under-extrusion appears.' },
      { id: 'limits-known', label: 'You know your printer\'s rated limits (profile filled in)', coachNote: 'The app will never recommend a value above your printer profile\'s configured max flow.' }
    ],
    methods: [
      { id: 'tower', label: 'Built-in max flowrate test', description: 'A thin-walled tower whose volumetric speed ramps from start to end continuously with height. Measure where defects begin.', slicers: ['orca'], recommended: true },
      { id: 'manual-calc', label: 'Manual observation + calculator', description: 'For slicers without the test (Bambu Studio): use the volumetric flow calculator and known-good speeds, or print CNC-Kitchen-style test structures.', slicers: ['bambu'] }
    ],
    evaluationGuide: [
      { title: 'Sheen change', look: 'A band where the surface turns from glossy to matte (or vice versa).', meaning: 'Often the first sign the melt is falling behind — note its height even if walls still look solid.', severity: 'adjust' },
      { title: 'Rough / gappy walls', look: 'Walls become rough, thin, or show gaps and dropped lines.', meaning: 'Under-extrusion — the flow ceiling is below this height.', severity: 'bad' },
      { title: 'Weak layers', look: 'Gently flex the printed tower: does the top section flex/crack more easily than the bottom?', meaning: 'Layer bonding degraded before it became visible — your true limit is at or below where weakness starts.', severity: 'bad' },
      { title: 'Extruder clicking / grinding', look: 'Listen during the print; note the height when clicking starts.', meaning: 'The extruder physically can\'t push filament that fast — hard mechanical limit reached.', severity: 'bad' },
      { title: 'Complete failure', look: 'Extrusion stops or becomes hair-thin.', meaning: 'Far beyond the limit — measure just below where problems began, not here.', severity: 'bad' }
    ],
    resultPrecision: 1,
    slicerDestination: { scope: 'filament', note: 'Filament settings → Filament → Max volumetric speed (mm³/s).' },
    versionNotes: [
      'Orca v2.x default test range: 5→20 mm³/s, step 0.5 per mm of height. Result = start + measured_height × step.',
      'Alternative reading: in Preview with the "Flow" color scheme, find the flow value at your measured layer.',
      'The official wiki recommends reducing the measured value 10–20% for production — this app defaults to 15% headroom (configurable).',
      'Bambu Studio has no equivalent generator; use the calculator approach.'
    ]
  },

  'final-verification': {
    id: 'final-verification',
    name: 'Final Verification Print',
    shortName: 'Verification',
    icon: '✅',
    purpose:
      'One real-world print that exercises everything you calibrated: first layer, overhangs, bridges, corners, ' +
      'seams, small details, travels, and speed changes. It confirms the profile works as a whole — settings that ' +
      'each looked right in isolation can still interact badly.',
    whyThisOrder:
      'Last, because it validates the combination of all previous results under realistic conditions.',
    whyExpanded:
      'Calibration tests are deliberately artificial — each isolates one variable. A verification print is the ' +
      'opposite: a normal object printed with your normal process profile. You inspect it category by category. ' +
      'If a category fails, the app suggests which calibration most likely explains it — as a ranked list of ' +
      'suspects, not a verdict, because several settings influence most symptoms.',
    dependencies: ['temperature', 'flow-pass1', 'pressure-advance', 'retraction', 'max-volumetric-speed'],
    prerequisites: [
      { id: 'all-saved', label: 'All calibrated values are saved in the filament profile & printer profile', coachNote: 'Verify each value landed in the slicer — a common failure is testing with half-saved settings.' },
      { id: 'user-preset', label: 'Values saved as a NEW user preset (not overwriting a stock system preset)', coachNote: 'Name it like "Brand Material Color - Printer - Nozzle" so it\'s recognizable later.' }
    ],
    methods: [
      { id: 'benchy-like', label: 'Torture-style test model', description: 'Any compact model combining overhangs, bridges, small details and smooth hulls (e.g. 3DBenchy — free to print, see models list). Print with your NORMAL process profile.', slicers: ['orca', 'bambu'], recommended: true },
      { id: 'own-model', label: 'A real part you actually print', description: 'Verifying on the kind of geometry you actually care about is equally valid.', slicers: ['orca', 'bambu'] }
    ],
    evaluationGuide: [
      { title: 'Work through the checklist', look: 'The result entry step lists each category (first layer, surfaces, corners, seams, overhangs, bridging, retraction, details, adhesion, high-speed sections).', meaning: 'Mark each Pass / Acceptable / Needs adjustment / Not tested. Any "Needs adjustment" produces ranked suggestions.', severity: 'good' }
    ],
    resultPrecision: 0,
    slicerDestination: { scope: 'calibration-only', note: 'No value to enter — this step validates the saved profile.' },
    versionNotes: []
  }
};

/** Verification categories with ranked likely causes. */
export const VERIFICATION_CATEGORIES: VerificationCategory[] = [
  {
    id: 'first-layer', label: 'First layer',
    coachHint: 'Even, well-bonded, no gaps or ripples across the bottom face.',
    likelyCauses: [
      { step: 'temperature', why: 'First-layer temperature may need to be higher for adhesion.' },
      { step: 'flow-pass1', why: 'Under/over-extrusion shows strongly on the first layer.' }
    ]
  },
  {
    id: 'surfaces', label: 'Surface quality (walls & top)',
    coachHint: 'Uniform, no random blobs, consistent line texture.',
    likelyCauses: [
      { step: 'flow-pass2', why: 'Fine flow errors show as rough or gappy surfaces.' },
      { step: 'temperature', why: 'Temperature affects gloss, blobs, and finish.' },
      { step: 'max-volumetric-speed', why: 'If defects appear only on fast sections, the flow ceiling is set too high.' }
    ]
  },
  {
    id: 'corners', label: 'Corners',
    coachHint: 'Sharp, not bulging, not gapped right after the turn.',
    likelyCauses: [
      { step: 'pressure-advance', why: 'Corner bulges (PA low) or post-corner gaps (PA high) are the classic PA symptoms.' },
      { step: 'flow-pass2', why: 'Global over-extrusion also swells corners.' }
    ]
  },
  {
    id: 'seams', label: 'Seams',
    coachHint: 'A tidy, consistent seam line without fat blobs or holes.',
    likelyCauses: [
      { step: 'pressure-advance', why: 'Seam blobs/gaps come from pressure timing at loop start/stop.' },
      { step: 'retraction', why: 'Ooze at seam positions can be a retraction issue.' }
    ]
  },
  {
    id: 'overhangs', label: 'Overhangs',
    coachHint: 'Undersides reasonably smooth up to ~50–60°, no curling.',
    likelyCauses: [
      { step: 'temperature', why: 'Too hot makes overhangs droop; cooling also matters (a process setting, not filament).' },
      { step: 'max-volumetric-speed', why: 'Excess flow rate worsens overhang sag on fast prints.' }
    ]
  },
  {
    id: 'bridging', label: 'Bridging',
    coachHint: 'Spans mostly straight strands, minimal sag.',
    likelyCauses: [
      { step: 'temperature', why: 'Cooler end of the range bridges better.' },
      { step: 'flow-pass1', why: 'Over-extrusion makes heavy, saggy bridges.' }
    ]
  },
  {
    id: 'retractions', label: 'Stringing / travel marks',
    coachHint: 'No hairs between features, no blobs at travel starts.',
    likelyCauses: [
      { step: 'retraction', why: 'Stringing is retraction\'s home turf.' },
      { step: 'temperature', why: 'Persistent stringing after retraction tuning often means too hot — or wet filament (dry it and retest).' }
    ]
  },
  {
    id: 'details', label: 'Small details',
    coachHint: 'Fine features crisp, text legible, no melting.',
    likelyCauses: [
      { step: 'temperature', why: 'Melted details point to too much heat (or insufficient cooling time per layer).' },
      { step: 'pressure-advance', why: 'Smearing on tiny features can be pressure timing.' }
    ]
  },
  {
    id: 'adhesion', label: 'Layer adhesion / strength',
    coachHint: 'Flex or (destructively) break a sacrificial part: it shouldn\'t split along layers easily.',
    likelyCauses: [
      { step: 'temperature', why: 'Cold layers weld poorly — the #1 adhesion factor.' },
      { step: 'max-volumetric-speed', why: 'Printing beyond the melt capacity weakens layers even when they look fine.' },
      { step: 'flow-pass1', why: 'Under-extrusion leaves voids that weaken parts.' }
    ]
  },
  {
    id: 'fast-sections', label: 'High-speed sections',
    coachHint: 'Quality holds up where the printer moves fastest (long straight walls, infill).',
    likelyCauses: [
      { step: 'max-volumetric-speed', why: 'Fast-section failures mean the volumetric cap is above the filament\'s real limit.' },
      { step: 'pressure-advance', why: 'Speed-transition artifacts are PA territory.' }
    ]
  }
];

export function getCalibration(id: CalibrationId): CalibrationDef {
  return CALIBRATIONS[id];
}
