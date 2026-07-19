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
  buildInfoSidecar, cloneAndPatch, fingerprintProfile, infoValue, serializePreset
} from './orcaFamily';

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

  if (done('temperature') && finals.nozzleTemp !== undefined) {
    out.push({
      sourceKey: 'nozzleTemp', presetKey: 'nozzle_temperature',
      label: 'Nozzle temperature', value: finals.nozzleTemp, unit: '°C'
    });
    if (finals.firstLayerTemp !== undefined) {
      out.push({
        sourceKey: 'firstLayerTemp', presetKey: 'nozzle_temperature_initial_layer',
        label: 'First layer nozzle temperature', value: finals.firstLayerTemp, unit: '°C'
      });
    }
  }
  if ((done('flow-pass2') || done('flow-pass1')) && finals.flowRatio !== undefined) {
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

  const serialized = serializePreset(data);

  // base_id: the base profile's own setting/base id when the sidecar has one
  // (system bases carry setting_id inside the preset itself).
  const baseRaw = parsedBase.profile.rawProfile as Record<string, unknown>;
  const baseId =
    infoValue(parsedBase.profile.infoSidecar, 'setting_id') ||
    (typeof baseRaw.setting_id === 'string' ? baseRaw.setting_id : null) ||
    infoValue(parsedBase.profile.infoSidecar, 'base_id') ||
    null;

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
