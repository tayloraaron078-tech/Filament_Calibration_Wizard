import type { CalibrationId, ExtruderType, MaterialPreset, PrinterProfile } from '../types';
import { getMaterial } from '../data/materials';

/**
 * Suggested default test ranges, derived from material preset + printer
 * profile + extruder type. Always editable; validated against printer limits.
 */

export interface RangeSuggestion {
  start: number;
  end: number;
  step: number;
  warnings: string[];
}

export function suggestTempRange(materialId: string, printer?: PrinterProfile): RangeSuggestion {
  const m = getMaterial(materialId);
  let { start, end, step } = m.towerRange;
  const warnings: string[] = [];
  if (printer && start > printer.maxNozzleTemp) {
    warnings.push(`The suggested start (${start} °C) exceeds this printer's max nozzle temperature (${printer.maxNozzleTemp} °C). Clamped — but verify this material is printable on this machine at all.`);
    start = printer.maxNozzleTemp;
    if (end > start - 15) end = Math.max(end, start - 20);
  }
  return { start, end, step, warnings };
}

export function suggestPaRange(extruder: ExtruderType, material: MaterialPreset, highFlow = false): RangeSuggestion {
  // Klipper-style ballparks; all editable. Flexible filaments need much more PA.
  if (material.flexible) {
    return { start: 0, end: 0.2, step: 0.005, warnings: ['Flexible filaments (TPU) often need noticeably higher PA than rigid ones and respond less predictably — expect a wider usable band.'] };
  }
  if (extruder === 'bowden') {
    return { start: 0, end: 1.0, step: 0.02, warnings: ['Bowden systems need much larger PA values; the transition is also less sharp.'] };
  }
  if (highFlow) {
    return { start: 0, end: 0.08, step: 0.002, warnings: ['High-flow hotends usually land at lower PA than standard hotends of the same type.'] };
  }
  return { start: 0, end: 0.1, step: 0.002, warnings: [] };
}

export function suggestRetractionRange(extruder: ExtruderType, material: MaterialPreset, printer?: PrinterProfile): RangeSuggestion {
  const warnings: string[] = [];
  let s: RangeSuggestion;
  if (material.flexible) {
    s = { start: 0, end: 1.5, step: 0.1, warnings: ['Keep retraction minimal for flexible filament — long retractions jam extruders. If using Bowden with TPU, consider not calibrating past ~2 mm at all.'] };
  } else if (extruder === 'bowden') {
    s = { start: 1, end: 6, step: 0.2, warnings: [] };
  } else {
    s = { start: 0, end: 2, step: 0.1, warnings: [] };
  }
  if (printer && printer.retractionRange && printer.retractionRange.end > 0) {
    s.start = printer.retractionRange.start;
    s.end = printer.retractionRange.end;
    warnings.push('Using the starting range saved in the printer profile.');
  }
  s.warnings.push(...warnings);
  return s;
}

export function suggestMvsRange(materialId: string, printer?: PrinterProfile): RangeSuggestion {
  const m = getMaterial(materialId);
  let { start, end, step } = m.mvsRange;
  const warnings: string[] = [];
  if (printer?.maxVolumetricFlow && printer.maxVolumetricFlow > 0 && end > printer.maxVolumetricFlow * 1.25) {
    warnings.push(`Test end reduced toward the printer's rated max flow (${printer.maxVolumetricFlow} mm³/s) — testing far beyond the machine's rating mostly measures the machine, not the filament.`);
    end = Math.max(start + 2, Math.round(printer.maxVolumetricFlow * 1.25));
  }
  return { start, end, step, warnings };
}

export function suggestFlowMethodDefaults(method: string): { modifiers: number[] } {
  switch (method) {
    case 'yolo': return { modifiers: [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.05] };
    case 'yolo-perfectionist': return { modifiers: [-0.04, -0.035, -0.03, -0.025, -0.02, -0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035] };
    case 'pass1': return { modifiers: [-20, -15, -10, -5, 0, 5, 10, 15, 20] };
    case 'pass2': return { modifiers: [-9, -8, -7, -6, -5, -4, -3, -2, -1, 0] };
    default: return { modifiers: [] };
  }
}

export const STEP_DEPENDENCY_WARNINGS: Partial<Record<CalibrationId, string>> = {
  'flow-pass1': 'Flow results are only trustworthy after temperature is calibrated.',
  'flow-pass2': 'Pass 2 requires the Pass 1 (or YOLO) result saved in the profile.',
  'pressure-advance': 'Pressure Advance is judged by line width — calibrate flow first.',
  retraction: 'Stringing depends on temperature and pressure — calibrate those first.',
  'max-volumetric-speed': 'Max flow depends strongly on temperature — calibrate it first.',
  'final-verification': 'Verification is only meaningful after the other calibrations.'
};
