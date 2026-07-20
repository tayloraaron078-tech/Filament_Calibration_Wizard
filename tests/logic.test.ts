import { describe, it, expect } from 'vitest';
import { confidenceScore } from '../src/logic/confidence';
import { recommendationsForProject } from '../src/logic/recommendations';
import { suggestPaRange, suggestRetractionRange, suggestTempRange, suggestFlowMethodDefaults } from '../src/logic/ranges';
import { getMaterial } from '../src/data/materials';
import { DEFAULT_ORDER, CALIBRATIONS } from '../src/data/calibrations';
import { getSlicerContent } from '../src/data/slicers';
import type { CalibrationProject, CalibrationId, CalibrationStepState, PrinterProfile } from '../src/types';

function baseProject(): CalibrationProject {
  const steps = {} as Record<CalibrationId, CalibrationStepState>;
  for (const id of DEFAULT_ORDER) steps[id] = { status: 'not-started', current: null, history: [] };
  return {
    id: 'p', createdAt: '', updatedAt: '', calibrationDate: '2026-07-18',
    filament: { manufacturer: 'M', productLine: '', material: 'PLA', color: '', diameter: 1.75, startingProfile: '' },
    printerProfileId: 'pr', nozzleType: 'brass',
    slicer: { slicer: 'orca', version: '2.4.x' },
    notes: '', mode: 'coach', stepOrder: [...DEFAULT_ORDER], steps,
    timeline: [], archived: false, finals: {}
  };
}

function complete(p: CalibrationProject, id: CalibrationId, conf: 'low' | 'medium' | 'high' = 'high',
  extras: Partial<NonNullable<CalibrationStepState['current']>> = {}): void {
  p.steps[id] = {
    status: 'completed',
    current: {
      id: 'a', startedAt: '2026-07-18T00:00:00Z', settings: {}, result: {}, computed: {},
      prerequisitesConfirmed: [], notes: '', photoIds: [], confidence: conf, ...extras
    },
    history: [], confidence: conf
  };
}

describe('confidence score', () => {
  it('is 0 for an empty project and 100 when everything is done at high confidence', () => {
    const p = baseProject();
    expect(confidenceScore(p).score).toBe(0);
    for (const id of DEFAULT_ORDER) complete(p, id, 'high');
    expect(confidenceScore(p).score).toBe(100);
  });

  it('low-confidence and retest-flagged results earn less', () => {
    const a = baseProject(); complete(a, 'temperature', 'high');
    const b = baseProject(); complete(b, 'temperature', 'low');
    expect(confidenceScore(b).score).toBeLessThan(confidenceScore(a).score);
    const c = baseProject(); complete(c, 'temperature', 'high');
    c.steps.temperature.retestRecommended = true;
    expect(confidenceScore(c).score).toBeLessThan(confidenceScore(a).score);
  });

  it('skipped steps contribute nothing', () => {
    const p = baseProject();
    p.steps.retraction.status = 'skipped';
    expect(confidenceScore(p).parts.find(x => x.step === 'retraction')!.earned).toBe(0);
  });
});

describe('smart recommendations', () => {
  it('persistent stringing at max retraction → revisit temperature', () => {
    const p = baseProject();
    complete(p, 'retraction', 'medium', { result: { stillStringyAtMax: true } });
    const recs = recommendationsForProject(p);
    expect(recs.some(r => r.targetStep === 'temperature')).toBe(true);
  });

  it('temperature chosen at range edge → suggest retest', () => {
    const p = baseProject();
    complete(p, 'temperature', 'medium', {
      settings: { start: 230, end: 210, step: 5 },
      computed: { normalTemp: 230 }
    });
    const recs = recommendationsForProject(p);
    expect(recs.some(r => r.targetStep === 'temperature' && r.reason.includes('edge'))).toBe(true);
  });

  it('failed verification categories produce ranked causes', () => {
    const p = baseProject();
    complete(p, 'final-verification', 'medium', {
      result: { 'cat-corners': 'needs-adjustment' }
    });
    const recs = recommendationsForProject(p);
    expect(recs[0].targetStep).toBe('pressure-advance'); // top-ranked cause for corners
  });

  it('extreme pass-2 modifier → re-run pass 1', () => {
    const p = baseProject();
    complete(p, 'flow-pass2', 'medium', { result: { modifier: -9 } });
    expect(recommendationsForProject(p).some(r => r.targetStep === 'flow-pass1')).toBe(true);
  });
});

