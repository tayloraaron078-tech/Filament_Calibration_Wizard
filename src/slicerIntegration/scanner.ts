// ---------------------------------------------------------------------------
// Scanner: turns raw native detection/scan results into typed installations
// and detected profiles. Desktop-only (goes through the bridge); the browser
// build uses manual file selection instead (see installer.ts / UI).
// ---------------------------------------------------------------------------

import type {
  DetectedFilamentProfile, IntegrationSlicerId, ParsedFilamentProfile,
  Platform, SlicerInstallation, UserDataLocation
} from './types';
import * as bridge from './bridge';
import { getAdapter } from './adapters';
import { capabilitiesFor, SLICER_DESCRIPTORS } from './registry';
import { loadExperimentalFeatures } from './featureFlags';

export async function currentPlatform(): Promise<Platform> {
  if (!bridge.isDesktop()) {
    // Browser build: infer from UA for registry lookups only.
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) return 'macos';
    if (ua.includes('linux')) return 'linux';
    return 'windows';
  }
  const info = await bridge.getPlatformInfo();
  return (['windows', 'macos', 'linux'] as Platform[]).includes(info.platform as Platform)
    ? (info.platform as Platform)
    : 'windows';
}

/** Detect installed slicers (desktop only; returns [] in the browser). */
export async function detectInstallations(): Promise<SlicerInstallation[]> {
  if (!bridge.isDesktop()) return [];
  const platform = await currentPlatform();
  const flags = loadExperimentalFeatures();
  const raw = await bridge.detectSupportedSlicers();
  const out: SlicerInstallation[] = [];
  for (const r of raw) {
    const id = r.slicer_id as IntegrationSlicerId;
    const desc = SLICER_DESCRIPTORS[id];
    if (!desc) continue;
    const locations: UserDataLocation[] = r.user_locations.map(l => ({
      id: `${id}:${l.account_id}`,
      path: l.path,
      accountId: l.account_id,
      active: l.active,
      filamentProfileCount: l.filament_profile_count,
      cloudLinked: l.account_id !== 'default'
    }));
    const confidence: SlicerInstallation['confidence'] =
      r.conf_version && r.data_dir ? 'verified' : r.data_dir ? 'likely' : 'unknown';
    out.push({
      id: `${id}@${r.conf_version ?? 'unknown'}`,
      slicerId: id,
      displayName: desc.displayName,
      version: r.conf_version,
      executablePath: r.executable_path,
      dataDirectory: r.data_dir,
      userDataLocations: locations,
      source: 'automatic',
      confidence,
      capabilities: capabilitiesFor(id, r.conf_version, platform, true, flags.unsupportedVersionOverride),
      notes: r.notes
    });
  }
  return out;
}

export interface ProfileScanResult {
  profiles: DetectedFilamentProfile[];
  parsed: Map<string, ParsedFilamentProfile>;
  parseFailures: { fileName: string; error: string }[];
}

/**
 * Scan filament profiles for one installation + user-data location.
 * Read-only. System presets are included as clone sources (never writable).
 */
export async function scanProfiles(
  slicerId: IntegrationSlicerId,
  location: UserDataLocation
): Promise<ProfileScanResult> {
  const adapter = getAdapter(slicerId);
  const rawFiles = await bridge.scanSlicerProfiles(slicerId, location.accountId);
  const profiles: DetectedFilamentProfile[] = [];
  const parsed = new Map<string, ParsedFilamentProfile>();
  const parseFailures: { fileName: string; error: string }[] = [];

  for (const f of rawFiles) {
    try {
      const p = adapter.parseProfile(
        { kind: 'detected', fileName: f.file_name, json: f.json, infoText: f.info, filePath: f.path },
        f
      );
      // Filament presets only: vendor index files and non-filament JSON in
      // system dirs are filtered by the adapter; skip nulls.
      if (!p) continue;
      profiles.push(p.profile);
      parsed.set(p.profile.id, p);
    } catch (err) {
      parseFailures.push({ fileName: f.file_name, error: String(err) });
    }
  }
  return { profiles, parsed, parseFailures };
}
