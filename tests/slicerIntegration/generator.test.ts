import { describe, expect, it } from 'vitest';
import { getAdapter } from '../../src/slicerIntegration/adapters';
import { buildPatchesFromProject, generateProfile } from '../../src/slicerIntegration/generator';
import type { ParsedFilamentProfile } from '../../src/slicerIntegration/types';
import type { CalibrationProject } from '../../src/types';
import { fixtureRaw, USER_FIXTURES } from './fixtures';

function parseFixture(file: string, slicer: Parameters<typeof getAdapter>[0]): ParsedFilamentProfile {
  const adapter = getAdapter(slicer);
  const raw = fixtureRaw(file);
  const parsed = adapter.parseProfile(
    { kind: 'detected', fileName: file, json: raw.json, infoText: raw.info, filePath: raw.path },
    raw
  );
  if (!parsed) throw new Error(`fixture did not parse: ${file}`);
  return parsed;
}

function makeProject(overrides: Partial<CalibrationProject['finals']> = {}): CalibrationProject {
  const finals = {
    nozzleTemp: 235,
    flowRatio: 0.97,
    pressureAdvance: 0.035,
    retractionDistance: 0.8,
    maxVolumetricSpeed: 15,
    ...overrides
  };
  const completed = { status: 'completed' as const, current: null, history: [] };
  return {
    id: 'proj-1', createdAt: '', updatedAt: '', calibrationDate: '2026-07-19',
    filament: {
      manufacturer: 'Overture', productLine: '', material: 'PETG',
      color: 'Black', diameter: 1.75, startingProfile: 'Generic PETG'
    },
    printerProfileId: 'printer-1', nozzleType: 'brass',
    slicer: { slicer: 'orca', version: '2.4.x' }, notes: '', mode: 'expert',
    stepOrder: ['temperature', 'flow-pass1', 'flow-pass2', 'pressure-advance', 'retraction', 'max-volumetric-speed', 'final-verification'],
    steps: {
      'temperature': { ...completed },
      'flow-pass1': { ...completed },
      'flow-pass2': { ...completed },
      'pressure-advance': { ...completed },
      'retraction': { ...completed },
      'max-volumetric-speed': { ...completed },
      'final-verification': { ...completed }
    },
    timeline: [], archived: false, finals
  };
}

describe('buildPatchesFromProject', () => {
  it('only patches values backed by completed steps', () => {
    const project = makeProject();
    project.steps['pressure-advance'].status = 'skipped';
    const patches = buildPatchesFromProject(project);
    expect(patches.map(p => p.presetKey)).not.toContain('pressure_advance');
    expect(patches.map(p => p.presetKey)).toContain('nozzle_temperature');
  });

  it('never patches retraction speed unless it was calibrated', () => {
    const patches = buildPatchesFromProject(makeProject());
    expect(patches.map(p => p.presetKey)).not.toContain('filament_retraction_speed');
    const withSpeed = buildPatchesFromProject(makeProject({ retractionSpeed: 35 }));
    expect(withSpeed.map(p => p.presetKey)).toContain('filament_retraction_speed');
  });

  it('adds enable_pressure_advance as a companion of pressure_advance', () => {
    const pa = buildPatchesFromProject(makeProject()).find(p => p.presetKey === 'pressure_advance');
    expect(pa?.companions).toEqual([{ presetKey: 'enable_pressure_advance', value: '1' }]);
  });
});

