/**
 * Formula engine.
 *
 * Every formula here mirrors the official Orca Slicer wiki (verified against
 * OrcaSlicer v2.4.x docs, July 2026) or Bambu Studio wiki. Each function
 * returns the inputs, the formula text, the raw and rounded results, and any
 * warnings — so the UI can show the whole calculation, never a black box.
 */

export interface CalcResult {
  inputs: Record<string, number>;
  formulaText: string;
  substituted: string;
  raw: number;
  rounded: number;
  precision: number;
  unit: string;
  warnings: string[];
}

export function roundTo(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * f) / f;
}

// --- Flow ratio ------------------------------------------------------------

/**
 * Orca YOLO method: newRatio = oldRatio + modifier
 * (modifier is an absolute delta like +0.01, printed on each block)
 */
export function flowYolo(oldRatio: number, modifier: number): CalcResult {
  const raw = oldRatio + modifier;
  const warnings: string[] = [];
  if (oldRatio <= 0) warnings.push('Old flow ratio must be positive.');
  if (raw < 0.7 || raw > 1.3) {
    warnings.push('Result outside the plausible 0.70–1.30 range — double-check the old ratio and the block you selected.');
  }
  return {
    inputs: { oldRatio, modifier },
    formulaText: 'NewFlowRatio = OldFlowRatio + modifier',
    substituted: `${oldRatio} + ${fmtSigned(modifier)} = ${raw.toFixed(4)}`,
    raw, rounded: roundTo(raw, 3), precision: 3, unit: '', warnings
  };
}

/**
 * Orca legacy 2-pass / Bambu Studio coarse+fine method:
 * newRatio = oldRatio × (100 + modifier%) / 100
 */
export function flowPercent(oldRatio: number, modifierPercent: number): CalcResult {
  const raw = (oldRatio * (100 + modifierPercent)) / 100;
  const warnings: string[] = [];
  if (oldRatio <= 0) warnings.push('Old flow ratio must be positive.');
  if (oldRatio > 2) {
    warnings.push('Old flow ratio looks like a percentage (e.g. 98) — Orca/Bambu expect a decimal like 0.98. Divide by 100.');
  }
  if (raw < 0.7 || raw > 1.3) {
    warnings.push('Result outside the plausible 0.70–1.30 range — double-check inputs.');
  }
  return {
    inputs: { oldRatio, modifierPercent },
    formulaText: 'NewFlowRatio = OldFlowRatio × (100 + modifier) / 100',
    substituted: `${oldRatio} × (100 ${fmtSigned(modifierPercent, true)}) / 100 = ${raw.toFixed(5)}`,
    raw, rounded: roundTo(raw, 3), precision: 3, unit: '', warnings
  };
}

/** Guard: users sometimes type 98 instead of 0.98. */
export function looksLikePercentage(flowRatio: number): boolean {
  return flowRatio > 2;
}

// --- Pressure advance ------------------------------------------------------

/**
 * PA tower method: PA = start + step × height_mm
 * The tower increments PA by `step` every 1 mm of height.
 */
export function paTower(start: number, step: number, measuredHeightMm: number): CalcResult {
  const raw = start + step * measuredHeightMm;
  const warnings: string[] = [];
  if (measuredHeightMm < 0) warnings.push('Height cannot be negative.');
  if (raw > 2) warnings.push('PA above 2.0 is almost certainly wrong for any printer — re-check step and height.');
  return {
    inputs: { start, step, measuredHeightMm },
    formulaText: 'PA = PressureAdvanceStart + (PressureAdvanceStep × measured height in mm)',
    substituted: `${start} + (${step} × ${measuredHeightMm}) = ${raw.toFixed(4)}`,
    raw, rounded: roundTo(raw, 3), precision: 3, unit: '', warnings
  };
}

/**
 * PA line/pattern method: PA = start + step × sampleIndex.
 * `zeroBased`: whether the first printed line is sample 0 (value == start)
 * or sample 1. Orca's line test labels values directly; when the user counts
 * lines instead, indexing matters — so we make it explicit.
 */
