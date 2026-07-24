// ---------------------------------------------------------------------------
// Printer specification database — read-only access layer.
//
// The runtime data (printers.json) is generated from Printer_Database.xlsx by
// scripts/generate-printer-database.mjs. This module is the single place the
// app reads it, so parsing/shape concerns never leak into UI or calibration
// logic. Do NOT read printers.json directly elsewhere.
// ---------------------------------------------------------------------------

import raw from './printers.json';
import type {
  PrinterDatabase, PrinterSpecification, PrinterProfile, ExtruderType
} from '../types';

const db = raw as PrinterDatabase;

export const PRINTER_DB_SCHEMA_VERSION = db.schemaVersion;
/** Databases generated before 1.3.2 carry no dataRevision — they are revision 1. */
export const PRINTER_DB_DATA_REVISION = db.dataRevision ?? 1;
export const PRINTER_DB_COUNT = db.printerCount;

/** All specs, ordered by manufacturer then model (as generated). */
export function allPrinterSpecs(): PrinterSpecification[] {
  return db.printers;
}

export function getPrinterSpec(id: string | null | undefined): PrinterSpecification | undefined {
  if (!id) return undefined;
  return db.printers.find(p => p.id === id);
}

export interface ManufacturerGroup {
  manufacturer: string;
  printers: PrinterSpecification[];
}

/**
 * Group specs by manufacturer (alphabetical), models alphabetical within each.
 * Optional `query` filters on manufacturer OR model (case-insensitive), and
 * empty groups are dropped.
 */
export function groupedPrinterSpecs(query = ''): ManufacturerGroup[] {
  const q = query.trim().toLowerCase();
  const byMake = new Map<string, PrinterSpecification[]>();
  for (const p of db.printers) {
    if (q && !p.manufacturer.toLowerCase().includes(q) && !p.model.toLowerCase().includes(q)
        && !`${p.manufacturer} ${p.model}`.toLowerCase().includes(q)) {
      continue;
    }
    const list = byMake.get(p.manufacturer) ?? [];
    list.push(p);
    byMake.set(p.manufacturer, list);
  }
  return [...byMake.entries()]
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    .map(([manufacturer, printers]) => ({
      manufacturer,
      printers: printers.slice().sort((a, b) => a.model.toLowerCase().localeCompare(b.model.toLowerCase()))
    }));
}

/** A human label for a spec, e.g. "Bambu Lab · X1 Carbon". */
export function specLabel(spec: PrinterSpecification): string {
  // Models frequently repeat the brand prefix; trim it for a cleaner label.
  const model = spec.model.toLowerCase().startsWith(spec.manufacturer.toLowerCase() + ' ')
    ? spec.model.slice(spec.manufacturer.length + 1)
    : spec.model;
  return `${spec.manufacturer} · ${model}`;
}

function mapExtruder(t: PrinterSpecification['extruderType']): ExtruderType {
  // PrinterProfile only distinguishes direct vs bowden. "mixed" printers have
  // a direct-drive main extruder; treat unknown as direct (the common case).
  return t === 'bowden' ? 'bowden' : 'direct';
}

