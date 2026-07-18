import { describe, it, expect } from 'vitest';
import { validateNumber, validateTestRange, validateAgainstPrinter, validateFlowRatio } from '../src/logic/validation';
import type { PrinterProfile } from '../src/types';

const printer: PrinterProfile = {
  id: 'p1', name: 'Test', manufacturer: 'T', nozzleDiameter: 0.4,
  maxNozzleTemp: 300, maxBedTemp: 110, maxVolumetricFlow: 20,
  extruderType: 'direct', retractionRange: { start: 0, end: 2 },
  notes: '', createdAt: '', updatedAt: ''
};

describe('validateNumber', () => {
  it('rejects non-numeric and out-of-range values', () => {
    expect(validateNumber('abc', { label: 'X' })[0].level).toBe('error');
    expect(validateNumber(5, { label: 'X', min: 10 })[0].level).toBe('error');
    expect(validateNumber(5, { label: 'X', max: 4 })[0].level).toBe('error');
    expect(validateNumber('', { label: 'X' })[0].message).toContain('required');
    expect(validateNumber('', { label: 'X', required: false })).toHaveLength(0);
  });

  it('enforces integers when asked', () => {
    expect(validateNumber(1.5, { label: 'X', integer: true })[0].level).toBe('error');
    expect(validateNumber(2, { label: 'X', integer: true })).toHaveLength(0);
  });
});

describe('validateTestRange', () => {
  it('rejects zero step (division by zero)', () => {
    expect(validateTestRange(0, 2, 0).some(i => i.level === 'error')).toBe(true);
  });
  it('rejects equal start and end', () => {
    expect(validateTestRange(5, 5, 1).some(i => i.level === 'error')).toBe(true);
  });
  it('rejects impossible sample counts', () => {
    expect(validateTestRange(0, 100, 0.001).some(i => i.level === 'error')).toBe(true);
  });
  it('accepts sensible ranges', () => {
    expect(validateTestRange(0, 2, 0.1).filter(i => i.level === 'error')).toHaveLength(0);
  });
});

describe('validateAgainstPrinter', () => {
  it('blocks temps above printer max', () => {
    expect(validateAgainstPrinter('nozzleTemp', 320, printer)[0].level).toBe('error');
    expect(validateAgainstPrinter('nozzleTemp', 250, printer)).toHaveLength(0);
  });
  it('warns above printer max flow', () => {
    expect(validateAgainstPrinter('mvs', 25, printer)[0].level).toBe('warning');
  });
  it('no printer → no issues', () => {
    expect(validateAgainstPrinter('nozzleTemp', 500, undefined)).toHaveLength(0);
  });
});

describe('validateFlowRatio', () => {
  it('rejects percentages entered as decimals', () => {
    const issues = validateFlowRatio(98);
    expect(issues[0].level).toBe('error');
    expect(issues[0].message).toContain('0.98');
  });
  it('warns on unusual but possible values', () => {
    expect(validateFlowRatio(1.31)[0].level).toBe('warning');
  });
  it('accepts normal values', () => {
    expect(validateFlowRatio(0.98)).toHaveLength(0);
  });
});