export function paFromSample(start: number, step: number, sampleNumber: number, zeroBased: boolean): CalcResult {
  const idx = zeroBased ? sampleNumber : sampleNumber - 1;
  const raw = start + step * idx;
  const warnings: string[] = [];
  if (idx < 0) warnings.push('Sample number implies a negative index — with one-based numbering the first sample is 1.');
  if (raw > 2) warnings.push('PA above 2.0 is almost certainly a mistake.');
  return {
    inputs: { start, step, sampleNumber },
    formulaText: `PA = start + step × index  (index = sample${zeroBased ? '' : ' − 1'}, ${zeroBased ? 'zero' : 'one'}-based)`,
    substituted: `${start} + ${step} × ${idx} = ${raw.toFixed(4)}`,
    raw, rounded: roundTo(raw, 3), precision: 3, unit: '', warnings
  };
}

// --- Retraction ------------------------------------------------------------

/**
 * Retraction tower: length = start + step × (bestHeightMm / mmPerStep).
 * Orca's tower changes retraction once per section; sections are 1 mm of
 * height by default in the generated tower's gcode (`Calib_Retraction_tower`).
 */
export function retractionFromHeight(start: number, step: number, bestHeightMm: number, mmPerSection = 1): CalcResult {
  const sections = mmPerSection > 0 ? bestHeightMm / mmPerSection : NaN;
  const raw = start + step * sections;
  const warnings: string[] = [];
  if (!(mmPerSection > 0)) warnings.push('Section height must be positive.');
  if (raw > 10) warnings.push('Retraction above 10 mm risks clogs and heat creep even on Bowden systems.');
  return {
    inputs: { start, step, bestHeightMm, mmPerSection },
    formulaText: 'Retraction = start + step × (height ÷ section height)',
    substituted: `${start} + ${step} × (${bestHeightMm} ÷ ${mmPerSection}) = ${Number.isFinite(raw) ? raw.toFixed(3) : '—'}`,
    raw, rounded: roundTo(raw, 2), precision: 2, unit: 'mm', warnings
  };
}

// --- Max volumetric speed --------------------------------------------------

/**
 * Orca MVS test: measured max = start + step × height_mm
 * (the tower ramps volumetric speed continuously with height).
 */
export function mvsFromHeight(start: number, step: number, measuredHeightMm: number): CalcResult {
  const raw = start + step * measuredHeightMm;
  const warnings: string[] = [];
  if (measuredHeightMm < 0) warnings.push('Height cannot be negative.');
  return {
    inputs: { start, step, measuredHeightMm },
    formulaText: 'MeasuredMax = start + (measured height in mm × step)',
    substituted: `${start} + (${measuredHeightMm} × ${step}) = ${raw.toFixed(2)}`,
    raw, rounded: roundTo(raw, 1), precision: 1, unit: 'mm³/s', warnings
  };
}

/**
 * Production MVS = measured max × safety margin (default 0.85, i.e. keep
 * 15% headroom — the official wiki suggests reducing 10–20%).
 * Never exceeds printerLimit when one is configured.
 */
export function mvsProduction(measuredMax: number, safetyMargin: number, printerLimit?: number): CalcResult {
  const warnings: string[] = [];
  let margin = safetyMargin;
  if (!(margin > 0 && margin <= 1)) {
    warnings.push('Safety margin must be between 0 and 1 — using 0.85.');
    margin = 0.85;
  }
  let raw = measuredMax * margin;
  if (printerLimit !== undefined && printerLimit > 0 && raw > printerLimit) {
    warnings.push(`Capped at the printer profile's max volumetric flow (${printerLimit} mm³/s).`);
    raw = printerLimit;
  }
  if (margin > 0.95) warnings.push('Less than 5% headroom — expect failures on long prints or hot days.');
  return {
    inputs: { measuredMax, safetyMargin: margin, ...(printerLimit !== undefined ? { printerLimit } : {}) },
    formulaText: 'ProductionMVS = MeasuredMax × SafetyMargin (capped at printer limit)',
    substituted: `${measuredMax} × ${margin} = ${(measuredMax * margin).toFixed(2)}${printerLimit !== undefined && measuredMax * margin > printerLimit ? ` → capped to ${printerLimit}` : ''}`,
    raw, rounded: roundTo(raw, 1), precision: 1, unit: 'mm³/s', warnings
  };
}

