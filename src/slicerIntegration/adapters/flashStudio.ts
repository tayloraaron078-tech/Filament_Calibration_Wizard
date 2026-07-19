// Flash Studio Desktop (Orca-Flashforge) adapter. Verified against
// Orca-Flashforge 01.10.01.50 on Windows 11 (docs/SLICER_PROFILE_RESEARCH.md,
// 2026-07-19). Quirk: some presets ship without .info sidecars — the sidecar
// is treated as optional everywhere in this subsystem.

import { makeOrcaFamilyAdapter } from './orcaFamilyBase';

export const flashStudioAdapter = makeOrcaFamilyAdapter({
  id: 'flash-studio',
  displayName: 'Flash Studio (Orca-Flashforge)',
  family: 'orca'
});
