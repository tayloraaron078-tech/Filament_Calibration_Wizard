// Snapmaker Orca adapter. Verified against Snapmaker Orca 01.10.01.50 on
// Windows 11 (docs/SLICER_PROFILE_RESEARCH.md, 2026-07-19). Snapmaker U1 is
// a multi-toolhead system: tool-specific values may appear as arrays.

import { makeOrcaFamilyAdapter } from './orcaFamilyBase';

export const snapmakerOrcaAdapter = makeOrcaFamilyAdapter({
  id: 'snapmaker-orca',
  displayName: 'Snapmaker Orca',
  family: 'orca',
  quirks: {
    extraWarnings: (parsed) => {
      const w: string[] = [];
      if (parsed.extruderCount > 1) {
        w.push(`This profile carries per-toolhead settings (${parsed.extruderCount} tools). Choose which tool the calibration applies to before installing.`);
      }
      return w;
    }
  }
});
