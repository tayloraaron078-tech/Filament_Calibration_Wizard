// ---------------------------------------------------------------------------
// Shared Orca-family preset engine.
//
// All five supported slicers are PrusaSlicer→Bambu→Orca lineage and share the
// user filament preset JSON shape verified in docs/SLICER_PROFILE_RESEARCH.md:
//   - identity fields: name / from / inherits / version / filament_settings_id
//   - all setting values are arrays of strings, one entry per extruder
//   - "nil" is the "no filament-level override" sentinel
//   - delta presets store only overridden keys; full presets store everything
//
// This module is pure data transformation: no filesystem access, safe in the
// browser build. Unknown fields must survive parse → clone → patch → serialize.
// ---------------------------------------------------------------------------

import type {
  DetectedFilamentProfile, IntegrationSlicerId, NormalizedMaterial,
  ParsedFilamentProfile, ProfileFieldChange, ProfileSource, CalibratedFieldPatch
} from './types';

// --- material normalization -------------------------------------------------

const MATERIAL_ALIASES: Record<string, NormalizedMaterial> = {
  'PLA': { canonical: 'PLA', family: 'PLA' },
  'PLA+': { canonical: 'PLA+', family: 'PLA' },
  'PLA PLUS': { canonical: 'PLA+', family: 'PLA' },
  'PLA-CF': { canonical: 'PLA-CF', family: 'PLA' },
  'PLA AERO': { canonical: 'PLA Aero', family: 'PLA' },
  'PLA SILK': { canonical: 'PLA Silk', family: 'PLA' },
  'PETG': { canonical: 'PETG', family: 'PETG' },
  'PETG-HF': { canonical: 'PETG-HF', family: 'PETG' },
  'PETG HF': { canonical: 'PETG-HF', family: 'PETG' },
  'PETG-CF': { canonical: 'PETG-CF', family: 'PETG' },
  'PCTG': { canonical: 'PCTG', family: 'PCTG' },
  'ABS': { canonical: 'ABS', family: 'ABS' },
  'ABS-GF': { canonical: 'ABS-GF', family: 'ABS' },
  'ASA': { canonical: 'ASA', family: 'ASA' },
  'ASA-AERO': { canonical: 'ASA Aero', family: 'ASA' },
  'TPU': { canonical: 'TPU', family: 'TPU' },
  'TPU-AMS': { canonical: 'TPU', family: 'TPU' },
  'TPU 95A': { canonical: 'TPU', family: 'TPU' },
  'PA': { canonical: 'PA', family: 'PA' },
  'PA-CF': { canonical: 'PA-CF', family: 'PA' },
  'PA-GF': { canonical: 'PA-GF', family: 'PA' },
  'PA6-CF': { canonical: 'PA6-CF', family: 'PA' },
  'PAHT-CF': { canonical: 'PAHT-CF', family: 'PA' },
  'PPA-CF': { canonical: 'PPA-CF', family: 'PPA' },
  'PPA-GF': { canonical: 'PPA-GF', family: 'PPA' },
  'PPS': { canonical: 'PPS', family: 'PPS' },
  'PPS-CF': { canonical: 'PPS-CF', family: 'PPS' },
  'PC': { canonical: 'PC', family: 'PC' },
  'PC-CF': { canonical: 'PC-CF', family: 'PC' },
  'PP': { canonical: 'PP', family: 'PP' },
  'PVA': { canonical: 'PVA', family: 'PVA' },
  'HIPS': { canonical: 'HIPS', family: 'HIPS' },
  'PE': { canonical: 'PE', family: 'PE' },
  'PHA': { canonical: 'PHA', family: 'PHA' },
  'BVOH': { canonical: 'BVOH', family: 'BVOH' },
  'EVA': { canonical: 'EVA', family: 'EVA' },
  'PET-CF': { canonical: 'PET-CF', family: 'PET' },
  'SBS': { canonical: 'SBS', family: 'SBS' }
};

/**
 * Normalize a material label to a canonical token + family. Never guesses
 * across families: an unknown label maps to itself as its own family.
 */
export function normalizeMaterial(raw: string | null | undefined): NormalizedMaterial | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  if (MATERIAL_ALIASES[key]) return MATERIAL_ALIASES[key];
  // Tolerate exact canonical tokens with decorations like "Generic PLA".
  for (const alias of Object.keys(MATERIAL_ALIASES).sort((a, b) => b.length - a.length)) {
    if (key === `GENERIC ${alias}`) return MATERIAL_ALIASES[alias];
  }
  return { canonical: raw.trim(), family: raw.trim().toUpperCase() };
}

