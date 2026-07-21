// ---------------------------------------------------------------------------
// Profile validation — runs before export and again before installation.
// Errors block installation; material warnings require acknowledgement.
// Values are never silently clamped: conflicts are reported with both values.
// ---------------------------------------------------------------------------

import type { CalibrationProject, PrinterProfile } from '../types';
import type {
  DetectedFilamentProfile, GeneratedFilamentProfile, ProfileValidationResult, ValidationMessage
} from './types';
import { extruderCountOf, sameMaterialFamily } from './orcaFamily';
import { summarizeDiff } from './diff';
import { projectMaterialLabel } from './recommendations';

export interface ValidationContext {
  project: CalibrationProject;
  printer?: PrinterProfile;
  baseProfile: DetectedFilamentProfile;
  /** Names of presets already present at the destination (duplicate check). */
  existingProfileNames?: string[];
  /** Values the user explicitly acknowledged despite warnings. */
  acknowledgedWarningCodes?: string[];
}

const err = (code: string, message: string): ValidationMessage => ({ code, message });
const warn = (code: string, message: string, ack = false): ValidationMessage =>
  ({ code, message, requiresAcknowledgement: ack });

export function validateGeneratedProfile(
  generated: GeneratedFilamentProfile,
  ctx: ValidationContext
): ProfileValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const unresolved: string[] = [];

  // --- parseable output & round trip ---------------------------------------
  let reparsed: Record<string, unknown> | null = null;
  try {
    reparsed = JSON.parse(generated.serialized) as Record<string, unknown>;
  } catch (e) {
    errors.push(err('SERIALIZE_INVALID', `Generated profile does not re-parse: ${String(e)}`));
  }

  const baseRaw = ctx.baseProfile.rawProfile as Record<string, unknown>;

  if (reparsed) {
    // Round-trip: every base key must exist in the output (unknown fields
    // survive), except identity keys we intentionally remove.
    const removedOk = new Set(['setting_id', 'user_id']);
    for (const key of Object.keys(baseRaw)) {
      if (!(key in reparsed) && !removedOk.has(key)) {
        errors.push(err('FIELD_LOST', `Field lost in generation: ${key}`));
      }
    }

    // Required identity fields.
    if (typeof reparsed.name !== 'string' || !reparsed.name) {
      errors.push(err('NAME_MISSING', 'Generated profile has no name.'));
    } else if (reparsed.name !== generated.name) {
      errors.push(err('NAME_MISMATCH', 'Preset name does not match the requested profile name.'));
    }
    if (reparsed.from !== 'User') {
      errors.push(err('FROM_INVALID', 'Generated profile must be a user preset (from = "User").'));
    }
    const fsid = reparsed.filament_settings_id;
    if (!Array.isArray(fsid) || fsid[0] !== generated.name) {
      errors.push(err('SETTINGS_ID_MISMATCH', 'filament_settings_id must equal the preset name.'));
    }
    if ('version' in baseRaw && reparsed.version !== baseRaw.version) {
      errors.push(err('VERSION_DRIFT', 'Preset schema version must be copied from the base profile.'));
    }
    // Cloning a system preset must inherit that preset by name (how the
    // slicer saves user presets); cloning a user preset preserves its
    // inherits (already a concrete system name).
    const expectedInherits = ctx.baseProfile.sourceType === 'system' && ctx.baseProfile.name
      ? ctx.baseProfile.name
      : ('inherits' in baseRaw ? baseRaw.inherits : undefined);
    if (expectedInherits !== undefined && reparsed.inherits !== expectedInherits) {
      errors.push(err('INHERITS_DRIFT', `Generated profile must inherit "${String(expectedInherits)}".`));
    }
    // Bambu-lineage slicers key filaments by filament_id; a clone without its
    // own fresh id is ignored or hidden behind the preset it was cloned from.
    if (typeof reparsed.filament_id !== 'string' || !reparsed.filament_id) {
      errors.push(err('FILAMENT_ID_MISSING', 'Generated profile must carry its own filament_id.'));
    } else if (typeof baseRaw.filament_id === 'string' && baseRaw.filament_id === reparsed.filament_id) {
      errors.push(err('FILAMENT_ID_COLLISION', 'filament_id must differ from the base profile (the slicer hides id collisions).'));
    }

    // Array shape: no per-extruder array may change length vs the base.
    const baseCount = extruderCountOf(baseRaw);
    const genCount = extruderCountOf(reparsed);
    if (genCount !== baseCount) {
      errors.push(err('EXTRUDER_SHAPE', `Extruder array shape changed (${baseCount} → ${genCount}).`));
    }

    // No unexpected drift beyond calibrated + identity fields.
    const diff = summarizeDiff(baseRaw, generated);
    for (const u of diff.unexpected) {
      errors.push(err('UNEXPECTED_CHANGE', `Unexpected change to field "${u.key}" — clone-and-patch must not alter it.`));
    }
  }

  // --- changed-field sanity --------------------------------------------------
  if (generated.changedFields.length === 0) {
    warnings.push(warn('NO_CHANGES', 'No calibrated values were applied — the new profile is an identical copy of the base.', true));
  }
  for (const c of generated.changedFields) {
    const n = Number(c.after);
    if (!Number.isFinite(n)) {
      errors.push(err('NON_FINITE', `${c.label}: value "${c.after}" is not a finite number.`));
    }
  }

  // --- numeric limits (never clamped — reported with both values) -----------
  const printer = ctx.printer;
  const get = (key: string): number | undefined => {
    const c = generated.changedFields.find(f => f.presetKey === key);
    return c ? Number(c.after) : undefined;
  };
  const nozzleTemp = get('nozzle_temperature');
  if (nozzleTemp !== undefined) {
    if (printer && nozzleTemp > printer.maxNozzleTemp) {
      errors.push(err('TEMP_OVER_PRINTER_MAX',
        `Nozzle temperature ${nozzleTemp} °C exceeds this printer's maximum of ${printer.maxNozzleTemp} °C. Correct the value or the printer limit before installing.`));
    }
    if (nozzleTemp < 140 || nozzleTemp > 450) {
      errors.push(err('TEMP_IMPLAUSIBLE', `Nozzle temperature ${nozzleTemp} °C is outside the plausible printing range (140–450 °C).`));
    }
  }
  const flow = get('filament_flow_ratio');
  if (flow !== undefined && (flow < 0.5 || flow > 1.5)) {
    errors.push(err('FLOW_IMPLAUSIBLE', `Flow ratio ${flow} is outside the plausible range (0.5–1.5).`));
  }
  const pa = get('pressure_advance');
  if (pa !== undefined && (pa < 0 || pa > 2)) {
    errors.push(err('PA_IMPLAUSIBLE', `Pressure advance ${pa} is outside the plausible range (0–2).`));
  }
  const retract = get('filament_retraction_length');
  if (retract !== undefined && (retract < 0 || retract > 15)) {
    errors.push(err('RETRACT_IMPLAUSIBLE', `Retraction length ${retract} mm is outside the plausible range (0–15 mm).`));
  }
  const mvs = get('filament_max_volumetric_speed');
  if (mvs !== undefined) {
    if (mvs <= 0 || mvs > 100) {
      errors.push(err('MVS_IMPLAUSIBLE', `Maximum volumetric speed ${mvs} mm³/s is outside the plausible range (0–100).`));
    }
    if (printer?.maxVolumetricFlow && mvs > printer.maxVolumetricFlow) {
      warnings.push(warn('MVS_OVER_PRINTER',
        `Calibrated max volumetric speed (${mvs} mm³/s) exceeds the printer profile's stated capability (${printer.maxVolumetricFlow} mm³/s). Install only if you trust the calibration result.`, true));
    }
  }

  // --- material match ---------------------------------------------------------
  const projMat = projectMaterialLabel(ctx.project);
  if (ctx.baseProfile.materialType && !sameMaterialFamily(ctx.baseProfile.materialType, projMat)) {
    warnings.push(warn('MATERIAL_FAMILY_MISMATCH',
      `Base profile material (${ctx.baseProfile.materialType}) is a different family than the calibrated filament (${projMat}).`, true));
  }

  // --- duplicate name ---------------------------------------------------------
  const existing = ctx.existingProfileNames ?? [];
  if (existing.some(n => n.trim().toLowerCase() === generated.name.trim().toLowerCase())) {
    warnings.push(warn('DUPLICATE_NAME',
      `A preset named “${generated.name}” already exists at the destination. Installing will require choosing replace, rename, or numbered copy.`));
  }

  // --- inheritance -------------------------------------------------------------
  if (ctx.baseProfile.parentProfileName) {
    // Full resolution happens in the slicer; we record it as informational.
    unresolved.push(ctx.baseProfile.parentProfileName);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    preservedFieldCount: generated.preservedFieldCount,
    changedFields: generated.changedFields,
    unresolvedFields: unresolved
  };
}

/** Warnings that still need explicit acknowledgement before install. */
export function unacknowledgedWarnings(
  result: ProfileValidationResult,
  acknowledged: string[]
): ValidationMessage[] {
  return result.warnings.filter(w => w.requiresAcknowledgement && !acknowledged.includes(w.code));
}
