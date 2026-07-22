import type { MaterialPreset } from '../types';

/**
 * Material presets: SUGGESTED starting points only.
 * Every range stays editable in the UI, and the app cross-checks
 * against the selected printer profile's limits before recommending anything.
 *
 * Sources: general manufacturer datasheet ranges; deliberately conservative.
 */
export const MATERIALS: MaterialPreset[] = [
  {
    id: 'PLA', label: 'PLA',
    description: 'The most common, easiest material. Low warp, prints cool.',
    nozzleTemp: { min: 190, max: 230 }, bedTemp: { min: 50, max: 65 },
    towerRange: { start: 230, end: 190, step: 5 },
    startingFlowRatio: 0.98,
    mvsRange: { start: 5, end: 20, step: 0.5 }, typicalMvs: 12,
    warnings: []
  },
  {
    id: 'PLA+', label: 'PLA+ / Tough PLA',
    description: 'Modified PLA with better toughness; usually likes slightly higher temps than plain PLA.',
    nozzleTemp: { min: 200, max: 235 }, bedTemp: { min: 50, max: 70 },
    towerRange: { start: 235, end: 195, step: 5 },
    startingFlowRatio: 0.98,
    mvsRange: { start: 5, end: 20, step: 0.5 }, typicalMvs: 12,
    warnings: ['"PLA+" formulations vary a lot between brands — trust the spool label over this preset.']
  },
  {
    id: 'PETG', label: 'PETG',
    description: 'Tough, slightly flexible, good chemical resistance. Tends to string and stick hard to some plates.',
    nozzleTemp: { min: 220, max: 260 }, bedTemp: { min: 70, max: 85 },
    towerRange: { start: 260, end: 220, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 4, end: 15, step: 0.5 }, typicalMvs: 9,
    hygroscopic: true,
    warnings: [
      'PETG often arrives WET from the factory — standard plastic bags with desiccant are not proof of dryness. Dry it before calibrating (typically 65 °C for 4–6 h), even brand-new spools.',
      'PETG can bond permanently to bare glass or PEI at high bed temps — use a release agent or textured plate if unsure.',
      'PETG strings more than PLA; expect to rely on the retraction test.'
    ]
  },
  {
    id: 'PCTG', label: 'PCTG',
    description: 'A tougher, less stringy relative of PETG.',
    nozzleTemp: { min: 240, max: 270 }, bedTemp: { min: 70, max: 90 },
    towerRange: { start: 270, end: 240, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 4, end: 15, step: 0.5 }, typicalMvs: 9,
    hygroscopic: true,
    warnings: [
      'Like PETG, PCTG can arrive wet even in sealed packaging — dry new spools before calibrating.',
      'Check that your hotend is rated for sustained printing at 260 °C+.'
    ]
  },
  {
    id: 'ABS', label: 'ABS',
    description: 'Strong and heat-resistant, but warps: needs a hot bed and ideally an enclosure. Fumes — ventilate.',
    nozzleTemp: { min: 230, max: 270 }, bedTemp: { min: 90, max: 110 },
    towerRange: { start: 270, end: 230, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 4, end: 18, step: 0.5 }, typicalMvs: 10,
    enclosureRecommended: true,
    warnings: [
      'ABS produces fumes (styrene) — print in a ventilated space, ideally an enclosure with filtration.',
      'Check your printer\'s max bed temperature: many beds cannot reach 100 °C.'
    ]
  },
  {
    id: 'ASA', label: 'ASA',
    description: 'Like ABS but UV-stable for outdoor parts. Same enclosure and ventilation needs.',
    nozzleTemp: { min: 240, max: 270 }, bedTemp: { min: 90, max: 110 },
    towerRange: { start: 270, end: 240, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 4, end: 16, step: 0.5 }, typicalMvs: 10,
    enclosureRecommended: true,
    warnings: ['ASA produces fumes — ventilate. Enclosure strongly recommended to prevent warping.']
  },
  {
    id: 'TPU', label: 'TPU (flexible)',
    description: 'Flexible filament. Print slow, minimal retraction; hard for Bowden extruders.',
    nozzleTemp: { min: 210, max: 240 }, bedTemp: { min: 30, max: 60 },
    towerRange: { start: 240, end: 210, step: 5 },
    startingFlowRatio: 1.0,
    mvsRange: { start: 1, end: 8, step: 0.5 }, typicalMvs: 3.5,
    flexible: true, hygroscopic: true,
    warnings: [
      'TPU frequently arrives WET even in sealed factory bags, and wet TPU strings and bubbles badly — dry it before calibrating (typically 50–60 °C for 6–12 h), even brand-new spools.',
      'Flexible filaments can bind or buckle in Bowden systems — reduce retraction drastically and print slowly.',
      'High retraction with TPU commonly jams extruders. Start near zero.'
    ]
  },
  {
    id: 'PA', label: 'PA / Nylon',
    description: 'Very tough and wear-resistant, but extremely moisture-sensitive: must be dried before calibrating.',
    nozzleTemp: { min: 250, max: 290 }, bedTemp: { min: 70, max: 100 },
    towerRange: { start: 290, end: 250, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 3, end: 14, step: 0.5 }, typicalMvs: 8,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Wet nylon is uncalibratable — dry it (typically 70–80 °C for 8–12 h) before any test.',
      'Many stock hotends with PTFE liners are NOT safe above 250 °C — verify an all-metal hot path.'
    ]
  },
  {
    id: 'PA-CF', label: 'PA-CF (carbon-filled nylon)',
    description: 'Carbon-fiber-filled nylon: stiff, dimensionally stable, abrasive.',
    nozzleTemp: { min: 260, max: 300 }, bedTemp: { min: 70, max: 100 },
    towerRange: { start: 300, end: 260, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 2, end: 12, step: 0.5 }, typicalMvs: 7,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Abrasive: requires a hardened steel (or better) nozzle. Brass will wear out quickly.',
      'Dry before calibrating; verify your hotend is rated for 280 °C+.'
    ]
  },
  {
    id: 'PA-GF', label: 'PA-GF (glass-filled nylon)',
    description: 'Glass-fiber-filled nylon: strong and heat resistant, very abrasive.',
    nozzleTemp: { min: 260, max: 300 }, bedTemp: { min: 70, max: 100 },
    towerRange: { start: 300, end: 260, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 2, end: 12, step: 0.5 }, typicalMvs: 7,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Very abrasive: hardened nozzle required.',
      'Dry before calibrating; verify hotend temperature rating.'
    ]
  },
  {
    id: 'PC', label: 'PC (polycarbonate)',
    description: 'Very strong and heat resistant; demands high temps and an enclosure.',
    nozzleTemp: { min: 260, max: 310 }, bedTemp: { min: 90, max: 115 },
    towerRange: { start: 310, end: 260, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 2, end: 12, step: 0.5 }, typicalMvs: 8,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Requires an all-metal hotend rated well above 280 °C and usually a 100 °C+ bed — check both limits.',
      'Most open-frame printers cannot print PC reliably.'
    ]
  },
  {
    id: 'PPA', label: 'PPA (high-temp nylon)',
    description: 'High-performance polyphthalamide; industrial material with demanding requirements.',
    nozzleTemp: { min: 280, max: 320 }, bedTemp: { min: 100, max: 120 },
    towerRange: { start: 320, end: 280, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 2, end: 10, step: 0.5 }, typicalMvs: 6,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Exceeds the temperature limits of most consumer printers — verify every limit before attempting.',
      'Usually fiber-filled: hardened nozzle required.'
    ]
  },
  {
    id: 'PPS', label: 'PPS',
    description: 'Extreme-performance polymer (chemical + heat resistance). Requires specialized hardware.',
    nozzleTemp: { min: 300, max: 340 }, bedTemp: { min: 100, max: 140 },
    towerRange: { start: 340, end: 300, step: 5 },
    startingFlowRatio: 0.95,
    mvsRange: { start: 2, end: 10, step: 0.5 }, typicalMvs: 5,
    hygroscopic: true, enclosureRecommended: true,
    warnings: [
      'Only for machines rated for 300 °C+ nozzle, heated chamber recommended. Most printers cannot print PPS.',
      'Consult the manufacturer datasheet — ranges vary widely.'
    ]
  },
  {
    id: 'OTHER', label: 'Other / specialty',
    description: 'Anything not listed. Enter ranges from the manufacturer\'s datasheet.',
    nozzleTemp: { min: 190, max: 260 }, bedTemp: { min: 40, max: 100 },
    towerRange: { start: 250, end: 200, step: 5 },
    startingFlowRatio: 1.0,
    mvsRange: { start: 3, end: 15, step: 0.5 }, typicalMvs: 8,
    warnings: ['No preset exists for this material — use the ranges printed on the spool or datasheet.']
  }
];

export function getMaterial(id: string): MaterialPreset {
  return MATERIALS.find(m => m.id === id) ?? MATERIALS[MATERIALS.length - 1];
}