/** Same canonical material (PLA+ ≠ PLA, PETG-HF ≠ PETG). */
export function sameMaterial(a: string | null, b: string | null): boolean {
  const na = normalizeMaterial(a); const nb = normalizeMaterial(b);
  return !!na && !!nb && na.canonical.toUpperCase() === nb.canonical.toUpperCase();
}

/** Same broad family (PLA+ and PLA Silk are both PLA-family). */
export function sameMaterialFamily(a: string | null, b: string | null): boolean {
  const na = normalizeMaterial(a); const nb = normalizeMaterial(b);
  return !!na && !!nb && na.family === nb.family;
}

// --- parsing ---------------------------------------------------------------

type PresetJson = Record<string, unknown>;

function firstString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function stringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

/** Nozzle diameters mentioned in compatible printer preset names, e.g. "… 0.4 nozzle". */
export function nozzlesFromPrinterNames(names: string[]): number[] {
  const out = new Set<number>();
  for (const n of names) {
    const m = /(\d+\.\d+)\s*nozzle/i.exec(n);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** Printer model portion of a compatible-printer preset name (strips nozzle suffix). */
export function printerModelsFromNames(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    out.add(n.replace(/\s+\d+\.\d+\s*nozzle.*$/i, '').trim());
  }
  return [...out];
}

/** Widest per-extruder array length among setting values. */
export function extruderCountOf(data: PresetJson): number {
  let max = 1;
  for (const [k, v] of Object.entries(data)) {
    if (k === 'compatible_printers' || k === 'compatible_prints' || k === 'filament_settings_id') continue;
    if (Array.isArray(v) && v.length > max && v.every(x => typeof x === 'string')) max = v.length;
  }
  return max;
}

const MATERIAL_KEY = 'filament_type';
const VENDOR_KEY = 'filament_vendor';

/**
 * Parse Orca-family filament preset JSON into a DetectedFilamentProfile.
 * Throws on invalid JSON; marks unrecognized schemas instead of guessing.
 */
export function parseOrcaFamilyProfile(
  slicerId: IntegrationSlicerId,
  source: ProfileSource,
  sourceType: DetectedFilamentProfile['sourceType'],
  writable: boolean
): ParsedFilamentProfile {
  const data = JSON.parse(source.json) as PresetJson;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Preset is not a JSON object');
  }

  const warnings: string[] = [];
  const name = typeof data.name === 'string' && data.name
    ? data.name
    : source.fileName.replace(/\.json$/i, '');
  const schemaRecognized =
    typeof data.name === 'string' ||
    typeof data.inherits === 'string' ||
    MATERIAL_KEY in data ||
    'filament_settings_id' in data;
  if (!schemaRecognized) {
    warnings.push('This file does not look like an Orca-family filament preset. It can be inspected but not used as a base profile.');
  }
  const from = firstString(data.from);
  if (sourceType === 'unknown' && from) {
    sourceType = from.toLowerCase() === 'system' ? 'system' : 'user';
  }

  const compatible = stringArray(data.compatible_printers);
  const material = firstString(data[MATERIAL_KEY]);
  const inherits = typeof data.inherits === 'string' && data.inherits ? data.inherits : null;

  const profile: DetectedFilamentProfile = {
    id: `${slicerId}:${sourceType}:${source.filePath ?? name}`,
    slicerId,
    name,
    vendor: firstString(data[VENDOR_KEY]),
    materialType: material,
    colorName: firstString(data.default_filament_colour) || null,
    sourceType,
    filePath: source.filePath ?? null,
    parentProfileName: inherits,
    compatiblePrinterNames: compatible,
    compatiblePrinterModels: printerModelsFromNames(compatible),
    compatibleNozzleDiameters: nozzlesFromPrinterNames(compatible),
    profileVersion: typeof data.version === 'string' ? data.version : null,
    rawProfile: data,
    infoSidecar: source.infoText ?? null,
    writable,
    warnings
  };

  return {
    profile,
    extruderCount: extruderCountOf(data),
    isDelta: !!inherits,
    schemaRecognized
  };
}

// --- fingerprinting --------------------------------------------------------

/** Stable, cheap fingerprint of a profile body (djb2 over canonical JSON). */
export function fingerprintProfile(data: unknown): string {
  const s = JSON.stringify(sortKeysDeep(data));
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  }
  return `djb2-${hash.toString(16)}-len${s.length}`;
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeysDeep((v as PresetJson)[k]);
    return out;
  }
  return v;
}

// --- clone and patch --------------------------------------------------------

