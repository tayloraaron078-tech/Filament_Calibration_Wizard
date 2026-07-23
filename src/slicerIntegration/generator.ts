// ---------------------------------------------------------------------------
// Clone-and-patch profile generation.
//
// The base profile is deep-cloned; ONLY values backed by a completed
// calibration step (or an explicit user choice upstream in the UI) are
// patched. Unknown fields, arrays, and inheritance survive untouched.
// ---------------------------------------------------------------------------

import type { CalibrationProject } from '../types';
import type {
  CalibratedFieldPatch, GeneratedFilamentProfile, ParsedFilamentProfile, ProfileGenerationRequest
} from './types';
import {
  buildInfoSidecar, cloneAndPatch, fingerprintProfile, formatPresetNumber, infoValue, serializePreset
} from './orcaFamily';

/** Marker so a re-generated profile replaces (not stacks) our injected line. */
const PA_GCODE_MARKER = '; PerfectFit pressure advance';

/**
 * Field mapping from PerfectFit calibration results to Orca-family preset
 * keys (verified against real presets from all five slicers — see
 * docs/SLICER_PROFILE_RESEARCH.md "Calibrated-field mapping").
 *
 * A value is only offered when its calibration step is completed AND the
 * final value exists. Defaults or suggestions are never patched.
 */
export function buildPatchesFromProject(project: CalibrationProject): CalibratedFieldPatch[] {
  const out: CalibratedFieldPatch[] = [];
  const steps = project.steps;
  const finals = project.finals;
  const done = (id: keyof typeof steps): boolean => steps[id]?.status === 'completed';

  // First-layer temperature is emitted before the other-layers value so the
  // review list matches the slicer's own field order (both Orca and Bambu put
  // nozzle_temperature_initial_layer above nozzle_temperature on the Filament
  // tab). Patch order has no effect on the generated preset itself.
  if (done('temperature') && finals.nozzleTemp !== undefined) {
    if (finals.firstLayerTemp !== undefined) {
      out.push({
        sourceKey: 'firstLayerTemp', presetKey: 'nozzle_temperature_initial_layer',
        label: 'First layer nozzle temperature', value: finals.firstLayerTemp, unit: '°C'
      });
    }
    out.push({
      sourceKey: 'nozzleTemp', presetKey: 'nozzle_temperature',
      label: 'Nozzle temperature', value: finals.nozzleTemp, unit: '°C'
    });
  }
  if ((done('flow-verify') || done('flow-pass2') || done('flow-pass1')) && finals.flowRatio !== undefined) {
    out.push({
      sourceKey: 'flowRatio', presetKey: 'filament_flow_ratio',
      label: 'Flow ratio', value: finals.flowRatio, unit: ''
    });
  }
  if (done('pressure-advance') && finals.pressureAdvance !== undefined) {
    out.push({
      sourceKey: 'pressureAdvance', presetKey: 'pressure_advance',
      label: 'Pressure advance', value: finals.pressureAdvance, unit: '',
      companions: [{ presetKey: 'enable_pressure_advance', value: '1' }]
    });
  }
  if (done('retraction')) {
    if (finals.retractionDistance !== undefined) {
      out.push({
        sourceKey: 'retractionDistance', presetKey: 'filament_retraction_length',
        label: 'Retraction length', value: finals.retractionDistance, unit: 'mm'
      });
    }
    // Retraction speed is patched only when the retraction test actually
    // calibrated it (finals.retractionSpeed is set by the wizard only then).
    if (finals.retractionSpeed !== undefined) {
      out.push({
        sourceKey: 'retractionSpeed', presetKey: 'filament_retraction_speed',
        label: 'Retraction speed', value: finals.retractionSpeed, unit: 'mm/s'
      });
    }
  }
  if (done('max-volumetric-speed') && finals.maxVolumetricSpeed !== undefined) {
    out.push({
      sourceKey: 'maxVolumetricSpeed', presetKey: 'filament_max_volumetric_speed',
      label: 'Maximum volumetric speed', value: finals.maxVolumetricSpeed, unit: 'mm³/s'
    });
  }
  // Orca-family presets store shrinkage as a percent string (e.g. "99.4%").
  if (done('shrinkage') && finals.shrinkagePercent !== undefined) {
    out.push({
      sourceKey: 'shrinkagePercent', presetKey: 'filament_shrink',
      label: 'Shrinkage (XY)', value: finals.shrinkagePercent, unit: '%', valueSuffix: '%'
    });
  }
  return out;
}

