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
