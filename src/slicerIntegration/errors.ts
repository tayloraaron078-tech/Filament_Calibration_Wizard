// ---------------------------------------------------------------------------
// Typed errors for the profile installer, with user-facing explanations.
// Every message answers: what happened, was anything changed, is there a
// backup, and what can the user do next.
// ---------------------------------------------------------------------------

import type { ProfileInstallError, ProfileInstallErrorCode } from './types';

interface ErrorTemplate {
  title: string;
  whatHappened: string;
  anythingChanged: string;
  nextSteps: string[];
  exportAvailable: boolean;
}

const TEMPLATES: Record<ProfileInstallErrorCode, ErrorTemplate> = {
  SLICER_NOT_FOUND: {
    title: 'Slicer not found',
    whatHappened: 'PerfectFit could not find this slicer on your computer.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Locate the slicer manually from the slicer selection screen.', 'Export the profile and import it in the slicer yourself.'],
    exportAvailable: true
  },
  SLICER_VERSION_UNKNOWN: {
    title: 'Slicer version could not be determined',
    whatHappened: 'The slicer was found, but its version could not be read, so automatic installation stays disabled for safety.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Export the profile and import it manually.', 'Open the slicer once so it writes its configuration, then try again.'],
    exportAvailable: true
  },
  USER_DATA_NOT_FOUND: {
    title: 'Slicer user data not found',
    whatHappened: 'The slicer\'s user preset folder does not exist yet.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Open the slicer once so it creates its data folders, then try again.', 'Export the profile instead.'],
    exportAvailable: true
  },
  MULTIPLE_USER_DATA_LOCATIONS: {
    title: 'Multiple preset locations found',
    whatHappened: 'This slicer has more than one user preset location (for example a cloud account and a local folder), and PerfectFit is not confident which one is active.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Pick the destination location explicitly on the install screen.'],
    exportAvailable: true
  },
  PROFILE_PARSE_FAILED: {
    title: 'Profile could not be read',
    whatHappened: 'The selected base profile could not be parsed.',
    anythingChanged: 'Nothing was changed. The original file was only read, never modified.',
    nextSteps: ['Pick a different base profile.', 'If this was a manually selected file, confirm it is a filament preset exported from a supported slicer.'],
    exportAvailable: false
  },
  PROFILE_SCHEMA_UNSUPPORTED: {
    title: 'Profile format not supported',
    whatHappened: 'The file was readable but does not match a known filament preset format.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Choose a preset created by one of the supported slicers.'],
    exportAvailable: false
  },
  INHERITANCE_UNRESOLVED: {
    title: 'Base profile chain could not be resolved',
    whatHappened: 'This preset inherits from a parent profile that could not be found in the slicer\'s libraries.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Choose a different base profile.', 'You can still generate and export — the slicer may resolve the parent itself on import.'],
    exportAvailable: true
  },
  PROFILE_INCOMPATIBLE: {
    title: 'Profile not compatible',
    whatHappened: 'The selected base profile does not match this calibration\'s printer, nozzle, or material.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Pick a compatible profile, or use Advanced selection to override with a clear warning.'],
    exportAvailable: true
  },
  DUPLICATE_PROFILE: {
    title: 'A profile with this name already exists',
    whatHappened: 'The target slicer already has a preset with the chosen name.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Use a different name.', 'Replace the existing profile (a backup is made first).', 'Create a numbered copy.'],
    exportAvailable: true
  },
  SLICER_RUNNING: {
    title: 'Slicer is running',
    whatHappened: 'The target slicer is currently open. Installing now could be overwritten or ignored.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Close the slicer and check again.', 'Export the profile instead and import it in the slicer.'],
    exportAvailable: true
  },
  BACKUP_FAILED: {
    title: 'Backup failed',
    whatHappened: 'PerfectFit could not create a verified backup of the files it was about to change, so installation was stopped before touching anything.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Check disk space and permissions.', 'Export the profile instead.'],
    exportAvailable: true
  },
  WRITE_PERMISSION_DENIED: {
    title: 'No permission to write',
    whatHappened: 'The slicer preset folder is not writable by PerfectFit.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Check folder permissions.', 'Export the profile and import it manually.'],
    exportAvailable: true
  },
  ATOMIC_WRITE_FAILED: {
    title: 'Install write failed',
    whatHappened: 'Writing the new preset failed partway. The installer rolled back to the backup.',
    anythingChanged: 'Any partial changes were rolled back from the backup.',
    nextSteps: ['Check disk space.', 'Try again, or export instead.'],
    exportAvailable: true
  },
  INSTALL_VERIFICATION_FAILED: {
    title: 'Installed file did not verify',
    whatHappened: 'After installation, the file on disk did not match the generated profile, so the installer rolled back.',
    anythingChanged: 'The installation was rolled back from the backup.',
    nextSteps: ['Try again.', 'Export the profile instead.', 'Check whether another program is modifying the slicer folder.'],
    exportAvailable: true
  },
  ROLLBACK_FAILED: {
    title: 'Rollback failed',
    whatHappened: 'Installation failed AND restoring the backup also failed. The slicer preset folder may be in a mixed state.',
    anythingChanged: 'Some files may have been changed. A backup exists and can be restored from Settings → Slicer profile backups.',
    nextSteps: ['Open Settings → Slicer profile backups and restore the most recent backup.', 'Do not delete the backup.'],
    exportAvailable: true
  },
  UNSUPPORTED_MULTI_TOOL_PROFILE: {
    title: 'Multi-tool profile not supported yet',
    whatHappened: 'This profile has per-tool settings that this version of PerfectFit cannot safely modify.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Export the generated values and apply them in the slicer manually.', 'Choose a single-tool base profile.'],
    exportAvailable: true
  },
  NOT_DESKTOP: {
    title: 'Desktop app required',
    whatHappened: 'Automatic detection and installation need the PerfectFit desktop app. In the browser, slicer folders cannot be accessed.',
    anythingChanged: 'Nothing was changed.',
    nextSteps: ['Download the generated profile and import it in your slicer.', 'Or use the PerfectFit desktop app for automatic installation.'],
    exportAvailable: true
  },
  UNKNOWN: {
    title: 'Unexpected error',
    whatHappened: 'Something went wrong that PerfectFit did not anticipate.',
    anythingChanged: 'If installation had started, it was rolled back where possible; check the backup list in Settings.',
    nextSteps: ['Try again.', 'Export the profile instead.', 'Copy the diagnostic report and file an issue.'],
    exportAvailable: true
  }
};

export function makeInstallError(code: ProfileInstallErrorCode, detail?: string): ProfileInstallError {
  const t = TEMPLATES[code] ?? TEMPLATES.UNKNOWN;
  return { code, message: `${t.whatHappened} ${t.anythingChanged}`, detail };
}

export function errorTemplate(code: ProfileInstallErrorCode): ErrorTemplate {
  return TEMPLATES[code] ?? TEMPLATES.UNKNOWN;
}