/** Volumetric flow of a given print setting combination. */
export function volumetricFlow(layerHeight: number, lineWidth: number, speed: number): CalcResult {
  const raw = layerHeight * lineWidth * speed;
  const warnings: string[] = [];
  if (layerHeight <= 0 || lineWidth <= 0 || speed <= 0) warnings.push('All inputs must be positive.');
  return {
    inputs: { layerHeight, lineWidth, speed },
    formulaText: 'Volumetric Flow = Layer Height × Line Width × Print Speed',
    substituted: `${layerHeight} × ${lineWidth} × ${speed} = ${raw.toFixed(2)}`,
    raw, rounded: roundTo(raw, 2), precision: 2, unit: 'mm³/s', warnings
  };
}

/** Max speed printable at a given volumetric limit. */
export function maxSpeedForFlow(mvs: number, layerHeight: number, lineWidth: number): CalcResult {
  const denom = layerHeight * lineWidth;
  const warnings: string[] = [];
  let raw = 0;
  if (denom <= 0) {
    warnings.push('Layer height and line width must be positive (division by zero prevented).');
  } else {
    raw = mvs / denom;
  }
  return {
    inputs: { mvs, layerHeight, lineWidth },
    formulaText: 'Max Speed = MVS ÷ (Layer Height × Line Width)',
    substituted: denom > 0 ? `${mvs} ÷ (${layerHeight} × ${lineWidth}) = ${raw.toFixed(0)}` : 'undefined (zero denominator)',
    raw, rounded: roundTo(raw, 0), precision: 0, unit: 'mm/s', warnings
  };
}

// --- Temperature -----------------------------------------------------------

/**
 * Temp tower: temperature of a block = start − step × blockIndex when the
 * tower prints hottest-first (Orca towers go from start down to end).
 * zero-based block index.
 */
export function tempForBlock(startTemp: number, step: number, blockIndex: number, descending = true): CalcResult {
  const raw = descending ? startTemp - step * blockIndex : startTemp + step * blockIndex;
  return {
    inputs: { startTemp, step, blockIndex },
    formulaText: `BlockTemp = start ${descending ? '−' : '+'} step × blockIndex (first block = index 0)`,
    substituted: `${startTemp} ${descending ? '−' : '+'} ${step} × ${blockIndex} = ${raw}`,
    raw, rounded: Math.round(raw), precision: 0, unit: '°C', warnings: []
  };
}

// --- Range generation ------------------------------------------------------

export interface GeneratedRange {
  values: number[];
  count: number;
  warnings: string[];
}

/** Generate the sample values a test will produce. Handles ascending and descending ranges. */
export function generateRange(start: number, end: number, step: number, decimals = 3): GeneratedRange {
  const warnings: string[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step)) {
    return { values: [], count: 0, warnings: ['All range values must be numbers.'] };
  }
  if (step === 0) return { values: [], count: 0, warnings: ['Step cannot be zero.'] };
  const dir = end >= start ? 1 : -1;
  const s = Math.abs(step) * dir;
  const n = Math.floor(Math.abs(end - start) / Math.abs(step) + 1e-9) + 1;
  if (n > 200) {
    return { values: [], count: n, warnings: [`This range generates ${n} samples — far too many for one test. Increase the step or narrow the range.`] };
  }
  if (n < 2) warnings.push('This range produces fewer than 2 samples — nothing to compare. Widen the range or shrink the step.');
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(roundTo(start + s * i, decimals));
  return { values, count: values.length, warnings };
}

function fmtSigned(n: number, spaced = false): string {
  const sign = n >= 0 ? '+' : '−';
  const abs = Math.abs(n);
  return spaced ? `${sign} ${abs}` : `${sign}${abs}`;
}
