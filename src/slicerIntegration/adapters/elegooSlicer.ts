// ElegooSlicer adapter. Verified against ElegooSlicer 1.5.2.2 on Windows 11
// (docs/SLICER_PROFILE_RESEARCH.md, 2026-07-19). Quirk: machine preset JSON
// files can sit directly in the user root; the native scanner only reads
// user/*/filament so they never reach this adapter.

import { makeOrcaFamilyAdapter } from './orcaFamilyBase';

export const elegooSlicerAdapter = makeOrcaFamilyAdapter({
  id: 'elegoo',
  displayName: 'ElegooSlicer',
  family: 'orca'
});
