import { describe, expect, it } from 'vitest';
import {
  normalizeMaterial, sameMaterial, sameMaterialFamily, sanitizeProfileName, defaultProfileName
} from '../../src/slicerIntegration/orcaFamily';
import { evaluateCompatibility, recommendProfiles, scoreProfile, printerCompatible, isRecommendableBaseline, rankBaselineNames } from '../../src/slicerIntegration/recommendations';
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

describe('rankBaselineNames (New Project starting-profile picker)', () => {
  const h2s: PrinterProfile = { ...printer, name: 'Bambu Lab H2S', manufacturer: 'Bambu Lab' };
  const bambuPlaProject = (): CalibrationProject => {
    const p = project();
    p.filament = { ...p.filament, manufacturer: 'Bambu Lab', material: 'PLA' };
    return p;
  };
  const library = [
    profile({ name: 'Generic PETG @BBL H2S', materialType: 'PETG', compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'], compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4] }),
    profile({ name: 'Bambu PLA Basic @BBL X1C', materialType: 'PLA', vendor: 'Bambu Lab', compatiblePrinterNames: ['Bambu Lab X1 Carbon 0.4 nozzle'], compatiblePrinterModels: ['Bambu Lab X1 Carbon'], compatibleNozzleDiameters: [0.4] }),
    profile({ name: 'Generic PLA @BBL H2S', materialType: 'PLA', compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'], compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4] }),
    profile({ name: 'Bambu PLA Basic @BBL H2S', materialType: 'PLA', vendor: 'Bambu Lab', compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'], compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4] }),
    profile({ name: 'Overture TPU (user)', materialType: 'TPU', sourceType: 'user' }),
    profile({ name: 'Bambu ABS @BBL H2S', materialType: 'ABS', vendor: 'Bambu Lab', compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'], compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4] })
  ];

  it('brand + material + printer match tops the list; Generic next; wrong materials sink', () => {
    const names = rankBaselineNames(library, bambuPlaProject(), h2s);
    expect(names[0]).toBe('Bambu PLA Basic @BBL H2S');
    expect(names[1]).toBe('Generic PLA @BBL H2S');
    // Right material, wrong printer still beats wrong materials.
    expect(names.indexOf('Bambu PLA Basic @BBL X1C')).toBeLessThan(names.indexOf('Bambu ABS @BBL H2S'));
    // Everything remains listed for advanced users — nothing is dropped.
    expect(names).toHaveLength(library.length);
    expect(names.indexOf('Overture TPU (user)')).toBeGreaterThan(2);
  });

  it('Generic tops the list when no brand-name preset exists for the material', () => {
    const p = bambuPlaProject();
    p.filament.manufacturer = 'Polymaker';
    const names = rankBaselineNames(library, p, h2s);
    expect(names[0]).toBe('Generic PLA @BBL H2S');
  });

  it('deduplicates repeated names keeping the best score', () => {
    const dupes = [...library, profile({ name: 'Generic PLA @BBL H2S', materialType: 'PLA', sourceType: 'user' })];
    const names = rankBaselineNames(dupes, bambuPlaProject(), h2s);
    expect(names.filter(n => n === 'Generic PLA @BBL H2S')).toHaveLength(1);
    expect(names[1]).toBe('Generic PLA @BBL H2S');
  });
});

describe('deterministic recommendation', () => {
  it('recommends stock (system) profiles compatible with the printer, not user presets', () => {
    const stockBrand = profile({
      name: 'Overture PETG @ Snapmaker U1', vendor: 'Overture', sourceType: 'system',
      compatiblePrinterModels: ['Snapmaker U1'], compatibleNozzleDiameters: [0.4]
    });
    const stockGeneric = profile({
      name: 'Generic PETG @System', sourceType: 'system',
      compatiblePrinterModels: ['Snapmaker U1'], compatibleNozzleDiameters: [0.4]
    });
    const userPreset = profile({
      name: 'My Custom PETG', vendor: 'Overture', sourceType: 'user', writable: true,
      compatiblePrinterModels: ['Snapmaker U1'], compatibleNozzleDiameters: [0.4]
    });
    const wrongPrinter = profile({
      name: 'Generic PETG @ Bambu', sourceType: 'system',
      compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4]
    });
    const wrongMat = profile({ name: 'Overture PLA', materialType: 'PLA', vendor: 'Overture', sourceType: 'system', compatiblePrinterModels: ['Snapmaker U1'] });

    const rec = recommendProfiles([userPreset, stockGeneric, wrongPrinter, stockBrand, wrongMat], project(), printer);
    expect(rec.usedFallback).toBe(false);
    // best is a STOCK preset (brand match beats generic)
    expect(rec.best?.profile.sourceType).toBe('system');
    expect(rec.best?.profile.name).toBe('Overture PETG @ Snapmaker U1');
    const recommended = [rec.best!, ...rec.alternatives].map(s => s.profile.name);
    // user preset, wrong-printer stock, and wrong-material are NOT recommended
    expect(recommended).not.toContain('My Custom PETG');
    expect(recommended).not.toContain('Generic PETG @ Bambu');
    expect(recommended).not.toContain('Overture PLA');
    // …but everything remains available in `all` for Advanced mode
    expect(rec.all.map(s => s.profile.name)).toContain('My Custom PETG');
  });

  it('falls back to compatible non-stock profiles when no stock preset qualifies', () => {
    const userOnly = profile({ name: 'My PETG', sourceType: 'user', compatibleNozzleDiameters: [0.4] });
    const rec = recommendProfiles([userOnly], project(), printer);
    expect(rec.usedFallback).toBe(true);
    expect(rec.best?.profile.name).toBe('My PETG');
  });

  it('never recommends a different material even when the name looks similar', () => {
    const trap = profile({ name: 'Overture PETG Pro', materialType: 'PLA', vendor: 'Overture', sourceType: 'system' });
    const fallback = profile({ name: 'Generic PETG', sourceType: 'system' });
    const rec = recommendProfiles([trap, fallback], project(), printer);
    expect(rec.best?.profile.name).toBe('Generic PETG');
  });

  it('printerCompatible rejects wrong nozzle/printer, accepts matching or undeclared', () => {
    expect(printerCompatible(profile({ compatibleNozzleDiameters: [0.6], compatiblePrinterModels: ['Snapmaker U1'] }), printer)).toBe(false);
    expect(printerCompatible(profile({ compatibleNozzleDiameters: [0.4], compatiblePrinterModels: ['Bambu Lab H2S'] }), printer)).toBe(false);
    expect(printerCompatible(profile({ compatibleNozzleDiameters: [0.4], compatiblePrinterModels: ['Snapmaker U1'] }), printer)).toBe(true);
    expect(printerCompatible(profile({ compatibleNozzleDiameters: [], compatiblePrinterModels: [] }), printer)).toBe(true);
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
    expect(scored.reasons.find(r => r.label === 'Generic stock profile')?.matched).toBe(true);
  });

  // Regression (H2S bug): system presets whose material is unknown must not be
  // recommended — with unresolved inheritance every material-less stock preset
  // "qualified" for every project and flooded the recommendations.
  it('does not recommend stock presets with unknown material', () => {
    const unknownMat = profile({ name: 'Bambu ABS @BBL H2S', materialType: null });
    const scored = scoreProfile(unknownMat, project(), printer);
    expect(isRecommendableBaseline(scored, printer, project())).toBe(false);
    const rec = recommendProfiles([unknownMat], project(), printer);
    expect(rec.best?.profile.name === 'Bambu ABS @BBL H2S' && !rec.usedFallback).toBe(false);
  });

  it('recommends stock presets whose material was resolved via inheritance', () => {
    const resolved = profile({
      name: 'Bambu PETG @BBL H2S', materialType: 'PETG',
      compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'],
      compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4]
    });
    const h2s: PrinterProfile = { ...printer, name: 'H2S', manufacturer: 'Bambu Lab' };
    const scored = scoreProfile(resolved, project(), h2s);
    expect(isRecommendableBaseline(scored, h2s, project())).toBe(true);
    const rec = recommendProfiles([resolved], project(), h2s);
    expect(rec.usedFallback).toBe(false);
    expect(rec.best?.profile.name).toBe('Bambu PETG @BBL H2S');
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
