import { describe, expect, it } from 'vitest';
import { getAdapter } from '../../src/slicerIntegration/adapters';
import { buildPatchesFromProject, generateProfile } from '../../src/slicerIntegration/generator';
import { summarizeDiff, formatChange, fullJsonDiff } from '../../src/slicerIntegration/diff';
import { unacknowledgedWarnings, validateGeneratedProfile } from '../../src/slicerIntegration/validation';
import type { GeneratedFilamentProfile, ParsedFilamentProfile } from '../../src/slicerIntegration/types';
import type { CalibrationProject, PrinterProfile } from '../../src/types';
import { fixtureRaw } from './fixtures';

function parseFixture(file: string): ParsedFilamentProfile {
  const raw = fixtureRaw(file);
  return getAdapter('orca').parseProfile(
    { kind: 'detected', fileName: file, json: raw.json, infoText: raw.info, filePath: raw.path },
    raw
  )!;
}

function makeProject(finalsOverrides: Partial<CalibrationProject['finals']> = {}): CalibrationProject {
  const completed = { status: 'completed' as const, current: null, history: [] };
  return {
    id: 'proj-1', createdAt: '', updatedAt: '', calibrationDate: '',
    filament: { manufacturer: 'Elegoo', productLine: '', material: 'PLA', color: 'Grey', diameter: 1.75, startingProfile: '' },
    printerProfileId: 'pr', nozzleType: 'brass', slicer: { slicer: 'orca', version: '2.4.x' },
    notes: '', mode: 'expert',
    stepOrder: ['temperature', 'flow-pass1', 'flow-pass2', 'pressure-advance', 'retraction', 'max-volumetric-speed', 'final-verification'],
    steps: {
      'temperature': { ...completed }, 'flow-pass1': { ...completed }, 'flow-pass2': { ...completed },
      'pressure-advance': { ...completed }, 'retraction': { ...completed },
      'max-volumetric-speed': { ...completed }, 'final-verification': { ...completed }
    },
    timeline: [], archived: false,
    finals: { nozzleTemp: 215, flowRatio: 1.02, pressureAdvance: 0.04, retractionDistance: 0.9, maxVolumetricSpeed: 18, ...finalsOverrides }
  };
}

const printer: PrinterProfile = {
  id: 'pr', name: 'Elegoo Giga', manufacturer: 'Elegoo', nozzleDiameter: 0.4,
  maxNozzleTemp: 300, maxBedTemp: 100, maxVolumetricFlow: 20, extruderType: 'direct',
  retractionRange: { start: 0.5, end: 2 }, notes: '', createdAt: '', updatedAt: ''
};

function generate(project = makeProject()): { generated: GeneratedFilamentProfile; parsed: ParsedFilamentProfile } {
  const parsed = parseFixture('orca-user-delta-pla.json');
  const generated = generateProfile({
    slicerId: 'orca', baseProfile: parsed.profile, newName: 'PF Valid Test',
    patches: buildPatchesFromProject(project), targetExtruderIndex: 0,
    applyToAllExtruders: false, project
  }, parsed);
  return { generated, parsed };
}