describe('range suggestions', () => {
  const printer: PrinterProfile = {
    id: 'x', name: 'X', manufacturer: '', nozzleDiameter: 0.4,
    maxNozzleTemp: 260, maxBedTemp: 100, extruderType: 'direct',
    retractionRange: { start: 0, end: 2 }, notes: '', createdAt: '', updatedAt: ''
  };

  it('temp range is clamped to printer max with a warning', () => {
    const s = suggestTempRange('PC', printer); // PC wants up to 310
    expect(s.start).toBeLessThanOrEqual(260);
    expect(s.warnings.length).toBeGreaterThan(0);
  });

  it('PA ranges differ by extruder and flexibility', () => {
    const dd = suggestPaRange('direct', getMaterial('PLA'));
    const bowden = suggestPaRange('bowden', getMaterial('PLA'));
    const flex = suggestPaRange('direct', getMaterial('TPU'));
    expect(bowden.end).toBeGreaterThan(dd.end);
    expect(flex.end).toBeGreaterThan(dd.end);
  });

  it('retraction suggestions respect flexible filament', () => {
    const s = suggestRetractionRange('direct', getMaterial('TPU'));
    expect(s.end).toBeLessThanOrEqual(2);
    expect(s.warnings.join(' ')).toMatch(/jam|flexible/i);
  });

  it('flow method modifiers match slicer behavior', () => {
    expect(suggestFlowMethodDefaults('yolo').modifiers).toHaveLength(11);   // eleven blocks
    expect(suggestFlowMethodDefaults('pass1').modifiers).toHaveLength(9);   // nine blocks
    expect(suggestFlowMethodDefaults('pass2').modifiers).toEqual([-9, -8, -7, -6, -5, -4, -3, -2, -1, 0]);
  });
});

describe('calibration definitions integrity', () => {
  it('every step in the default order has a definition with required fields', () => {
    for (const id of DEFAULT_ORDER) {
      const def = CALIBRATIONS[id];
      expect(def).toBeDefined();
      expect(def.purpose.length).toBeGreaterThan(20);
      expect(def.methods.length).toBeGreaterThan(0);
      expect(def.slicerDestination.note.length).toBeGreaterThan(0);
    }
  });

  it('dependencies only reference earlier steps in the default order', () => {
    for (const id of DEFAULT_ORDER) {
      const def = CALIBRATIONS[id];
      for (const dep of def.dependencies) {
        expect(DEFAULT_ORDER.indexOf(dep)).toBeLessThan(DEFAULT_ORDER.indexOf(id));
      }
    }
  });

  it('Bambu Studio Developer mode guidance covers all affected coached steps', () => {
    const bambu = getSlicerContent('bambu', '1.7+');
    expect(bambu.calibrationMenuPath).toMatch(/Developer mode/i);

    const developerModeSteps: CalibrationId[] = [
      'temperature',
      'flow-pass1',
      'flow-pass2',
      'pressure-advance',
      'retraction',
      'max-volumetric-speed'
    ];

    for (const id of developerModeSteps) {
      const instructions = bambu.perTest[id];
      expect(instructions, id).toBeDefined();
      expect(instructions?.available, id).toBe(true);
      expect(instructions?.builtIn, id).toBe(true);
      const text = [
        instructions?.menuPath,
        ...(instructions?.steps ?? []),
        ...(instructions?.gotchas ?? [])
      ].join(' ');
      expect(text, id).toMatch(/Developer mode/i);
      expect(text, id).toMatch(/non–Bambu-Lab printer profile/i);
    }
  });

  it('Bambu Studio flow guidance distinguishes coarse/fine from Orca YOLO and notes VFA exposure', () => {
    const bambu = getSlicerContent('bambu', '1.7+');
    const flowText = [
      ...(bambu.perTest['flow-pass1']?.steps ?? []),
      ...(bambu.perTest['flow-pass2']?.steps ?? [])
    ].join(' ');
    expect(flowText).toMatch(/coarse/i);
    expect(flowText).toMatch(/fine/i);
    expect(flowText).toMatch(/no YOLO/i);

    const maxFlowText = [
      ...(bambu.perTest['max-volumetric-speed']?.steps ?? []),
      ...(bambu.perTest['max-volumetric-speed']?.gotchas ?? [])
    ].join(' ');
    expect(maxFlowText).toMatch(/Max Flow Rate/i);
    expect(maxFlowText).toMatch(/VFA/i);
  });

});
