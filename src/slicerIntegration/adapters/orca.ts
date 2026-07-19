// Orca Slicer adapter. Verified against Orca Slicer 2.4.2 on Windows 11
// (docs/SLICER_PROFILE_RESEARCH.md, 2026-07-19).

import { makeOrcaFamilyAdapter } from './orcaFamilyBase';

export const orcaAdapter = makeOrcaFamilyAdapter({
  id: 'orca',
  displayName: 'Orca Slicer',
  family: 'orca',
  quirks: {
    cloudSyncWarning:
      'This preset lives in an Orca account folder. Orca Slicer may sync, duplicate, or re-identify presets in this folder when logged in.'
  }
});
