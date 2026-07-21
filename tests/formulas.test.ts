import { describe, it, expect } from 'vitest';
import {
  flowYolo, flowPercent, looksLikePercentage, paTower, paFromSample,
  retractionFromHeight, mvsFromHeight, mvsProduction, volumetricFlow,
  maxSpeedForFlow, tempForBlock, generateRange, roundTo,
  shrinkageFromMeasurement, shrinkageCombined
} from '../src/logic/formulas';

describe('flow ratio formulas (official Orca wiki examples)', () => {
  it('YOLO: 0.98 with +0.01 modifier → 0.99 (wiki example)', () => {
    const r = flowYolo(0.98, 0.01);
    expect(r.rounded).toBe(0.99);
    expect(r.warnings).toHaveLength(0);
  });

  it('Pass 1: 0.98 with +5% → 1.029 (wiki example)', () => {
    const r = flowPercent(0.98, 5);
    expect(r.raw).toBeCloseTo(1.029, 6);
    expect(r.rounded).toBe(1.029);
  });

  it('Pass 2: 1.029 with −6% → 0.96726 → rounds to 0.967 (wiki example)', () => {
    const r = flowPercent(1.029, -6);
    expect(r.raw).toBeCloseTo(0.96726, 6);
    expect(r.rounded).toBe(0.967);
  });

  it('flags percentage-style input (98 instead of 0.98)', () => {
    expect(looksLikePercentage(98)).toBe(true);
    expect(looksLikePercentage(0.98)).toBe(false);
    const r = flowPercent(98, 5);
    expect(r.warnings.some(w => w.includes('percentage'))).toBe(true);
  });

  it('warns on implausible results', () => {
    const r = flowYolo(1.28, 0.05);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('pressure advance formulas', () => {
  it('tower: start 0, step 0.002, height 8 → 0.016 (wiki example)', () => {
    const r = paTower(0, 0.002, 8);
    expect(r.rounded).toBe(0.016);
  });

  it('tower with nonzero start', () => {
    expect(paTower(0.01, 0.005, 4).rounded).toBe(0.03);
  });

  it('sample numbering: zero-based sample 0 equals start', () => {
    expect(paFromSample(0, 0.002, 0, true).rounded).toBe(0);
  });

  it('sample numbering: one-based sample 1 equals start', () => {
    expect(paFromSample(0, 0.002, 1, false).rounded).toBe(0);
  });

  it('one-based vs zero-based differ by exactly one step', () => {
    const zero = paFromSample(0, 0.002, 9, true).raw;
    const one = paFromSample(0, 0.002, 9, false).raw;
    expect(zero - one).toBeCloseTo(0.002, 9);
  });

  it('warns on negative index (one-based sample 0)', () => {
    const r = paFromSample(0, 0.002, 0, false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('retraction formulas', () => {
  it('tower: start 0, step 0.1, clean at 10 mm → 1.0 mm', () => {
    expect(retractionFromHeight(0, 0.1, 10).rounded).toBe(1);
  });

  it('bowden defaults: start 1, step 0.2, height 15 → 4 mm', () => {
    expect(retractionFromHeight(1, 0.2, 15).rounded).toBe(4);
  });

  it('prevents division by zero section height', () => {
    const r = retractionFromHeight(0, 0.1, 10, 0);
    expect(r.warnings.some(w => w.toLowerCase().includes('positive'))).toBe(true);
    expect(Number.isFinite(r.raw)).toBe(false);
  });

  it('warns above 10 mm', () => {
    expect(retractionFromHeight(1, 0.2, 60).warnings.length).toBeGreaterThan(0);
  });
});

describe('max volumetric speed formulas', () => {
  it('wiki example: 5 + 19 × 0.5 = 14.5 mm³/s', () => {
    expect(mvsFromHeight(5, 0.5, 19).rounded).toBe(14.5);
  });

  it('production value applies safety margin', () => {
    const r = mvsProduction(14.5, 0.85);
    expect(r.rounded).toBeCloseTo(12.3, 1);
  });

  it('production value is capped at the printer limit', () => {
    const r = mvsProduction(30, 0.9, 20);
    expect(r.rounded).toBe(20);
    expect(r.warnings.some(w => w.includes('Capped'))).toBe(true);
  });

  it('invalid margin falls back to 0.85 with warning', () => {
    const r = mvsProduction(10, 1.5);
    expect(r.inputs.safetyMargin).toBe(0.85);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('volumetric flow: 0.2 × 0.42 × 300 = 25.2 mm³/s', () => {
    expect(volumetricFlow(0.2, 0.42, 300).rounded).toBe(25.2);
  });

  it('max speed for flow guards division by zero', () => {
    const r = maxSpeedForFlow(12, 0, 0.42);
    expect(r.warnings.some(w => w.includes('zero'))).toBe(true);
    expect(r.rounded).toBe(0);
  });

  it('max speed: 12 mm³/s at 0.2×0.4 → 150 mm/s', () => {
    expect(maxSpeedForFlow(12, 0.2, 0.4).rounded).toBe(150);
  });
});

describe('temperature tower', () => {
  it('descending tower: block 0 = start, block 3 = start − 3×step', () => {
    expect(tempForBlock(230, 5, 0).rounded).toBe(230);
    expect(tempForBlock(230, 5, 3).rounded).toBe(215);
  });
});

describe('range generation', () => {
  it('ascending range inclusive of both ends', () => {
    const r = generateRange(0, 2, 0.5);
    expect(r.values).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(r.count).toBe(5);
  });

  it('descending range (temp towers)', () => {
    const r = generateRange(230, 210, 5, 0);
    expect(r.values).toEqual([230, 225, 220, 215, 210]);
  });

  it('handles floating point steps without drift', () => {
    const r = generateRange(0, 0.1, 0.002, 4);
    expect(r.count).toBe(51);
    expect(r.values[50]).toBe(0.1);
  });

  it('zero step rejected', () => {
    const r = generateRange(0, 2, 0);
    expect(r.values).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('absurd sample counts rejected', () => {
    const r = generateRange(0, 1000, 0.1);
    expect(r.values).toEqual([]);
    expect(r.warnings[0]).toContain('too many');
  });
});

describe('rounding', () => {
  it('roundTo handles typical float noise', () => {
    expect(roundTo(0.1 + 0.2, 2)).toBe(0.3);
    expect(roundTo(1.0295, 3)).toBe(1.03);
  });
});

describe('shrinkage formulas', () => {
  it('measured 99.4 on nominal 100 → 99.4% (slicer field semantics)', () => {
    const r = shrinkageFromMeasurement(100, 99.4);
    expect(r.rounded).toBe(99.4);
    expect(r.unit).toBe('%');
    expect(r.warnings).toHaveLength(0);
  });

  it('non-100 nominal sizes work', () => {
    const r = shrinkageFromMeasurement(150, 148.8);
    expect(r.rounded).toBe(99.2);
  });

  it('expansion beyond 0.5% warns about over-extrusion/elephant foot', () => {
    const r = shrinkageFromMeasurement(100, 100.8);
    expect(r.warnings.some(w => w.includes('over-extrusion'))).toBe(true);
  });

  it('extreme shrinkage warns to re-measure', () => {
    const r = shrinkageFromMeasurement(100, 96);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('invalid inputs rejected without NaN output', () => {
    const r = shrinkageFromMeasurement(0, 99);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.rounded)).toBe(true);
  });

  it('combined X/Y averages the two axes', () => {
    const r = shrinkageCombined(99.4, 99.2);
    expect(r.rounded).toBe(99.3);
    expect(r.warnings).toHaveLength(0);
  });

  it('X/Y disagreement beyond 0.5% flags printer mechanics', () => {
    const r = shrinkageCombined(99.9, 99.1);
    expect(r.warnings.some(w => w.includes('mechanics'))).toBe(true);
  });
});
