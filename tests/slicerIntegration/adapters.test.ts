import { describe, expect, it } from 'vitest';
import { getAdapter } from '../../src/slicerIntegration/adapters';
import { fixtureJson, fixtureRaw, USER_FIXTURES } from './fixtures';

describe('slicer adapters — parsing real fixtures', () => {
  for (const { file, slicer } of USER_FIXTURES) {
    it(`parses ${file} (${slicer})`, () => {
      const adapter = getAdapter(slicer);
      const raw = fixtureRaw(file);
      const parsed = adapter.parseProfile(
        { kind: 'detected', fileName: file, json: raw.json, infoText: raw.info, filePath: raw.path },
        raw
      );
      expect(parsed).not.toBeNull();
      expect(parsed!.profile.name.length).toBeGreaterThan(0);
      expect(parsed!.schemaRecognized).toBe(true);
      expect(parsed!.profile.sourceType).toBe('user');
      expect(parsed!.profile.slicerId).toBe(slicer);
    });
  }

  it('classifies account dirs as cloud with a sync warning (bambu)', () => {
    const adapter = getAdapter('bambu');
    const raw = fixtureRaw('bambu-user-full-pctg-dualnozzle.json', { account_id: '3964423668' });
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: raw.file_name, json: raw.json, infoText: null, filePath: raw.path },
      raw
    )!;
    expect(parsed.profile.sourceType).toBe('cloud');
    expect(parsed.profile.warnings.some(w => /cloud|account/i.test(w))).toBe(true);
  });

  it('detects dual-nozzle extruder count on the Bambu H2S fixture', () => {
    const adapter = getAdapter('bambu');
    const raw = fixtureRaw('bambu-user-full-pctg-dualnozzle.json');
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: raw.file_name, json: raw.json, infoText: null, filePath: raw.path },
      raw
    )!;
    expect(parsed.extruderCount).toBe(2);
    expect(parsed.profile.compatiblePrinterNames).toContain('Bambu Lab H2S 0.4 nozzle');
    expect(parsed.profile.compatibleNozzleDiameters).toEqual([0.4]);
    expect(parsed.profile.materialType).toBe('PCTG');
    expect(parsed.profile.vendor).toBe('3D-Fuel');
  });

  it('filters system vendor-index style files and abstract nodes', () => {
    const adapter = getAdapter('orca');
    const system = fixtureRaw('orca-system-elegoo-pla.json', { dir_kind: 'system', account_id: null, vendor: 'Elegoo', writable: false });
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: system.file_name, json: system.json, infoText: null, filePath: system.path },
      system
    );
    // instantiation:"true" system preset is a valid clone source
    expect(parsed).not.toBeNull();
    expect(parsed!.profile.sourceType).toBe('system');
    expect(parsed!.profile.writable).toBe(false);

    const abstract = fixtureRaw('orca-system-elegoo-pla.json', { dir_kind: 'system', vendor: 'Elegoo' });
    const data = JSON.parse(abstract.json);
    data.instantiation = 'false';
    abstract.json = JSON.stringify(data);
    const abstractParsed = adapter.parseProfile(
      { kind: 'detected', fileName: abstract.file_name, json: abstract.json, infoText: null, filePath: abstract.path },
      abstract
    );
    expect(abstractParsed).toBeNull();
  });

  it('flags unrecognized schemas instead of guessing', () => {
    const adapter = getAdapter('orca');
    const raw = fixtureRaw('synthetic-unsupported-schema.json');
    const parsed = adapter.parseProfile(
      { kind: 'detected', fileName: raw.file_name, json: raw.json, infoText: null, filePath: raw.path },
      raw
    )!;
    expect(parsed.schemaRecognized).toBe(false);
    expect(parsed.profile.warnings.some(w => /does not look like/i.test(w))).toBe(true);
  });

  it('parses the manual-selection path without a raw file', () => {
    const adapter = getAdapter('elegoo');
    const parsed = adapter.parseProfile({
      kind: 'manual-file',
      fileName: 'elegoo-user-delta-petg.json',
      json: fixtureJson('elegoo-user-delta-petg.json')
    })!;
    expect(parsed.profile.sourceType).toBe('manual');
    expect(parsed.profile.writable).toBe(false);
  });
});
