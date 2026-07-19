// ---------------------------------------------------------------------------
// Export and installation orchestration. Install is desktop-only and runs the
// whole transaction natively (backup → temp write → atomic move → verify →
// rollback on failure); this module maps outcomes to typed results.
// ---------------------------------------------------------------------------

import type {
  GeneratedFilamentProfile, ProfileInstallErrorCode, ProfileInstallResult, UserDataLocation
} from './types';
import * as bridge from './bridge';
import { makeInstallError } from './errors';
import { download } from '../ui/dom';

/**
 * Export the generated profile. Desktop: native save dialog (returns the
 * chosen path, or null when cancelled). Browser: triggers a download and
 * returns 'download'.
 */
export async function exportProfile(profile: GeneratedFilamentProfile): Promise<string | null> {
  const fileName = `${profile.fileStem}.json`;
  if (bridge.isDesktop()) {
    return bridge.saveExportedProfile(fileName, profile.serialized);
  }
  download(fileName, profile.serialized, 'application/json');
  return 'download';
}

const KNOWN_CODES: ProfileInstallErrorCode[] = [
  'SLICER_NOT_FOUND', 'SLICER_VERSION_UNKNOWN', 'USER_DATA_NOT_FOUND',
  'MULTIPLE_USER_DATA_LOCATIONS', 'PROFILE_PARSE_FAILED', 'PROFILE_SCHEMA_UNSUPPORTED',
  'INHERITANCE_UNRESOLVED', 'PROFILE_INCOMPATIBLE', 'DUPLICATE_PROFILE', 'SLICER_RUNNING',
  'BACKUP_FAILED', 'WRITE_PERMISSION_DENIED', 'ATOMIC_WRITE_FAILED',
  'INSTALL_VERIFICATION_FAILED', 'ROLLBACK_FAILED', 'UNSUPPORTED_MULTI_TOOL_PROFILE',
  'NOT_DESKTOP', 'UNKNOWN'
];

function asErrorCode(raw: string | null): ProfileInstallErrorCode {
  return (KNOWN_CODES as string[]).includes(raw ?? '') ? (raw as ProfileInstallErrorCode) : 'UNKNOWN';
}

/**
 * Install the generated profile into the selected slicer location.
 * The native side refuses to run while the slicer is open (unless the UI has
 * just confirmed a fresh process check) and always backs up first.
 */
export async function installProfile(args: {
  profile: GeneratedFilamentProfile;
  location: UserDataLocation;
  projectId: string;
  allowReplace: boolean;
}): Promise<ProfileInstallResult> {
  const base: ProfileInstallResult = {
    success: false,
    installedFiles: [],
    changedFiles: [],
    backupId: null,
    verificationPassed: false,
    restartRequired: true,
    warnings: [],
    error: null
  };
  if (!bridge.isDesktop()) {
    return { ...base, error: makeInstallError('NOT_DESKTOP') };
  }
  let raw: bridge.RawInstallOutcome;
  try {
    raw = await bridge.installGeneratedProfile({
      slicerId: args.profile.slicerId,
      accountId: args.location.accountId,
      profileName: args.profile.name,
      presetJson: args.profile.serialized,
      infoText: args.profile.infoText,
      projectId: args.projectId,
      allowReplace: args.allowReplace,
      skipProcessCheck: false
    });
  } catch (e) {
    return { ...base, error: makeInstallError('UNKNOWN', String(e)) };
  }

  const warnings: string[] = [];
  if (args.location.cloudLinked) {
    warnings.push('This location is linked to a slicer account. The slicer may later synchronize, duplicate, replace, or remove this preset.');
  }
  if (raw.success) {
    return {
      success: true,
      installedFiles: raw.installed_files,
      changedFiles: raw.changed_files,
      backupId: raw.backup_id,
      verificationPassed: raw.verification_passed,
      restartRequired: true,
      warnings,
      error: null
    };
  }
  return {
    ...base,
    backupId: raw.backup_id,
    warnings,
    error: makeInstallError(asErrorCode(raw.error_code), raw.error_detail ?? undefined)
  };
}

/** Re-verify an installed file later (e.g. from the success screen). */
export async function verifyInstalledProfile(
  filePath: string,
  profile: GeneratedFilamentProfile
): Promise<{ verified: boolean; detail: string }> {
  if (!bridge.isDesktop()) return { verified: false, detail: 'Desktop app required.' };
  return bridge.verifyGeneratedProfile(filePath, profile.serialized);
}
