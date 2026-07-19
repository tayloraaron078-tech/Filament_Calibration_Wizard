// ---------------------------------------------------------------------------
// Diagnostic report for the profile installer. Redacts the user's home
// directory; never includes photos, calibration backups, or credentials.
// ---------------------------------------------------------------------------

import type { SlicerInstallation } from './types';
import { isDesktop } from './bridge';
import { findVerifiedVersion } from './registry';
import type { Platform } from './types';

export function redactPath(p: string | null): string {
  if (!p) return '(none)';
  return p
    .replace(/\\Users\\[^\\]+/i, '\\Users\\<redacted>')
    .replace(/\/Users\/[^/]+/, '/Users/<redacted>')
    .replace(/\/home\/[^/]+/, '/home/<redacted>');
}

export interface DiagnosticsInput {
  appVersion: string;
  platform: Platform;
  installations: SlicerInstallation[];
  extra?: string[];
}

export function buildDiagnosticReport(input: DiagnosticsInput): string {
  const lines: string[] = [];
  lines.push('PerfectFit Profile Installer — Diagnostic Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`App version: ${input.appVersion}`);
  lines.push(`Mode: ${isDesktop() ? 'desktop (Tauri)' : 'browser/PWA'}`);
  lines.push(`Platform: ${input.platform}`);
  lines.push('');
  if (input.installations.length === 0) {
    lines.push('Detected slicers: none');
  }
  for (const inst of input.installations) {
    lines.push(`— ${inst.displayName}`);
    lines.push(`   version: ${inst.version ?? 'unknown'}`);
    lines.push(`   detection confidence: ${inst.confidence}`);
    lines.push(`   executable: ${redactPath(inst.executablePath)}`);
    lines.push(`   data dir: ${redactPath(inst.dataDirectory)}`);
    const verified = findVerifiedVersion(inst.slicerId, inst.version, input.platform);
    lines.push(`   verified for: scan=${verified?.profileScanVerified ?? false} generate=${verified?.profileGenerationVerified ?? false} direct-install=${verified?.directInstallVerified ?? false}`);
    lines.push(`   capabilities: install=${inst.capabilities.canInstallDirectly} export=${inst.capabilities.canExportProfiles} scan=${inst.capabilities.canScanProfiles}`);
    for (const loc of inst.userDataLocations) {
      lines.push(`   location [${loc.accountId === 'default' ? 'local' : 'account'}]: ${redactPath(loc.path)} — ${loc.filamentProfileCount} filament preset(s)${loc.active ? ' (active)' : ''}`);
    }
    for (const n of inst.notes) lines.push(`   note: ${n}`);
  }
  for (const e of input.extra ?? []) {
    lines.push('');
    lines.push(e);
  }
  return lines.join('\n');
}
