// Regression tests for inherited-metadata resolution (H2S stock-baseline bug):
// Bambu system leaves declare compatible_printers but inherit filament_type /
// filament_vendor from abstract parents; user deltas inherit compatible_printers.
import { describe, expect, it } from 'vitest';
import { resolveInheritedMetadata } from '../../src/slicerIntegration/scanner';
import type { DetectedFilamentProfile } from '../../src/slicerIntegration/types';

function profile(overrides: Partial<DetectedFilamentProfile>): DetectedFilamentProfile {
  return {
    id: `p-${Math.random()}`, slicerId: 'bambu', name: 'x',
    vendor: null, materialType: null, colorName: null, sourceType: 'system',
    filePath: null, parentProfileName: null, compatiblePrinterNames: [],
    compatiblePrinterModels: [], compatibleNozzleDiameters: [], profileVersion: null,
    rawProfile: {}, infoSidecar: null, writable: false, warnings: [],
    ...overrides
  };
}

// Mirrors the real BBL library shape: leaf → @base → fdm abstract.
const systemFiles = [
  {
    dir_kind: 'system',
    json: JSON.stringify({
      type: 'filament', name: 'Bambu ABS @BBL H2S', inherits: 'Bambu ABS @base',
      instantiation: 'true',
      compatible_printers: ['Bambu Lab H2S 0.4 nozzle', 'Bambu Lab H2S 0.6 nozzle']
    })
  },
  {
    dir_kind: 'system',
    json: JSON.stringify({
      type: 'filament', name: 'Bambu ABS @base', inherits: 'fdm_filament_abs',
      instantiation: 'false', filament_vendor: ['Bambu Lab'], version: '2.3.0.2'
    })
  },
  {
    dir_kind: 'system',
    json: JSON.stringify({
      type: 'filament', name: 'fdm_filament_abs', inherits: '',
      instantiation: 'false', filament_type: ['ABS']
    })
  }
];

describe('resolveInheritedMetadata', () => {
  it('fills filament_type and vendor for a system leaf through the @base chain', () => {
    const leaf = profile({
      name: 'Bambu ABS @BBL H2S', parentProfileName: 'Bambu ABS @base',
      compatiblePrinterNames: ['Bambu Lab H2S 0.4 nozzle'],
      compatiblePrinterModels: ['Bambu Lab H2S'], compatibleNozzleDiameters: [0.4]
    });
    resolveInheritedMetadata([leaf], systemFiles);
    expect(leaf.materialType).toBe('ABS');
    expect(leaf.vendor).toBe('Bambu Lab');
    // declared fields are never overwritten
    expect(leaf.compatiblePrinterNames).toEqual(['Bambu Lab H2S 0.4 nozzle']);
  });

  it('fills the schema version for a system leaf from the @base chain', () => {
    const leaf = profile({
      name: 'Bambu ABS @BBL H2S', parentProfileName: 'Bambu ABS @base'
    });
    resolveInheritedMetadata([leaf], systemFiles);
    expect(leaf.profileVersion).toBe('2.3.0.2');
  });

  it('fills compatible_printers for a user delta from its system parent', () => {
    const delta = profile({
      name: 'My ABS tweak', sourceType: 'user',
      parentProfileName: 'Bambu ABS @BBL H2S', materialType: null
    });
    resolveInheritedMetadata([delta], systemFiles);
    expect(delta.compatiblePrinterNames).toEqual(['Bambu Lab H2S 0.4 nozzle', 'Bambu Lab H2S 0.6 nozzle']);
    expect(delta.compatiblePrinterModels).toEqual(['Bambu Lab H2S']);
    expect(delta.compatibleNozzleDiameters).toEqual([0.4, 0.6]);
    // material resolves through leaf → @base → fdm abstract
    expect(delta.materialType).toBe('ABS');
  });

  it('does not overwrite declared metadata and survives missing parents', () => {
    const declared = profile({
      name: 'Full snapshot', sourceType: 'user', materialType: 'PETG',
      vendor: 'Overture', parentProfileName: 'Nonexistent Parent',
      compatiblePrinterNames: ['Some Printer 0.4 nozzle']
    });
    resolveInheritedMetadata([declared], systemFiles);
    expect(declared.materialType).toBe('PETG');
    expect(declared.vendor).toBe('Overture');
  });

  it('is a no-op without system files and tolerates unparsable json', () => {
    const p = profile({ parentProfileName: 'Bambu ABS @base' });
    resolveInheritedMetadata([p], [{ dir_kind: 'user', json: '{}' }, { dir_kind: 'system', json: 'not json' }]);
    expect(p.materialType).toBeNull();
  });

  it('terminates on inheritance cycles', () => {
    const cyclic = [
      { dir_kind: 'system', json: JSON.stringify({ name: 'A', inherits: 'B' }) },
      { dir_kind: 'system', json: JSON.stringify({ name: 'B', inherits: 'A' }) }
    ];
    const p = profile({ parentProfileName: 'A' });
    resolveInheritedMetadata([p], cyclic); // must not hang
    expect(p.materialType).toBeNull();
  });
});
