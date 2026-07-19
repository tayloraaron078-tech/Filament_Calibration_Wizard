// Bambu Studio adapter. Verified against Bambu Studio 02.07.01.62 on
// Windows 11 (docs/SLICER_PROFILE_RESEARCH.md, 2026-07-19). Bambu user
// presets are often full snapshots (inherits: "") with per-nozzle arrays on
// dual-nozzle machines (H2 family).

import { makeOrcaFamilyAdapter } from './orcaFamilyBase';

export const bambuAdapter = makeOrcaFamilyAdapter({
  id: 'bambu',
  displayName: 'Bambu Studio',
  family: 'bambu',
  quirks: {
    cloudSyncWarning:
      'This preset belongs to a Bambu account and may be cloud-synchronized. Bambu Studio can later sync, duplicate, replace, or remove local preset files in account folders.',
    extraWarnings: (parsed) => {
      const w: string[] = [];
      if (parsed.extruderCount > 1) {
        w.push(`This profile carries settings for ${parsed.extruderCount} nozzles/extruders. Calibrated values will be applied to the nozzle you select.`);
      }
      return w;
    }
  }
});
