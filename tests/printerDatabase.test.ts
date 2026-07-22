import { describe, it, expect } from 'vitest';
// The generator is plain ESM (Node built-ins only); vitest imports it directly.
import {
  buildDatabase, slugify, parseNozzleList, boolYesNo, normalizeExtruder
} from '../scripts/generate-printer-database.mjs';
import {
  allPrinterSpecs, getPrinterSpec, groupedPrinterSpecs, profileValuesFromSpec, specLabel
} from '../src/data/printerDatabase';
import { migrate } from '../src/export/backup';
import { validateAgainstPrinter } from '../src/logic/validation';
import type { BackupFile, PrinterProfile, PrinterDatabase } from '../src/types';

interface BuildResult {
  data: PrinterDatabase;
  skippedEmpty: number;
  warnings: { row: number; message: string }[];
}

// A tiny header row + realistic records across several manufacturers, plus the
// awkward cases the parser must survive. Columns follow the workbook layout.
const HEADER = {
  rowIndex: 1,
  cells: {
    A: 'Manufacturer', B: 'Printer Model', C: 'Technology', D: 'Extruder Type',
    E: 'Max Nozzle Temp (C)', F: 'Max Bed Temp (C)', G: 'Max Chamber Temp (C)',
    H: 'Heated Chamber', I: 'Max Volumetric Flow (mm3/s)', J: 'Default Nozzle Diameter (mm)',
    K: 'Supported Nozzle Sizes (mm)', L: 'Build Volume X (mm)', M: 'Build Volume Y (mm)',
    N: 'Build Volume Z (mm)', O: 'Max Print Speed (mm/s)', P: 'Max Acceleration (mm/s2)',
    Q: 'Firmware', R: 'Number of Extruders', S: 'AMS/MMU Compatibility', T: 'Release Year',
    U: 'Profile Source', V: 'Source File', W: 'Notes'
  }
};

function row(rowIndex: number, cells: Record<string, string>) {
  return { rowIndex, cells };
}

const FIXTURE = [
  HEADER,
  row(2, {
    A: 'Bambu Lab', B: 'Bambu Lab X1 Carbon', C: 'FFF', D: 'Direct Drive',
    E: '300', F: '110', G: '60', H: 'Yes', I: '24', J: '0.4', K: '0.2, 0.4, 0.6, 0.8',
    L: '256', M: '256', N: '256', O: '500', P: '20000', Q: 'Proprietary', R: '1',
    S: 'AMS', T: '2022', U: 'Bambu Studio', V: 'BBL/machine/X1C.json', W: ''
  }),
  row(3, {
    A: 'Creality', B: 'Ender-3 V3 KE', C: 'FFF', D: 'Direct Drive',
    E: '300', F: '100', H: 'No', I: '17', J: '0.4', K: '0.4',
    L: '220', M: '220', N: '240', O: '500', P: '8000', Q: 'Klipper', R: '1', T: '2023',
    U: 'OrcaSlicer', V: 'Creality/machine/KE.json'
  }),
  // Bowden + suffixed/plus nozzle list + missing many optional fields.
  row(4, { A: 'Anycubic', B: 'Anycubic Kobra', D: 'Bowden', K: '0.4HS, 0.6+0.8' }),
  row(5, { /* completely empty */ }),
  // Duplicate manufacturer+model of row 2.
  row(6, { A: 'Bambu Lab', B: 'Bambu Lab X1 Carbon', E: '300' }),
  // Malformed: data present but no manufacturer/model.
  row(7, { E: '250', F: '90' }),
  // Zero is a valid value and must be preserved (not dropped as "empty").
  row(8, { A: 'Zeta', B: 'Zeta Zero', G: '0', F: '0' })
];

describe('printer database generation', () => {
  const { data, skippedEmpty, warnings } = buildDatabase(FIXTURE) as BuildResult;

  it('parses valid rows and skips the fully-empty one', () => {
    expect(skippedEmpty).toBe(1);
    // rows 2,3,4,6,8 become printers (row 7 dropped: no make/model).
    expect(data.printerCount).toBe(5);
  });

  it('converts numbers, keeping valid zeros', () => {
    const x1c = data.printers.find(p => p.model === 'Bambu Lab X1 Carbon' && p.maxNozzleTempC === 300)!;
    expect(x1c.maxNozzleTempC).toBe(300);
    expect(x1c.buildVolumeMm).toEqual({ x: 256, y: 256, z: 256 });
    const zeta = data.printers.find(p => p.manufacturer === 'Zeta')!;
    expect(zeta.maxChamberTempC).toBe(0);   // zero preserved
    expect(zeta.maxBedTempC).toBe(0);
  });

  it('normalizes Yes/No to booleans and blanks to null', () => {
    expect(boolYesNo('Yes', 1)).toBe(true);
    expect(boolYesNo('No', 1)).toBe(false);
    expect(boolYesNo('', 1)).toBe(null);
    const ke = data.printers.find(p => p.model === 'Ender-3 V3 KE')!;
    expect(ke.heatedChamber).toBe(false);
  });

  it('parses supported nozzle sizes, including suffixed and combined forms', () => {
    expect(parseNozzleList('0.2, 0.4, 0.6, 0.8', 1)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(parseNozzleList('0.4HS, 0.6+0.8', 1)).toEqual([0.4, 0.6, 0.8]);
    expect(parseNozzleList('', 1)).toEqual([]);
  });

  it('normalizes extruder types', () => {
    expect(normalizeExtruder('Direct Drive')).toBe('direct-drive');
    expect(normalizeExtruder('Bowden')).toBe('bowden');
    expect(normalizeExtruder('Direct Drive (main) / Bowden (aux)')).toBe('mixed');
    expect(normalizeExtruder('')).toBe(null);
  });

  it('omits unknown optional fields rather than inventing values', () => {
    const kobra = data.printers.find(p => p.manufacturer === 'Anycubic')!;
    expect(kobra.maxNozzleTempC).toBe(null);
    expect(kobra.firmware).toBe(null);
    expect(kobra.buildVolumeMm).toEqual({ x: null, y: null, z: null });
  });

  it('creates stable, unique, readable ids and de-doubles the brand prefix', () => {
    const ids = data.printers.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);          // all unique
    expect(ids).toContain('bambu-lab-x1-carbon');
    expect(ids).toContain('creality-ender-3-v3-ke');
    // The duplicate row gets a suffixed id, not a collision.
    expect(ids.filter(i => i.startsWith('bambu-lab-x1-carbon')).sort())
      .toEqual(['bambu-lab-x1-carbon', 'bambu-lab-x1-carbon-2']);
    expect(slugify('QIDI Plus4')).toBe('qidi-plus4');
  });

  it('warns about duplicates and malformed rows instead of dropping silently', () => {
    const text = warnings.map(w => `${w.row}:${w.message}`).join('\n');
    expect(text).toMatch(/Duplicate manufacturer\+model/);
    expect(text).toMatch(/7:.*missing/i);
  });

  it('sorts manufacturers and models alphabetically', () => {
    expect(data.manufacturers).toEqual([...data.manufacturers].sort(
      (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase())));
  });
});

