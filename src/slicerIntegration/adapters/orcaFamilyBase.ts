// Shared implementation backbone for Orca-family adapters. Each concrete
// adapter passes its own id/quirks; nothing here assumes the forks are
// identical beyond the verified common preset shape.

import type { RawProfileFile } from '../bridge';
import type {
  IntegrationSlicerId, ParsedFilamentProfile, ProfileSource, ProfileSourceType, SlicerFamily
} from '../types';
import { parseOrcaFamilyProfile } from '../orcaFamily';
import type { SlicerAdapter } from './adapterTypes';

export interface OrcaFamilyQuirks {
  /** Extra warnings for cloud/account-bound locations. */
  cloudSyncWarning?: string;
  /** Additional per-profile warnings. */
  extraWarnings?: (parsed: ParsedFilamentProfile, raw?: RawProfileFile) => string[];
}

export function makeOrcaFamilyAdapter(args: {
  id: IntegrationSlicerId;
  displayName: string;
  family: SlicerFamily;
  quirks?: OrcaFamilyQuirks;
}): SlicerAdapter {
  const { id, displayName, family, quirks } = args;

  const classifySource = (raw: RawProfileFile): ProfileSourceType => {
    switch (raw.dir_kind) {
      case 'system': return 'system';
      case 'user_base': return 'project';
      case 'user': return raw.account_id && raw.account_id !== 'default' ? 'cloud' : 'user';
      default: return 'unknown';
    }
  };

  return {
    id,
    displayName,
    family,
    classifySource,
    parseProfile(source: ProfileSource, raw?: RawProfileFile): ParsedFilamentProfile | null {
      const sourceType: ProfileSourceType = raw ? classifySource(raw) : 'manual';
      // System presets: only filament-typed files are presets; vendor index
      // files and abstract nodes without instantiation are filtered for the
      // selection list (abstract nodes stay available for inheritance later).
      const parsed = parseOrcaFamilyProfile(id, source, sourceType, raw?.writable ?? false);
      const data = parsed.profile.rawProfile as Record<string, unknown>;
      if (sourceType === 'system') {
        if (data.type !== 'filament') return null;
        if (data.instantiation === 'false') return null; // abstract intermediate node
      }
      if (sourceType === 'project') {
        parsed.profile.warnings.push('Cached filament-library preset (filament/base). Usable as a clone source; PerfectFit will not modify it.');
      }
      if (sourceType === 'cloud' && quirks?.cloudSyncWarning) {
        parsed.profile.warnings.push(quirks.cloudSyncWarning);
      }
      parsed.profile.warnings.push(...(quirks?.extraWarnings?.(parsed, raw) ?? []));
      return parsed;
    },
    profileWarnings(parsed: ParsedFilamentProfile, raw?: RawProfileFile): string[] {
      return quirks?.extraWarnings?.(parsed, raw) ?? [];
    }
  };
}
