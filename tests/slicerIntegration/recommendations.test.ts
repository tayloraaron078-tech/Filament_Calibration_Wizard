import { describe, expect, it } from 'vitest';
import {
  normalizeMaterial, sameMaterial, sameMaterialFamily, sanitizeProfileName, defaultProfileName
} from '../../src/slicerIntegration/orcaFamily';
import { evaluateCompatibility, recommendProfiles, scoreProfile } from '../../src/slicerIntegration/recommendations';
import type { DetectedFilamentProfile } from '../../src/slicerIntegration/types';
import type { CalibrationProject, PrinterProfile } from '../../src/types';

function profile(overrides: Partial<DetectedFilamentProfile>): DetectedFilamentProfile {
  return {
    id: `p-${Math.random()}`, slicerId: 'orca', name: 'Generic PETG',
    vendor: null, materialType: 'PETG', colorName: null, sourceType: 'system',
    filePath: null, parentProfileName: null, compatiblePrinterNames: [],
    compatiblePrinterModels: [], compatibleNozzleDiameters: [], profileVersion: null,
    rawProfile: {}, infoSidecar: null, writable: false, warnings: [],
    ...overrides
  };
}

function project(): CalibrationProject {
  return {
    id: 'p1', createdAt: '', updatedAt: '', calibrationDate: '',
    filament: { manufacturer: 'Overture', productLine: '', material: 'PETG', color: 'Black', diameter: 1.75, startingProfile: '' },
    printerProfileId: 'pr1', nozzleType: 'brass', slicer: { slicer: 'orca', version: '2.4.x' },
    notes: '', mode: 'expert', stepOrder: [], steps: {} as CalibrationProject['steps'],
    timeline: [], archived: false, finals: {}
  };
}

const printer: PrinterProfile = {
  id: 'pr1', name: 'Snapmaker U1', manufacturer: 'Snapmaker', nozzleDiameter: 0.4,
  maxNozzleTemp: 300, maxBedTemp: 110, extruderType: 'direct',
  retractionRange: { start: 0.5, end: 2 }, notes: '', createdAt: '', updatedAt: ''
};

describe('material normalization', () => {
  it('distinguishes materially different families', () => {
    expect(sameMaterial('PLA', 'PLA+')).toBe(false);
    expect(sameMaterialFamily('PLA', 'PLA+')).toBe(true);
    expect(sameMaterial('PETG', 'PETG-HF')).toBe(false);
    expect(sameMaterialFamily('PETG', 'PETG-HF')).toBe(true);
    expect(sameMaterialFamily('PETG', 'PCTG')).toBe(false);
    expect(sameMaterialFamily('ABS', 'ASA')).toBe(false);
    expect(sameMaterialFamily('PA-CF', 'PPA-CF')).toBe(false);
    expect(sameMaterialFamily('PPS-CF', 'PPS')).toBe(true);
    expect(sameMaterialFamily('PC', 'PCTG')).toBe(false);
  });

  it('normalizes aliases without cross-family guessing', () => {
    expect(normalizeMaterial('petg hf')?.canonical).toBe('PETG-HF');
    expect(normalizeMaterial('Generic PLA')?.family).toBe('PLA');
    expect(normalizeMaterial('WeirdoPlastic')?.family).toBe('WEIRDOPLASTIC');
  });
});

describe('compatibility', () => {
  it('blocks different material families with an error', () => {
    const r = evaluateCompatibility(profile({ materialType: 'TPU' }), project(), printer);
    expect(r.compatible).toBe(false);
    expect(r.errors[0]).toMatch(/Different material/);
  });

  it('warns (not blocks) on same-family variants', () => {
    const r = evaluateCompatibility(profile({ materialType: 'PETG-HF' }), project(), printer);
    expect(r.compatible).toBe(true);
    expect(r.warnings.some(w => /Related but not identical/.test(w))).toBe(true);
  });

  it('warns on nozzle mismatch', () => {
    const r = evaluateCompatibility(
      profile({ compatiblePrinterNames: ['Snapmaker U1 0.6 nozzle'], compatibleNozzleDiameters: [0.6], compatiblePrinterModels: ['Snapmaker U1'] }),
      project(), printer
    );
    expect(r.compatible).toBe(true);
    expect(r.warnings.some(w => /0\.6/.test(w))).toBe(true);
  });
});