describe('validation', () => {
  it('passes a clean generation', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.preservedFieldCount).toBeGreaterThan(5);
  });

  it('blocks nozzle temperature above the printer maximum without clamping', () => {
    const project = makeProject({ nozzleTemp: 320 });
    const { generated, parsed } = generate(project);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.valid).toBe(false);
    const e = result.errors.find(x => x.code === 'TEMP_OVER_PRINTER_MAX');
    expect(e?.message).toContain('320');
    expect(e?.message).toContain('300');
    // The value itself must NOT be clamped:
    expect((generated.data.nozzle_temperature as string[])[0]).toBe('320');
  });

  it('requires acknowledgement when MVS exceeds the printer capability', () => {
    const project = makeProject({ maxVolumetricSpeed: 25 });
    const { generated, parsed } = generate(project);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.valid).toBe(true);
    const pending = unacknowledgedWarnings(result, []);
    expect(pending.some(w => w.code === 'MVS_OVER_PRINTER')).toBe(true);
    expect(unacknowledgedWarnings(result, ['MVS_OVER_PRINTER']).some(w => w.code === 'MVS_OVER_PRINTER')).toBe(false);
  });

  it('detects field loss (round-trip preservation)', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    delete (generated.data as Record<string, unknown>).filament_density;
    generated.serialized = JSON.stringify(generated.data, null, 4);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors.some(e => e.code === 'FIELD_LOST' && e.message.includes('filament_density'))).toBe(true);
  });

  it('detects unexpected drift beyond calibrated fields', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    (generated.data as Record<string, unknown>).slow_down_layer_time = ['99'];
    generated.serialized = JSON.stringify(generated.data, null, 4);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors.some(e => e.code === 'UNEXPECTED_CHANGE')).toBe(true);
  });

  it('detects version drift', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    (generated.data as Record<string, unknown>).version = '999';
    generated.serialized = JSON.stringify(generated.data, null, 4);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors.some(e => e.code === 'VERSION_DRIFT')).toBe(true);
  });

  it('blocks a clone without its own filament_id (Bambu hides those)', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    delete (generated.data as Record<string, unknown>).filament_id;
    generated.serialized = JSON.stringify(generated.data, null, 4);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors.some(e => e.code === 'FILAMENT_ID_MISSING')).toBe(true);
  });

  it('blocks a clone whose filament_id collides with the base', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    const baseRaw = parsed.profile.rawProfile as Record<string, unknown>;
    if (typeof baseRaw.filament_id === 'string' && baseRaw.filament_id) {
      (generated.data as Record<string, unknown>).filament_id = baseRaw.filament_id;
      generated.serialized = JSON.stringify(generated.data, null, 4);
      const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
      expect(result.errors.some(e => e.code === 'FILAMENT_ID_COLLISION')).toBe(true);
    }
  });

  it('requires a system-base clone to inherit the leaf by name', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    parsed.profile.sourceType = 'system';
    // generator would have set inherits to the leaf name; simulate the old
    // (buggy) behavior of keeping the abstract parent
    (generated.data as Record<string, unknown>).inherits = 'Generic PLA @base';
    generated.serialized = JSON.stringify(generated.data, null, 4);
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.errors.some(e => e.code === 'INHERITS_DRIFT')).toBe(true);
  });

  it('warns about duplicate names at the destination', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    const result = validateGeneratedProfile(generated, {
      project, printer, baseProfile: parsed.profile,
      existingProfileNames: ['pf valid test']
    });
    expect(result.warnings.some(w => w.code === 'DUPLICATE_NAME')).toBe(true);
  });

  it('requires acknowledgement for cross-family base profiles', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    parsed.profile.materialType = 'TPU';
    const result = validateGeneratedProfile(generated, { project, printer, baseProfile: parsed.profile });
    expect(result.warnings.some(w => w.code === 'MATERIAL_FAMILY_MISMATCH' && w.requiresAcknowledgement)).toBe(true);
  });
});

describe('diff', () => {
  it('never reports unchanged fields and splits identity from calibration', () => {
    const project = makeProject();
    const { generated, parsed } = generate(project);
    const diff = summarizeDiff(parsed.profile.rawProfile as Record<string, unknown>, generated);
    expect(diff.unexpected).toEqual([]);
    expect(diff.identity.map(i => i.key)).toContain('name');
    expect(diff.calibrated.map(c => c.presetKey)).toContain('nozzle_temperature');
    // fields not touched must not appear anywhere
    const allKeys = [...diff.identity, ...diff.unexpected].map(e => e.key);
    expect(allKeys).not.toContain('filament_density');
  });

  it('formats changes with printer-default sentinel for nil', () => {
    expect(formatChange({ presetKey: 'filament_retraction_length', label: 'Retraction length', before: 'nil', after: '0.9', unit: 'mm' }))
      .toBe('Retraction length: (printer default) → 0.9 mm');
    expect(formatChange({ presetKey: 'nozzle_temperature', label: 'Nozzle temperature', before: '220', after: '215', unit: '°C', extruderIndex: 1 }))
      .toBe('Nozzle temperature (slot 2): 220 °C → 215 °C');
  });

  it('fullJsonDiff reports added/removed/changed only', () => {
    const d = fullJsonDiff({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(d).toEqual([
      { key: 'b', kind: 'changed', before: '2', after: '9' },
      { key: 'c', kind: 'removed', before: '3', after: null },
      { key: 'd', kind: 'added', before: null, after: '4' }
    ]);
  });
});
