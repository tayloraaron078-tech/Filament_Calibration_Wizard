import type { RawProfileFile } from '../bridge';
import type {
  IntegrationSlicerId, ParsedFilamentProfile, ProfileSource, ProfileSourceType, SlicerFamily
} from '../types';

/**
 * Per-slicer adapter. Parsing may reuse the shared Orca-family engine but each
 * adapter keeps its own classification/filter rules and quirks.
 */
export interface SlicerAdapter {
  id: IntegrationSlicerId;
  displayName: string;
  family: SlicerFamily;

  /**
   * Parse one scanned file into a profile, or return null when the file is
   * not a filament preset this adapter recognizes (e.g. an index file).
   * `raw` is present for scanned files, absent for manual selections.
   */
  parseProfile(source: ProfileSource, raw?: RawProfileFile): ParsedFilamentProfile | null;

  /** Classify a scanned file's origin. */
  classifySource(raw: RawProfileFile): ProfileSourceType;

  /** Adapter-specific warnings to attach to a parsed profile. */
  profileWarnings(parsed: ParsedFilamentProfile, raw?: RawProfileFile): string[];
}