describe('clone-and-patch round trips (all slicer fixtures)', () => {
  for (const { file, slicer } of USER_FIXTURES) {
    it(`round-trips ${file}`, () => {
      const parsed = parseFixture(file, slicer);
      const project = makeProject();
      const patches = buildPatchesFromProject(project);
      const generated = generateProfile({
        slicerId: slicer,
        baseProfile: parsed.profile,
        newName: 'PerfectFit - Test PETG',
        patches,
        targetExtruderIndex: 0,
        applyToAllExtruders: false,
        project
      }, parsed);

      // 1. serialize → parse again
      const reparsed = JSON.parse(generated.serialized) as Record<string, unknown>;
      const original = parsed.profile.rawProfile as Record<string, unknown>;

      // 2. expected fields changed
      expect(reparsed.name).toBe('PerfectFit - Test PETG');
      expect(reparsed.from).toBe('User');
      expect(reparsed.filament_settings_id).toEqual(['PerfectFit - Test PETG']);
      expect((reparsed.nozzle_temperature as string[])[0]).toBe('235');
      expect((reparsed.filament_flow_ratio as string[])[0]).toBe('0.97');

      // 3. identity of the source never leaks
      expect(reparsed.setting_id).toBeUndefined();
      expect(reparsed.user_id).toBeUndefined();

      // 4. version + inherits copied from base, never invented
      expect(reparsed.version).toEqual(original.version);
      expect(reparsed.inherits).toEqual(original.inherits);

      // 5. every unrelated field survives byte-identical. filament_id is
      //    deliberately regenerated (Bambu dedupes clones by filament_id).
      const patchedKeys = new Set([
        ...patches.map(p => p.presetKey),
        ...patches.flatMap(p => (p.companions ?? []).map(c => c.presetKey)),
        'name', 'from', 'filament_settings_id', 'setting_id', 'user_id', 'filament_id'
      ]);
      for (const key of Object.keys(original)) {
        if (patchedKeys.has(key)) continue;
        expect(reparsed[key], `field ${key} must be preserved`).toEqual(original[key]);
      }

      // 5b. if the base had a filament_id, the clone gets a fresh unique one
      //     (so Bambu doesn't hide it behind the cloud-synced parent).
      if (typeof original.filament_id === 'string' && original.filament_id) {
        expect(reparsed.filament_id).not.toEqual(original.filament_id);
        expect(String(reparsed.filament_id)).toMatch(/^P[0-9a-f]{7}$/);
      }

      // 6. the base was not mutated
      expect(parsed.profile.rawProfile).toEqual(JSON.parse(fixtureRaw(file).json));
    });
  }

  it('preserves unknown/future fields exactly (synthetic fixture)', () => {
    const parsed = parseFixture('synthetic-unknown-fields.json', 'orca');
    const project = makeProject();
    const generated = generateProfile({
      slicerId: 'orca', baseProfile: parsed.profile, newName: 'PF Unknown Test',
      patches: buildPatchesFromProject(project), targetExtruderIndex: 0,
      applyToAllExtruders: false, project
    }, parsed);
    const reparsed = JSON.parse(generated.serialized) as Record<string, unknown>;
    expect(reparsed.future_quantum_extrusion_mode).toEqual(['entangled']);
    expect(reparsed.future_nested_object).toEqual({ depth: 2, values: [1, 2, 3], flag: true });
    expect(reparsed.future_plain_string).toBe('keep me exactly');
    expect(reparsed.future_number).toBe(42.5);
    expect(reparsed.future_null).toBeNull();
  });

  it('patches only the selected nozzle on the dual-nozzle Bambu fixture', () => {
    const parsed = parseFixture('bambu-user-full-pctg-dualnozzle.json', 'bambu');
    expect(parsed.extruderCount).toBe(2);
    const project = makeProject();
    const generated = generateProfile({
      slicerId: 'bambu', baseProfile: parsed.profile, newName: 'PF Dual Test',
      patches: buildPatchesFromProject(project), targetExtruderIndex: 1,
      applyToAllExtruders: false, project
    }, parsed);
    const reparsed = JSON.parse(generated.serialized) as Record<string, unknown>;
    const original = parsed.profile.rawProfile as Record<string, unknown>;
    const temps = reparsed.nozzle_temperature as string[];
    const origTemps = original.nozzle_temperature as string[];
    expect(temps).toHaveLength(2);
    expect(temps[1]).toBe('235');       // selected nozzle patched
    expect(temps[0]).toBe(origTemps[0]); // other nozzle untouched
    // retraction was 'nil' per extruder; only target index gets a value
    const retract = reparsed.filament_retraction_length as string[];
    const origRetract = original.filament_retraction_length as string[];
    expect(retract[1]).toBe('0.8');
    expect(retract[0]).toBe(origRetract[0]);
  });

  it('applies to all extruders when explicitly requested', () => {
    const parsed = parseFixture('bambu-user-full-pctg-dualnozzle.json', 'bambu');
    const project = makeProject();
    const generated = generateProfile({
      slicerId: 'bambu', baseProfile: parsed.profile, newName: 'PF Dual All',
      patches: buildPatchesFromProject(project), targetExtruderIndex: 0,
      applyToAllExtruders: true, project
    }, parsed);
    const temps = (JSON.parse(generated.serialized) as Record<string, unknown>).nozzle_temperature as string[];
    expect(temps).toEqual(['235', '235']);
  });

  it('rejects a target extruder beyond the profile shape', () => {
    const parsed = parseFixture('bambu-user-full-pctg-dualnozzle.json', 'bambu');
    const project = makeProject();
    expect(() => generateProfile({
      slicerId: 'bambu', baseProfile: parsed.profile, newName: 'PF Bad Tool',
      patches: buildPatchesFromProject(project), targetExtruderIndex: 5,
      applyToAllExtruders: false, project
    }, parsed)).toThrow(/does not exist/);
  });

  it('adds missing keys to delta presets sized to the extruder count', () => {
    const parsed = parseFixture('flashforge-user-delta-pctg.json', 'flash-studio');
    const project = makeProject();
    const generated = generateProfile({
      slicerId: 'flash-studio', baseProfile: parsed.profile, newName: 'PF Delta Add',
      patches: buildPatchesFromProject(project), targetExtruderIndex: 0,
      applyToAllExtruders: false, project
    }, parsed);
    const reparsed = JSON.parse(generated.serialized) as Record<string, unknown>;
    // filament_max_volumetric_speed did not exist in the 12-key delta preset
    expect(reparsed.filament_max_volumetric_speed).toEqual(['15']);
  });

  it('writes a fresh .info sidecar; a USER base chains to its system ancestor base_id', () => {
    const adapter = getAdapter('orca');
    const raw = fixtureRaw('orca-user-delta-pla.json', {
      dir_kind: 'user',
      info: 'sync_info = \nuser_id = 1f187aab\nsetting_id = ba3183ad\nbase_id = EPLAEOSG00\nupdated_time = 1781473826\n'
    });
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: raw.file_name, json: raw.json, infoText: raw.info, filePath: raw.path },
      raw
    )!;
    const generated = generateProfile({
      slicerId: 'orca', baseProfile: parsed.profile, newName: 'PF Info Test',
      patches: buildPatchesFromProject(makeProject()), targetExtruderIndex: 0,
      applyToAllExtruders: false, project: makeProject()
    }, parsed);
    expect(generated.infoText).toContain('sync_info = create');
    expect(generated.infoText).toContain('user_id = \n');
    // Cloning a USER preset must NOT reuse its cloud setting_id (ba3183ad);
    // it chains to the base's own system ancestor (EPLAEOSG00).
    expect(generated.infoText).toContain('base_id = EPLAEOSG00');
    expect(generated.infoText).not.toContain('base_id = ba3183ad');
  });

  it('a SYSTEM base uses its own setting_id as base_id', () => {
    const adapter = getAdapter('orca');
    const sys = JSON.parse(fixtureRaw('orca-system-elegoo-pla.json').json);
    sys.setting_id = 'GFSL99'; // system presets carry their setting_id inline
    const raw = fixtureRaw('orca-system-elegoo-pla.json', {
      dir_kind: 'system', account_id: null, vendor: 'Elegoo', writable: false,
      json: JSON.stringify(sys)
    });
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: raw.file_name, json: raw.json, infoText: null, filePath: raw.path },
      raw
    )!;
    const generated = generateProfile({
      slicerId: 'orca', baseProfile: parsed.profile, newName: 'PF System Base',
      patches: buildPatchesFromProject(makeProject()), targetExtruderIndex: 0,
      applyToAllExtruders: false, project: makeProject()
    }, parsed);
    expect(generated.infoText).toContain('base_id = GFSL99');
  });
});