export interface ClonePatchResult {
  data: PresetJson;
  changedFields: ProfileFieldChange[];
  preservedFieldCount: number;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Format a number for a preset value: trim trailing zeros, keep precision. */
export function formatPresetNumber(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Non-finite value: ${n}`);
  return String(Number(n.toFixed(4)));
}

/**
 * Clone the base preset and patch only the calibrated values.
 *
 * Rules (see docs/SLICER_PROFILE_RESEARCH.md):
 * - Every field not owned by a patch is preserved byte-for-byte (deep clone).
 * - Identity fields are re-assigned: name, filament_settings_id; from = "User";
 *   filament_id is always fresh. Cloning a system preset sets inherits to that
 *   preset's name (how Bambu saves user presets) and fills version from the
 *   resolved inheritance chain; cloning a user preset preserves both.
 * - Per-extruder arrays keep their shape. A patch writes only the target
 *   extruder index unless applyToAllExtruders is set; other positions keep
 *   their original value (including "nil").
 * - When a patched key is missing (delta preset), it is added as an array
 *   sized to the preset's extruder count, with "nil" in untouched positions —
 *   except settings where "nil" would be invalid (flow/temp), which replicate
 *   the patched value.
 */
/**
 * A fresh Bambu-style custom filament id: `P` + 7 hex, unique per generation
 * (FNV-1a over the name plus time/random). Bambu-lineage slicers key filaments
 * by `filament_id`; giving the clone a new id prevents it from being hidden
 * behind a cloud-synced parent that shares the id.
 */
export function freshFilamentId(seed: string): string {
  let h = 2166136261 >>> 0;
  const s = `${seed}|${Date.now()}|${Math.random()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return 'P' + h.toString(16).padStart(8, '0').slice(0, 7);
}

/** Slot legend for Bambu machines, in slot order. Observed on a real install:
 * H2S/P1S presets use [Standard, High Flow]; H2D TPU presets add a third
 * TPU High Flow slot; X1-era single-slot presets use [Standard]. */
const BAMBU_EXTRUDER_VARIANTS = ['Direct Drive Standard', 'Direct Drive High Flow', 'Direct Drive TPU High Flow'];

export function cloneAndPatch(args: {
  base: ParsedFilamentProfile;
  newName: string;
  patches: CalibratedFieldPatch[];
  targetExtruderIndex: number;
  applyToAllExtruders: boolean;
}): ClonePatchResult {
  const { base, newName, patches, targetExtruderIndex, applyToAllExtruders } = args;
  const src = base.profile.rawProfile as PresetJson;
  const data = deepClone(src);
  const extruders = base.extruderCount;
  const idx = Math.min(targetExtruderIndex, extruders - 1);

  if (targetExtruderIndex >= extruders && extruders > 1) {
    throw new Error(`Target extruder ${targetExtruderIndex + 1} does not exist in this profile (${extruders} extruders).`);
  }

  const changed: ProfileFieldChange[] = [];

  // Identity re-assignment (recorded but not shown as calibration changes).
  data.name = newName;
  data.from = 'User';
  if ('filament_settings_id' in data || true) data.filament_settings_id = [newName];
  // Cloud/account identity of the source must never leak into the clone.
  delete data.setting_id;
  delete data.user_id;
  // Bambu-lineage slicers dedupe filament presets by `filament_id` when signed
  // in: a clone that keeps its parent's id is hidden behind the cloud-synced
  // parent, and a preset with NO id at all is not adopted by the account
  // loader either (verified in Bambu Studio 2.7.x — neither ever appears in
  // the filament list). System leaves don't even declare a literal
  // filament_id (it lives in their abstract "@base" parent), so the id must
  // be assigned unconditionally, mirroring Bambu's "duplicate filament"
  // behavior.
  data.filament_id = freshFilamentId(newName);
  // A user preset Bambu Studio creates from a system preset inherits that
  // concrete preset by NAME (e.g. "Generic ASA @BBL H2S 0.4 nozzle"), never
  // the abstract "@base" parent a system leaf's own `inherits` points to.
  // Cloning a user preset keeps its inherits (already a concrete system name).
  if (base.profile.sourceType === 'system' && base.profile.name) {
    data.inherits = base.profile.name;
  }
  // Bambu-created user presets always carry a `version` — the vendor library
  // version from system/{Vendor}.json (resolved by the scanner); no preset in
  // the library declares it. Fill it when the clone would otherwise lack one.
  if (typeof data.version !== 'string' && base.profile.profileVersion) {
    data.version = base.profile.profileVersion;
  }
  // Bambu Studio user presets never carry system-preset plumbing: `type`,
  // `instantiation`, and `include` appear in NO preset Bambu itself writes
  // into an account folder (verified across a real account's 70+ presets),
  // and `include` references template files that do not resolve from user
  // dirs. Everything they provided still flows through `inherits` → the
  // concrete system leaf. Working presets also all declare
  // `filament_extruder_variant` — the legend mapping each per-slot array
  // position to hardware; variant-aware Bambu Studio (2.7+) does not show a
  // user preset without it.
  if (base.profile.slicerId === 'bambu') {
    delete data.type;
    delete data.instantiation;
    delete data.include;
    if (!Array.isArray(data.filament_extruder_variant)) {
      data.filament_extruder_variant = BAMBU_EXTRUDER_VARIANTS.slice(0, Math.max(1, extruders));
    }
  }

  // Keys that may not hold "nil" (the slicer requires a concrete value).
  const NO_NIL = new Set(['nozzle_temperature', 'nozzle_temperature_initial_layer', 'filament_flow_ratio', 'filament_max_volumetric_speed', 'pressure_advance']);

  for (const patch of patches) {
    const key = patch.presetKey;
    const after = formatPresetNumber(patch.value);
    const existing = data[key];
    let arr: string[];
    if (Array.isArray(existing) && existing.every(x => typeof x === 'string') && existing.length > 0) {
      arr = [...(existing as string[])];
      // Preserve array shape; pad only if the profile itself is wider.
      while (arr.length < extruders) arr.push(arr[arr.length - 1]);
    } else {
      const fill = NO_NIL.has(key) ? after : 'nil';
      arr = new Array(extruders).fill(fill) as string[];
    }

    const targets = applyToAllExtruders ? arr.map((_, i) => i) : [idx];
    for (const t of targets) {
      const before = Array.isArray(existing) && typeof (existing as unknown[])[t] === 'string'
        ? (existing as string[])[t]
        : null;
      if (before !== after) {
        changed.push({
          presetKey: key, label: patch.label, before, after, unit: patch.unit,
          extruderIndex: extruders > 1 ? t : undefined
        });
      }
      arr[t] = after;
    }
    data[key] = arr;

    for (const comp of patch.companions ?? []) {
      const compExisting = data[comp.presetKey];
      const compBefore = firstString(compExisting);
      if (compBefore !== comp.value) {
        const compArr = Array.isArray(compExisting) && compExisting.length > 0
          ? (compExisting as string[]).map(() => comp.value)
          : new Array(extruders).fill(comp.value) as string[];
        data[comp.presetKey] = compArr;
        changed.push({ presetKey: comp.presetKey, label: comp.presetKey, before: compBefore, after: comp.value });
      }
    }
  }

  const preservedFieldCount = Object.keys(src).filter(k =>
    !['name', 'from', 'filament_settings_id', 'setting_id', 'user_id'].includes(k) &&
    !patches.some(p => p.presetKey === k || (p.companions ?? []).some(c => c.presetKey === k))
  ).length;

  return { data, changedFields: changed, preservedFieldCount };
}

// --- serialization ----------------------------------------------------------

/**
 * Serialize a preset the way the slicers write them: 4-space indent,
 * keys in stable sorted order (observed in real presets), trailing newline.
 */
export function serializePreset(data: PresetJson): string {
  return JSON.stringify(sortKeysDeep(data), null, 4) + '\n';
}

/** Build the .info sidecar for a newly created local preset. */
export function buildInfoSidecar(args: { baseId: string | null; nowUnixSeconds?: number }): string {
  const t = args.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  return [
    'sync_info = create',
    'user_id = ',
    'setting_id = ',
    `base_id = ${args.baseId ?? ''}`,
    `updated_time = ${t}`,
    ''
  ].join('\n');
}

/**
 * Stamp the owning account into a .info sidecar. Presets Bambu Studio itself
 * writes into an account folder carry `user_id = <account>`; a preset with an
 * empty user_id in a signed-in account folder is not adopted into the account's
 * preset list. Called at install time, when the target location is known.
 */
export function withInfoUserId(infoText: string, userId: string): string {
  return infoText.replace(/^user_id\s*=.*$/m, `user_id = ${userId}`);
}

/** Extract a key from .info sidecar text. */
export function infoValue(infoText: string | null, key: string): string | null {
  if (!infoText) return null;
  const m = new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm').exec(infoText);
  return m ? m[1].trim() : null;
}

// --- naming -----------------------------------------------------------------

/** Characters invalid in Windows/macOS file names (preset name is the file stem). */
const INVALID_FILENAME_CHARS = /[<>:"\/\\|?*\u0000-\u001f]/g;

export function sanitizeProfileName(name: string): string {
  return name.replace(INVALID_FILENAME_CHARS, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
}

export function defaultProfileName(args: {
  manufacturer: string; material: string; color?: string;
  printerName?: string; nozzle?: number;
}): string {
  const core = ['PerfectFit -', args.manufacturer, args.material, args.color].filter(Boolean).join(' ');
  const suffix = args.printerName ? ` @ ${args.printerName}${args.nozzle ? ` ${args.nozzle}` : ''}` : '';
  return sanitizeProfileName(core + suffix);
}