/**
 * Generate the new profile from a parsed base + patches. Pure function of its
 * inputs; never touches the source profile.
 */
export function generateProfile(
  request: ProfileGenerationRequest,
  parsedBase: ParsedFilamentProfile
): GeneratedFilamentProfile {
  const { data, changedFields, preservedFieldCount } = cloneAndPatch({
    base: parsedBase,
    newName: request.newName,
    patches: request.patches,
    targetExtruderIndex: request.targetExtruderIndex,
    applyToAllExtruders: request.applyToAllExtruders
  });

  // Bambu Studio only: bake pressure advance into the filament start g-code.
  // Bambu Studio ignores the native pressure_advance field for Bambu machines
  // (proven: the field never reaches the g-code — the machine's Flow Dynamics
  // owns PA), so an M900 in start g-code is the only path that applies the
  // calibrated K. Matches the exact command Orca itself emits for Bambu
  // printers. Requires Flow Dynamics = Off in the Send-print-job dialog.
  const paPatch = request.patches.find(p => p.presetKey === 'pressure_advance');
  if (request.bakePressureAdvanceGcode && request.slicerId === 'bambu' && paPatch) {
    const before = firstStartGcode(data);
    const k = formatPresetNumber(paPatch.value);
    const line = `M900 K${k} L1000 M10 ${PA_GCODE_MARKER}`;
    injectFilamentStartGcode(data, line);
    changedFields.push({
      presetKey: 'filament_start_gcode',
      label: 'Pressure advance (baked into start g-code for Bambu Studio)',
      before, after: firstStartGcode(data) ?? ''
    });
  }

  const serialized = serializePreset(data);

  // base_id links the new preset to the STOCK/system ancestor it derives from.
  // - Cloning a system (stock) preset: use that preset's own setting_id.
  // - Cloning a user/cloud preset (Advanced mode): do NOT reuse the user
  //   preset's cloud setting_id (a "PFUS…" user id) — that ties the clone to
  //   another user preset and Bambu hides it behind that parent. Chain to the
  //   parent's own base_id (its system ancestor) instead, or leave empty.
  const baseRaw = parsedBase.profile.rawProfile as Record<string, unknown>;
  const baseId = parsedBase.profile.sourceType === 'system'
    ? ((typeof baseRaw.setting_id === 'string' ? baseRaw.setting_id : null)
        || infoValue(parsedBase.profile.infoSidecar, 'setting_id')
        || null)
    : (infoValue(parsedBase.profile.infoSidecar, 'base_id') || null);

  return {
    slicerId: request.slicerId,
    name: request.newName,
    fileStem: request.newName,
    data,
    serialized,
    infoText: buildInfoSidecar({ baseId }),
    baseProfileName: parsedBase.profile.name,
    baseProfileFingerprint: fingerprintProfile(parsedBase.profile.rawProfile),
    changedFields,
    preservedFieldCount,
    generatedAt: new Date().toISOString()
  };
}

/** First element of the filament_start_gcode array, or null. */
function firstStartGcode(data: Record<string, unknown>): string | null {
  const v = data['filament_start_gcode'];
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
}

/**
 * Append `line` to every element of filament_start_gcode, first removing any
 * previously injected PerfectFit line (so regenerating replaces rather than
 * stacks). Creates the key if absent. Preserves the array shape (per-extruder
 * variant slots) the base profile uses.
 */
function injectFilamentStartGcode(data: Record<string, unknown>, line: string): void {
  const existing = data['filament_start_gcode'];
  const strip = (s: string) =>
    s.split('\n').filter(l => !l.includes(PA_GCODE_MARKER)).join('\n').replace(/\n+$/, '');
  if (Array.isArray(existing) && existing.length > 0 && existing.every(x => typeof x === 'string')) {
    data['filament_start_gcode'] = (existing as string[]).map(s => {
      const base = strip(s);
      return base ? `${base}\n${line}` : line;
    });
  } else {
    data['filament_start_gcode'] = [line];
  }
}
