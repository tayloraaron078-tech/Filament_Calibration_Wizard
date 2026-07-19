// ---------------------------------------------------------------------------
// Adapter registry. Each adapter owns its slicer's verified quirks; shared
// Orca-family parsing/generation lives in ../orcaFamily.ts and is reused,
// never assumed identical — every adapter decides its own classification and
// filtering rules.
// ---------------------------------------------------------------------------

import type { IntegrationSlicerId } from '../types';
import type { SlicerAdapter } from './adapterTypes';
import { orcaAdapter } from './orca';
import { bambuAdapter } from './bambu';
import { snapmakerOrcaAdapter } from './snapmakerOrca';
import { elegooSlicerAdapter } from './elegooSlicer';
import { flashStudioAdapter } from './flashStudio';

const ADAPTERS: Record<IntegrationSlicerId, SlicerAdapter> = {
  'orca': orcaAdapter,
  'bambu': bambuAdapter,
  'snapmaker-orca': snapmakerOrcaAdapter,
  'elegoo': elegooSlicerAdapter,
  'flash-studio': flashStudioAdapter
};

export function getAdapter(id: IntegrationSlicerId): SlicerAdapter {
  const a = ADAPTERS[id];
  if (!a) throw new Error(`No adapter for slicer: ${id}`);
  return a;
}

export function allAdapters(): SlicerAdapter[] {
  return Object.values(ADAPTERS);
}
