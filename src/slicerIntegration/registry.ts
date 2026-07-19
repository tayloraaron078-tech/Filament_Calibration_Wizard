// ---------------------------------------------------------------------------
// Slicer registry: per-slicer descriptors (verified detection data) and the
// version compatibility registry that gates automatic installation.
//
// Every path/name here was verified on a real installation — see
// docs/SLICER_PROFILE_RESEARCH.md. Unverified entries are marked and must not
// enable direct install.
// ---------------------------------------------------------------------------

import type {
  IntegrationSlicerId, SlicerFamily, SlicerCapabilities, VerifiedSlicerVersion, Platform
} from './types';

export interface SlicerDescriptor {
  id: IntegrationSlicerId;
  displayName: string;
  family: SlicerFamily;
  /** Folder name under %APPDATA% (Win) / ~/Library/Application Support (macOS). */
  dataDirName: string;
  /** Candidate executable paths relative to the platform's program root. */
  windowsExeCandidates: string[];
  macosAppCandidates: string[];
  /** Process image names used for running-detection. */
  processNames: string[];
  /** Verified date for the detection data above. */
  detectionVerifiedOn: string;
  notes: string[];
}

export const SLICER_DESCRIPTORS: Record<IntegrationSlicerId, SlicerDescriptor> = {
  'orca': {
    id: 'orca',
    displayName: 'Orca Slicer',
    family: 'orca',
    dataDirName: 'OrcaSlicer',
    windowsExeCandidates: ['OrcaSlicer\\orca-slicer.exe'],
    macosAppCandidates: ['OrcaSlicer.app'],
    processNames: ['orca-slicer.exe', 'OrcaSlicer'],
    detectionVerifiedOn: '2026-07-19',
    notes: []
  },
  'bambu': {
    id: 'bambu',
    displayName: 'Bambu Studio',
    family: 'bambu',
    dataDirName: 'BambuStudio',
    windowsExeCandidates: ['Bambu Studio\\bambu-studio.exe'],
    macosAppCandidates: ['BambuStudio.app'],
    processNames: ['bambu-studio.exe', 'BambuStudio'],
    detectionVerifiedOn: '2026-07-19',
    notes: ['Account preset directories may be cloud-synchronized.']
  },
  'snapmaker-orca': {
    id: 'snapmaker-orca',
    displayName: 'Snapmaker Orca',
    family: 'orca',
    dataDirName: 'Snapmaker_Orca',
    windowsExeCandidates: ['Snapmaker_Orca\\snapmaker-orca.exe'],
    macosAppCandidates: ['Snapmaker Orca.app', 'Snapmaker_Orca.app'],
    processNames: ['snapmaker-orca.exe', 'Snapmaker Orca'],
    detectionVerifiedOn: '2026-07-19',
    notes: []
  },
  'elegoo': {
    id: 'elegoo',
    displayName: 'ElegooSlicer',
    family: 'orca',
    dataDirName: 'ElegooSlicer',
    windowsExeCandidates: ['ElegooSlicer\\elegoo-slicer.exe'],
    macosAppCandidates: ['ElegooSlicer.app'],
    processNames: ['elegoo-slicer.exe', 'ElegooSlicer'],
    detectionVerifiedOn: '2026-07-19',
    notes: ['Machine presets can appear directly in the user root; filament scan only reads user/*/filament.']
  },
  'flash-studio': {
    id: 'flash-studio',
    displayName: 'Flash Studio (Orca-Flashforge)',
    family: 'orca',
    dataDirName: 'Orca-Flashforge',
    windowsExeCandidates: [
      'Flashforge\\Orca-Flashforge\\flash studio.exe',
      'Flashforge\\Orca-Flashforge\\Orca-Flashforge.exe'
    ],
    macosAppCandidates: ['Orca-Flashforge.app', 'Flash Studio.app'],
    processNames: ['flash studio.exe', 'Orca-Flashforge.exe', 'Orca-Flashforge'],
    detectionVerifiedOn: '2026-07-19',
    notes: ['Rebranded from Orca-Flashforge; data folder keeps the old name. Some presets ship without .info sidecars.']
  }
};

export function slicerDisplayName(id: IntegrationSlicerId): string {
  return SLICER_DESCRIPTORS[id]?.displayName ?? id;
}

/** Map the wizard's project slicer id onto integration slicer ids. */
export function integrationIdsForProjectSlicer(projectSlicer: string): IntegrationSlicerId[] {
  switch (projectSlicer) {
    case 'orca': return ['orca', 'snapmaker-orca', 'elegoo', 'flash-studio'];
    case 'bambu': return ['bambu'];
    default: return [];
  }
}