function n(v: number | null | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Build the field values a printer database record supplies for the Add Printer
 * form. Returns only the keys the database actually knows — unknown values are
 * omitted (never 0), so callers can leave existing values untouched.
 */
export function profileValuesFromSpec(spec: PrinterSpecification): Partial<PrinterProfile> {
  const out: Partial<PrinterProfile> = {
    manufacturer: spec.manufacturer,
    model: spec.model,
    extruderType: mapExtruder(spec.extruderType),
    databasePrinterId: spec.id,
    databaseSchemaVersion: db.schemaVersion,
    databaseDataRevision: PRINTER_DB_DATA_REVISION,
    isManual: false
  };
  const maxNozzle = n(spec.maxNozzleTempC);
  const maxBed = n(spec.maxBedTempC);
  const maxChamber = n(spec.maxChamberTempC);
  const maxFlow = n(spec.maxVolumetricFlowMm3s);
  const defNozzle = n(spec.defaultNozzleDiameterMm);
  const speed = n(spec.maxPrintSpeedMmS);
  const accel = n(spec.maxAccelerationMmS2);
  const extruders = n(spec.extruderCount);
  const year = n(spec.releaseYear);

  if (spec.technology) out.technology = spec.technology;
  if (maxNozzle !== undefined) out.maxNozzleTemp = maxNozzle;
  if (maxBed !== undefined) out.maxBedTemp = maxBed;
  if (maxChamber !== undefined) out.maxChamberTemp = maxChamber;
  if (spec.heatedChamber !== null && spec.heatedChamber !== undefined) out.heatedChamber = spec.heatedChamber;
  if (maxFlow !== undefined) out.maxVolumetricFlow = maxFlow;
  if (defNozzle !== undefined) out.nozzleDiameter = defNozzle;
  if (spec.supportedNozzleDiametersMm?.length) out.supportedNozzleDiameters = [...spec.supportedNozzleDiametersMm];
  const bx = n(spec.buildVolumeMm?.x), by = n(spec.buildVolumeMm?.y), bz = n(spec.buildVolumeMm?.z);
  if (bx !== undefined || by !== undefined || bz !== undefined) out.buildVolume = { x: bx, y: by, z: bz };
  if (speed !== undefined) out.maxPrintSpeed = speed;
  if (accel !== undefined) out.maxAcceleration = accel;
  if (spec.firmware) out.firmware = spec.firmware;
  if (extruders !== undefined) out.extruderCount = extruders;
  if (spec.multiMaterialCompatibility) out.multiMaterialCompatibility = spec.multiMaterialCompatibility;
  if (year !== undefined) out.releaseYear = year;

  return out;
}

// --- refreshing saved profiles when the database is corrected ---------------

/** Human labels for the profile fields the database can supply. */
const REFRESHABLE_FIELDS: { key: keyof PrinterProfile; label: string; unit?: string }[] = [
  { key: 'maxNozzleTemp', label: 'Max nozzle temp', unit: '°C' },
  { key: 'maxBedTemp', label: 'Max bed temp', unit: '°C' },
  { key: 'maxChamberTemp', label: 'Max chamber temp', unit: '°C' },
  { key: 'heatedChamber', label: 'Heated chamber' },
  { key: 'maxVolumetricFlow', label: 'Max volumetric flow', unit: 'mm³/s' },
  { key: 'nozzleDiameter', label: 'Nozzle diameter', unit: 'mm' },
  { key: 'supportedNozzleDiameters', label: 'Supported nozzle sizes', unit: 'mm' },
  { key: 'buildVolume', label: 'Build volume', unit: 'mm' },
  { key: 'maxPrintSpeed', label: 'Max print speed', unit: 'mm/s' },
  { key: 'maxAcceleration', label: 'Max acceleration', unit: 'mm/s²' },
  { key: 'firmware', label: 'Firmware' },
  { key: 'extruderCount', label: 'Number of extruders' },
  { key: 'multiMaterialCompatibility', label: 'Multi-material' },
  { key: 'extruderType', label: 'Extruder type' },
  { key: 'releaseYear', label: 'Release year' }
];

export interface SpecChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

function display(v: unknown, unit?: string): string {
  if (v === undefined || v === null) return 'not specified';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? `${v.join(', ')}${unit ? ` ${unit}` : ''}` : 'not specified';
  if (typeof v === 'object') {
    const b = v as { x?: number; y?: number; z?: number };
    const parts = [b.x, b.y, b.z].filter(x => x !== undefined && x !== null);
    return parts.length ? `${parts.join(' × ')}${unit ? ` ${unit}` : ''}` : 'not specified';
  }
  return `${String(v)}${unit ? ` ${unit}` : ''}`;
}

/**
 * True when this profile came from the database and the shipped database has
 * been revised since. Profiles saved before 1.3.2 carry no revision, so they
 * are treated as revision 1 — which is exactly the corrupted 1.3.0 data.
 */
export function isSpecRefreshAvailable(profile: PrinterProfile): boolean {
  if (!profile.databasePrinterId || profile.isManual) return false;
  if (!getPrinterSpec(profile.databasePrinterId)) return false;
  return (profile.databaseDataRevision ?? 1) < PRINTER_DB_DATA_REVISION;
}

/**
 * Fields where the saved profile differs from the current database record.
 *
 * Deliberately a REVIEW step rather than a silent migration: the app does not
 * track which fields a user hand-tuned for modified hardware, so overwriting
 * without showing the change could quietly discard a correct custom value.
 */
export function specChangesForProfile(profile: PrinterProfile): SpecChange[] {
  const spec = getPrinterSpec(profile.databasePrinterId);
  if (!spec) return [];
  const next = profileValuesFromSpec(spec);
  const changes: SpecChange[] = [];
  for (const { key, label, unit } of REFRESHABLE_FIELDS) {
    if (!(key in next)) continue;                     // database doesn't know it
    const from = profile[key], to = next[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ key: String(key), label, from: display(from, unit), to: display(to, unit) });
  }
  return changes;
}

/**
 * A copy of `profile` with database-supplied fields refreshed and the revision
 * stamped. Name, notes, retraction range and every other user-owned field are
 * preserved, as is the profile id — so projects referencing it stay linked.
 */
export function refreshProfileFromDatabase(profile: PrinterProfile): PrinterProfile {
  const spec = getPrinterSpec(profile.databasePrinterId);
  if (!spec) return profile;
  return {
    ...profile,
    ...profileValuesFromSpec(spec),
    id: profile.id,
    name: profile.name,
    notes: profile.notes,
    retractionRange: { ...profile.retractionRange },
    createdAt: profile.createdAt,
    updatedAt: new Date().toISOString()
  };
}
