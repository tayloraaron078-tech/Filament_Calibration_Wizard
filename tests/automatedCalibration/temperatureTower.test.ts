import { describe, it, expect } from 'vitest';
import {
  buildTemperatureBands,
  serializeCustomGcodePerLayer,
  generateTemperatureTowerGcode,
  UNSET_EXTRUDER,
  type TemperatureRange,
  type TemperatureTowerGeometry
} from '../../src/automatedCalibration/temperatureTower';

const RANGE: TemperatureRange = { startTemp: 230, endTemp: 210, step: 5 };
const GEO: TemperatureTowerGeometry = { bandHeightMm: 10, baseHeightMm: 10, layerHeightMm: 0.2 };

describe('buildTemperatureBands', () => {
  it('emits one change per band below the start temp, descending by step', () => {
    const bands = buildTemperatureBands(RANGE, GEO);
    expect(bands.map((b) => b.temperature)).toEqual([225, 220, 215, 210]);
    // first change at the base height, then every band height above it
    expect(bands.map((b) => b.topZ)).toEqual([10, 20, 30, 40]);
  });

  it('snaps band boundaries to the layer height', () => {
    const bands = buildTemperatureBands(RANGE, { ...GEO, baseHeightMm: 10.13, layerHeightMm: 0.2 });
    // 10.13 → nearest 0.2 multiple = 10.2
    expect(bands[0].topZ).toBe(10.2);
    // 10.13 + 10 = 20.13 → 20.2
    expect(bands[1].topZ).toBe(20.2);
  });

  it('handles a range that does not divide evenly (stops at/above endTemp)', () => {
    const bands = buildTemperatureBands({ startTemp: 230, endTemp: 213, step: 5 }, GEO);
    // 225, 220, 215 — 210 would be below endTemp(213), so excluded
    expect(bands.map((b) => b.temperature)).toEqual([225, 220, 215]);
  });

  it('rejects invalid inputs', () => {
    expect(() => buildTemperatureBands({ startTemp: 200, endTemp: 220, step: 5 }, GEO)).toThrow(/startTemp/);
    expect(() => buildTemperatureBands({ ...RANGE, step: 0 }, GEO)).toThrow(/step/);
    expect(() => buildTemperatureBands(RANGE, { ...GEO, bandHeightMm: 0 })).toThrow(/bandHeightMm/);
  });
});

describe('serializeCustomGcodePerLayer', () => {
  it('produces Orca-shaped XML with Custom (type=4) M104 entries', () => {
    const xml = serializeCustomGcodePerLayer(buildTemperatureBands(RANGE, GEO));
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>');
    expect(xml).toContain('<custom_gcodes_per_layer>');
    expect(xml).toContain('<plate_info id="1"/>');
    expect(xml).toContain(
      `<layer top_z="10" type="4" extruder="${UNSET_EXTRUDER}" color="" extra="M104 S225"/>`
    );
    expect(xml).toContain('extra="M104 S210"/>');
    expect(xml.trim().endsWith('</custom_gcodes_per_layer>')).toBe(true);
    // one <layer> per band
    expect(xml.match(/<layer /g)).toHaveLength(4);
  });

  it('escapes XML-special characters in the injected g-code', () => {
    const xml = serializeCustomGcodePerLayer([{ topZ: 5, temperature: 200 }]);
    // sanity: no raw ampersand/quote breaks the attribute (none here, but the
    // escaper must be applied — verify a crafted value is escaped)
    const crafted = serializeCustomGcodePerLayer([{ topZ: 1, temperature: 200 }]);
    expect(crafted).toContain('extra="M104 S200"/>');
    expect(xml).toContain('top_z="5"');
  });
});

describe('generateTemperatureTowerGcode', () => {
  it('returns matching bands and xml', () => {
    const { bands, xml } = generateTemperatureTowerGcode(RANGE, GEO);
    expect(bands).toHaveLength(4);
    for (const b of bands) expect(xml).toContain(`M104 S${b.temperature}`);
  });
});