// --- version compatibility registry ----------------------------------------
//
// directInstallVerified may only be set to true after the manual test matrix
// (docs/SLICER_PROFILE_TEST_MATRIX.md) records a successful install +
// restart + slice test for that slicer/version/OS.

export const VERIFIED_VERSIONS: VerifiedSlicerVersion[] = [
  {
    slicerId: 'orca',
    versionRange: '2.4.',
    platforms: ['windows'],
    profileScanVerified: true,
    profileGenerationVerified: true,
    directInstallVerified: false, // install mechanics verified into local dir only; active dir is cloud-linked
    verificationDate: '2026-07-19',
    notes: ['Scanning + generation verified against Orca Slicer 2.4.2, Windows 11. Install/backup/verify/restore mechanics passed against the local default dir; the active preset dir is a cloud-linked account folder, deliberately not written to, and no in-GUI/slice test was run — direct install stays gated pending an account-dir-safe test.']
  },
  {
    slicerId: 'bambu',
    versionRange: '02.07.',
    platforms: ['windows'],
    profileScanVerified: true,
    profileGenerationVerified: true,
    directInstallVerified: false, // install mechanics verified into local dir only; active dir is cloud-linked
    verificationDate: '2026-07-19',
    notes: ['Scanning + generation verified against Bambu Studio 02.07.01.62, Windows 11 (incl. dual-nozzle H2S presets). Install/backup/verify/restore mechanics passed against the local default dir; the active preset dir is a cloud-linked account folder, deliberately not written to, and no in-GUI/slice test was run — direct install stays gated pending an account-dir-safe test.']
  },
  {
    slicerId: 'snapmaker-orca',
    versionRange: '01.10.',
    platforms: ['windows'],
    profileScanVerified: true,
    profileGenerationVerified: true,
    directInstallVerified: false, // install+appear+restore verified on multi-tool U1; GUI value display + slice pending
    verificationDate: '2026-07-19',
    notes: ['Manual test on Snapmaker Orca 01.10.01.50, Windows 11 (multi-tool U1): transactional install + verified backup, preset appears and is selectable as a tool filament, on-disk values correct, backup restore returns baseline. In-GUI value display and slice test not yet run — direct install stays gated.']
  },
  {
    slicerId: 'elegoo',
    versionRange: '1.5.',
    platforms: ['windows'],
    profileScanVerified: true,
    profileGenerationVerified: true,
    directInstallVerified: true,
    verificationDate: '2026-07-19',
    notes: [
      'Full manual E2E pass on ElegooSlicer 1.5.2.2, Windows 11: transactional install + verified backup, preset appears in the filament list, all calibrated values load correctly (temp/flow/PA/MVS), model slices cleanly, backup restore returns the directory byte-identical to baseline.'
    ]
  },
  {
    slicerId: 'flash-studio',
    versionRange: '01.10.',
    platforms: ['windows'],
    profileScanVerified: true,
    profileGenerationVerified: true,
    directInstallVerified: false, // install+appear+values+restore verified; slice test pending
    verificationDate: '2026-07-19',
    notes: ['Manual test on Flash Studio (Orca-Flashforge) 01.10.01.50, Windows 11: transactional install + verified backup, preset appears in the filament list with correct values (flow 1.03, PA 0.041 enabled), backup restore returns baseline. Slice test not yet run — direct install stays gated pending it.']
  }
];

export function findVerifiedVersion(
  slicerId: IntegrationSlicerId,
  version: string | null,
  platform: Platform
): VerifiedSlicerVersion | null {
  if (!version) return null;
  for (const v of VERIFIED_VERSIONS) {
    if (v.slicerId === slicerId && v.platforms.includes(platform) && version.startsWith(v.versionRange)) {
      return v;
    }
  }
  return null;
}

/**
 * Compute honest capabilities for a detected installation. Anything not
 * verified for this slicer/version/platform stays false; export always works
 * because it never touches slicer data.
 */
export function capabilitiesFor(
  slicerId: IntegrationSlicerId,
  version: string | null,
  platform: Platform,
  isDesktop: boolean,
  allowUnverifiedOverride: boolean
): SlicerCapabilities {
  const verified = findVerifiedVersion(slicerId, version, platform);
  return {
    // Read-only scanning and pure data transforms are safe on any version;
    // only direct installation is gated by per-version verification.
    canScanProfiles: isDesktop,
    canParseProfiles: true,
    canGenerateProfiles: true,
    canExportProfiles: true,
    canInstallDirectly: isDesktop && (!!verified?.directInstallVerified || allowUnverifiedOverride),
    canVerifyInstallation: isDesktop,
    requiresRestart: true,
    requiresClosedProcess: true
  };
}