describe('printer database service (real printers.json)', () => {
  it('ships a non-trivial, well-formed database', () => {
    const all = allPrinterSpecs();
    expect(all.length).toBeGreaterThan(100);
    expect(new Set(all.map(p => p.id)).size).toBe(all.length);
  });

  it('groups by manufacturer with alphabetical models and supports search', () => {
    const groups = groupedPrinterSpecs('bambu');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(g => g.manufacturer.toLowerCase().includes('bambu') ||
      g.printers.every(p => p.model.toLowerCase().includes('bambu')))).toBe(true);
    // Model search should also hit even when the brand doesn't match the query.
    const byModel = groupedPrinterSpecs('X1 Carbon');
    expect(byModel.some(g => g.printers.some(p => /x1 carbon/i.test(p.model)))).toBe(true);
  });

  it('auto-populates profile values and omits unknown fields (never 0)', () => {
    const spec = allPrinterSpecs().find(p => p.maxChamberTempC == null)!;
    const v = profileValuesFromSpec(spec);
    expect('maxChamberTemp' in v).toBe(false);       // unknown → omitted, not 0
    expect(v.isManual).toBe(false);
    expect(v.databasePrinterId).toBe(spec.id);

    const full = getPrinterSpec('bambu-lab-x1-carbon')!;
    const fv = profileValuesFromSpec(full);
    expect(fv.manufacturer).toBe('Bambu Lab');
    expect(fv.maxNozzleTemp).toBe(300);
    expect(fv.extruderType).toBe('direct');          // mapped from 'direct-drive'
    expect(fv.supportedNozzleDiameters).toContain(0.4);
    expect(specLabel(full)).toContain('Bambu Lab');
  });
});

describe('backward compatibility / migration', () => {
  it('migrates a v3 backup to v4 and flags pre-existing printers as manual', () => {
    const oldPrinter = {
      id: 'p1', name: 'My Ender', manufacturer: 'Creality', nozzleDiameter: 0.4,
      maxNozzleTemp: 260, maxBedTemp: 100, extruderType: 'bowden',
      retractionRange: { start: 0, end: 2 }, notes: '', createdAt: 'x', updatedAt: 'x'
    } as unknown as PrinterProfile;
    const file = {
      app: 'perfectfit-filament-calibration-wizard', schemaVersion: 3,
      exportedAt: '2026-01-01T00:00:00Z', projects: [], printers: [oldPrinter]
    } as unknown as BackupFile;
    const out = migrate(file);
    expect(out.schemaVersion).toBe(4);
    expect(out.printers[0].isManual).toBe(true);
    // Existing values are preserved, not reset.
    expect(out.printers[0].maxNozzleTemp).toBe(260);
    expect(out.printers[0].nozzleDiameter).toBe(0.4);
  });
});

describe('safe-limit validation against printer specs', () => {
  const printer = {
    id: 'x', name: 'X', manufacturer: 'B', nozzleDiameter: 0.4,
    maxNozzleTemp: 300, maxBedTemp: 110, maxVolumetricFlow: 24, extruderType: 'direct',
    retractionRange: { start: 0, end: 1 }, notes: '', createdAt: '', updatedAt: ''
  } as PrinterProfile;

  it('errors when a temperature exceeds the printer maximum', () => {
    expect(validateAgainstPrinter('nozzleTemp', 320, printer).some(i => i.level === 'error')).toBe(true);
    expect(validateAgainstPrinter('nozzleTemp', 250, printer)).toHaveLength(0);
    expect(validateAgainstPrinter('bedTemp', 130, printer).some(i => i.level === 'error')).toBe(true);
  });

  it('warns (not errors) when MVS exceeds the rated flow', () => {
    const issues = validateAgainstPrinter('mvs', 30, printer);
    expect(issues.some(i => i.level === 'warning')).toBe(true);
  });
});
