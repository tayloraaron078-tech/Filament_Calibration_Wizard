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
import { nozzlesFromPrinterNames, printerModelsFromNames } from './orcaFamily';

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
  resolveInheritedMetadata(profiles, rawFiles);
  return { profiles, parsed, parseFailures };
}

/** Zero-strip a vendor library version the way the slicer stamps presets:
 * "02.07.00.08" → "2.7.0.8". Non-numeric components pass through unchanged. */
export function normalizeLibraryVersion(v: string): string {
  return v.split('.').map(part => (/^\d+$/.test(part) ? String(parseInt(part, 10)) : part)).join('.');
}

function firstStr(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0];
  return null;
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Fill in metadata that delta presets inherit rather than declare.
 *
 * Verified on a real Bambu Studio 2.7.x install: concrete system leaves
 * (e.g. "Bambu ABS @BBL H2S") declare `compatible_printers` but inherit
 * `filament_type` / `filament_vendor` from abstract parents ("@base" /
 * fdm_filament_*); user delta presets conversely inherit
 * `compatible_printers` from their system parent. Without resolution,
 * system presets can't be material-matched (so they score below user
 * presets and flood recommendations across materials) and user deltas
 * look "compatible with every printer".
 *
 * Resolution walks the `inherits` chain through ALL scanned system files —
 * including abstract, non-instantiated nodes that are filtered out of the
 * selectable profile list. Read-only metadata fill; rawProfile is untouched.
 */
export function resolveInheritedMetadata(
  profiles: DetectedFilamentProfile[],
  rawFiles: { dir_kind: string; json: string; vendor?: string | null }[]
): void {
  const systemByName = new Map<string, Record<string, unknown>>();
  // Vendor library versions from system/{Vendor}.json manifests. User presets
  // must be stamped with this version (zero-stripped: "02.07.00.08" →
  // "2.7.0.8"); no preset inside the library carries it.
  const vendorVersions = new Map<string, string>();
  for (const f of rawFiles) {
    if (f.dir_kind === 'vendor_manifest' && f.vendor) {
      try {
        const d = JSON.parse(f.json) as Record<string, unknown>;
        if (typeof d.version === 'string' && d.version) {
          vendorVersions.set(f.vendor, normalizeLibraryVersion(d.version));
        }
      } catch { /* ignore unparsable manifests */ }
      continue;
    }
    if (f.dir_kind !== 'system') continue;
    try {
      const d = JSON.parse(f.json) as Record<string, unknown>;
      if (d && typeof d.name === 'string' && d.name) systemByName.set(d.name, d);
    } catch { /* unparsable files are already reported via parseFailures */ }
  }

  for (const p of profiles) {
    if (p.profileVersion || p.sourceType !== 'system' || !p.filePath) continue;
    for (const [vendor, ver] of vendorVersions) {
      if (p.filePath.includes(`/system/${vendor}/`) || p.filePath.includes(`\\system\\${vendor}\\`)) {
        p.profileVersion = ver;
        break;
      }
    }
  }

  if (systemByName.size === 0) return;

  for (const p of profiles) {
    if (p.materialType && p.vendor && p.compatiblePrinterNames.length > 0 && p.profileVersion) continue;
    let cur = p.parentProfileName;
    let depth = 0;
    while (cur && depth++ < 8) {
      const d = systemByName.get(cur);
      if (!d) break;
      if (!p.materialType) p.materialType = firstStr(d.filament_type);
      if (!p.vendor) p.vendor = firstStr(d.filament_vendor);
      if (!p.profileVersion && typeof d.version === 'string' && d.version) p.profileVersion = d.version;
      if (p.compatiblePrinterNames.length === 0) {
        const compat = strArr(d.compatible_printers);
        if (compat.length > 0) {
          p.compatiblePrinterNames = compat;
          p.compatiblePrinterModels = printerModelsFromNames(compat);
          p.compatibleNozzleDiameters = nozzlesFromPrinterNames(compat);
        }
      }
      if (p.materialType && p.vendor && p.compatiblePrinterNames.length > 0 && p.profileVersion) break;
      cur = typeof d.inherits === 'string' && d.inherits ? d.inherits : null;
    }
  }
}
