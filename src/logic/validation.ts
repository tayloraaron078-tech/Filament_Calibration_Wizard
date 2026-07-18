import type { PrinterProfile } from '../types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateNumber(value: unknown, opts: {
  label: string; min?: number; max?: number; integer?: boolean; required?: boolean;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { label, min, max, integer, required = true } = opts;
  if (value === '' || value === null || value === undefined) {
    if (required) issues.push({ level: 'error', message: `${label} is required.` });
    return issues;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    issues.push({ level: 'error', message: `${label} must be a number.` });
    return issues;
  }
  if (integer && !Number.isInteger(n)) issues.push({ level: 'error', message: `${label} must be a whole number.` });
  if (min !== undefined && n < min) issues.push({ level: 'error', message: `${label} must be at least ${min}.` });
  if (max !== undefined && n > max) issues.push({ level: 'error', message: `${label} must be at most ${max}.` });
  return issues;
}

export function validateTestRange(start: number, end: number, step: number, opts?: { maxSamples?: number; label?: string }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const label = opts?.label ?? 'Range';
  if (![start, end, step].every(Number.isFinite)) {
    issues.push({ level: 'error', message: `${label}: start, end and step must all be numbers.` });
    return issues;
  }
  if (step === 0) { issues.push({ level: 'error', message: `${label}: step cannot be zero (division by zero).` }); return issues; }
  if (step < 0) issues.push({ level: 'error', message: `${label}: enter the step as a positive number; direction comes from start/end.` });
  if (start === end) issues.push({ level: 'error', message: `${label}: start and end are equal — there is nothing to test.` });
  const samples = Math.floor(Math.abs(end - start) / Math.abs(step)) + 1;
  const maxSamples = opts?.maxSamples ?? 100;
  if (samples > maxSamples) issues.push({ level: 'error', message: `${label}: ${samples} samples is too many for one print. Increase the step or narrow the range.` });
  else if (samples < 3) issues.push({ level: 'warning', message: `${label}: only ${samples} samples — consider a wider range or smaller step for a meaningful comparison.` });
  return issues;
}

export function validateAgainstPrinter(kind: 'nozzleTemp' | 'bedTemp' | 'mvs', value: number, printer: PrinterProfile | undefined): ValidationIssue[] {
  if (!printer) return [];
  const issues: ValidationIssue[] = [];
  if (kind === 'nozzleTemp' && value > printer.maxNozzleTemp) {
    issues.push({ level: 'error', message: `${value} °C exceeds this printer's max nozzle temperature (${printer.maxNozzleTemp} °C). Printing hotter than the rating can destroy the hotend or release fumes.` });
  }
  if (kind === 'bedTemp' && value > printer.maxBedTemp) {
    issues.push({ level: 'error', message: `${value} °C exceeds this printer's max bed temperature (${printer.maxBedTemp} °C).` });
  }
  if (kind === 'mvs' && printer.maxVolumetricFlow && printer.maxVolumetricFlow > 0 && value > printer.maxVolumetricFlow) {
    issues.push({ level: 'warning', message: `${value} mm³/s is above the printer profile's rated max flow (${printer.maxVolumetricFlow} mm³/s). The app will not recommend a final value above the printer's limit.` });
  }
  return issues;
}

/** Flow ratio sanity: decimal near 1, never a percentage. */
export function validateFlowRatio(value: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isFinite(value) || value <= 0) {
    issues.push({ level: 'error', message: 'Flow ratio must be a positive number.' });
  } else if (value > 2) {
    issues.push({ level: 'error', message: `${value} looks like a percentage. Orca and Bambu Studio use a decimal — enter ${(value / 100).toFixed(2)} instead of ${value}.` });
  } else if (value < 0.7 || value > 1.3) {
    issues.push({ level: 'warning', message: 'Flow ratios outside 0.70–1.30 are very unusual — double-check the value.' });
  }
  return issues;
}