describe('deterministic recommendation', () => {
  it('prefers exact vendor+material+printer+nozzle match and explains why', () => {
    const exact = profile({
      name: 'Overture PETG @ Snapmaker U1 0.4', vendor: 'Overture', sourceType: 'user',
      compatiblePrinterNames: ['Snapmaker U1 0.4 nozzle'], compatiblePrinterModels: ['Snapmaker U1'],
      compatibleNozzleDiameters: [0.4], writable: true
    });
    const generic = profile({ name: 'Generic PETG @System' });
    const wrongMat = profile({ name: 'Overture PLA', materialType: 'PLA', vendor: 'Overture' });

    const rec = recommendProfiles([generic, wrongMat, exact], project(), printer);
    expect(rec.best?.profile.name).toBe('Overture PETG @ Snapmaker U1 0.4');
    const matched = rec.best!.reasons.filter(r => r.matched).map(r => r.label);
    expect(matched.join('\n')).toMatch(/Exact material match: PETG/);
    expect(matched.join('\n')).toMatch(/Manufacturer match: Overture/);
    expect(matched.join('\n')).toMatch(/Compatible with Snapmaker U1/);
    expect(matched.join('\n')).toMatch(/Nozzle match: 0.4/);
    // Different-material profile can never win or be eligible
    expect(rec.best!.profile.materialType).toBe('PETG');
    expect(rec.alternatives.every(a => a.compatibility.compatible)).toBe(true);
    expect(rec.alternatives.map(a => a.profile.name)).not.toContain('Overture PLA');
  });

  it('never recommends a different material even when the name looks similar', () => {
    const trap = profile({ name: 'Overture PETG Pro', materialType: 'PLA', vendor: 'Overture' });
    const fallback = profile({ name: 'Generic PETG' });
    const rec = recommendProfiles([trap, fallback], project(), printer);
    expect(rec.best?.profile.name).toBe('Generic PETG');
  });

  it('is deterministic (stable order, no randomness)', () => {
    const list = [profile({ name: 'B PETG' }), profile({ name: 'A PETG' })];
    const a = recommendProfiles(list, project(), printer);
    const b = recommendProfiles([...list].reverse(), project(), printer);
    expect(a.all.map(s => s.profile.name)).toEqual(b.all.map(s => s.profile.name));
  });

  it('falls back to generic material profile when nothing better exists', () => {
    const rec = recommendProfiles([profile({ name: 'Generic PETG' })], project(), printer);
    expect(rec.best?.profile.name).toBe('Generic PETG');
    const scored = scoreProfile(profile({ name: 'Generic PETG' }), project(), printer);
    expect(scored.reasons.find(r => r.label === 'Generic base profile')?.matched).toBe(true);
  });
});

describe('profile naming', () => {
  it('builds the default PerfectFit name pattern', () => {
    expect(defaultProfileName({
      manufacturer: 'Overture', material: 'PETG', color: 'Black',
      printerName: 'Snapmaker U1', nozzle: 0.4
    })).toBe('PerfectFit - Overture PETG Black @ Snapmaker U1 0.4');
  });

  it('sanitizes only genuinely invalid characters', () => {
    expect(sanitizeProfileName('PerfectFit - Overture PETG Black @ 0.4')).toBe('PerfectFit - Overture PETG Black @ 0.4');
    expect(sanitizeProfileName('Bad/Name:With*Chars?')).toBe('BadNameWithChars');
    expect(sanitizeProfileName('Trailing dot.')).toBe('Trailing dot');
  });
});
