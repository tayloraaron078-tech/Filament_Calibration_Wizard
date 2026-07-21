// ---------------------------------------------------------------------------
// Diff between the base profile and the generated profile: the calibrated
// changes (already tracked field-by-field) plus a complete JSON diff for
// advanced users. Unchanged fields never appear as changes.
// ---------------------------------------------------------------------------

import type { GeneratedFilamentProfile, ProfileFieldChange } from './types';

export interface JsonDiffEntry {
  key: string;
  kind: 'added' | 'removed' | 'changed';
  before: string | null;
  after: string | null;
}

/** Identity keys expected to differ between base and clone. filament_id is
 * always regenerated; inherits/version are rewritten when cloning a system
 * preset (validation enforces the exact expected values). */
const IDENTITY_KEYS = new Set(['name', 'filament_settings_id', 'from', 'setting_id', 'user_id', 'filament_id', 'inherits', 'version']);

export function fullJsonDiff(
  base: Record<string, unknown>,
  generated: Record<string, unknown>
): JsonDiffEntry[] {
  const out: JsonDiffEntry[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(generated)]);
  for (const key of [...keys].sort()) {
    const b = key in base ? JSON.stringify(base[key]) : null;
    const g = key in generated ? JSON.stringify(generated[key]) : null;
    if (b === g) continue;
    out.push({
      key,
      kind: b === null ? 'added' : g === null ? 'removed' : 'changed',
      before: b,
      after: g
    });
  }
  return out;
}

export interface DiffSummary {
  calibrated: ProfileFieldChange[];
  identity: JsonDiffEntry[];
  /** Anything else that differs — must be empty for a clean clone-and-patch. */
  unexpected: JsonDiffEntry[];
  preservedFieldCount: number;
}

/**
 * Split the full diff into calibrated changes, expected identity changes,
 * and unexpected drift (which validation treats as an error).
 */
export function summarizeDiff(
  baseRaw: Record<string, unknown>,
  generated: GeneratedFilamentProfile
): DiffSummary {
  const full = fullJsonDiff(baseRaw, generated.data);
  const calibratedKeys = new Set(generated.changedFields.map(c => c.presetKey));
  const identity: JsonDiffEntry[] = [];
  const unexpected: JsonDiffEntry[] = [];
  for (const entry of full) {
    if (calibratedKeys.has(entry.key)) continue; // shown via changedFields
    if (IDENTITY_KEYS.has(entry.key)) identity.push(entry);
    else unexpected.push(entry);
  }
  return {
    calibrated: generated.changedFields,
    identity,
    unexpected,
    preservedFieldCount: generated.preservedFieldCount
  };
}

/** Human-readable one-line rendering of a field change. */
export function formatChange(c: ProfileFieldChange): string {
  const unit = c.unit ? ` ${c.unit}` : '';
  const tool = c.extruderIndex !== undefined ? ` (slot ${c.extruderIndex + 1})` : '';
  const before = c.before === null || c.before === 'nil' ? '(printer default)' : `${c.before}${unit}`;
  return `${c.label}${tool}: ${before} → ${c.after}${unit}`;
}
