// ---------------------------------------------------------------------------
// "Back up your slicer profiles first" prompts.
//
// The wizard directs people to edit their filament/printer presets during
// calibration, so the profiles involved should be snapshotted BEFORE any of
// that starts — not only when a generated profile is installed at the end.
// Two entry points share the flow here:
//   - a per-project callout on the project page (until backed up or skipped)
//   - a one-time first-run card on the dashboard (desktop only)
// Snapshots land in the regular backup store (Settings → Slicer profile
// backups) and are restorable file-by-file like install backups.
// ---------------------------------------------------------------------------

import { h, toast } from './dom';
import { saveProject, addTimeline } from '../storage/store';
import * as bridge from '../slicerIntegration/bridge';
import { backupDetectedPresetLibraries, totalFileCount, type LibraryBackupOutcome } from '../slicerIntegration/libraryBackup';
import type { CalibrationProject } from '../types';
import type { IntegrationSlicerId } from '../slicerIntegration/types';

const FIRST_RUN_KEY = 'perfectfit.presetBackupFirstRunPrompt';

/**
 * Snapshot preset libraries, preferring the project's slicer but falling back
 * to every detected slicer when that one isn't found (e.g. an Orca project on
 * a machine that runs a sibling fork).
 */
async function runBackup(projectId: string, preferredSlicer?: IntegrationSlicerId): Promise<LibraryBackupOutcome> {
  let outcome = await backupDetectedPresetLibraries(projectId, preferredSlicer);
  if (preferredSlicer && !outcome.backups.length) {
    outcome = await backupDetectedPresetLibraries(projectId);
  }
  return outcome;
}

function outcomeToast(o: LibraryBackupOutcome): void {
  if (o.backups.length) {
    const where = o.backups.map(b => `${b.slicer_id} (${b.file_count} files)`).join(', ');
    toast(`Backed up ${totalFileCount(o)} preset file(s): ${where}. Restore anytime in Settings → Slicer profile backups.`, 'success');
  } else {
    toast(`No presets were backed up. ${o.notes.join(' ') || 'No supported slicer was detected on this machine.'}`, 'error');
  }
}

// --- per-project callout ----------------------------------------------------

/**
 * Callout shown on the project page until the user backs up or skips.
 * Returns null once the prompt has been answered for this project.
 */
export function presetBackupCallout(p: CalibrationProject, rerender: () => Promise<void>): HTMLElement | null {
  if (p.presetBackup) return null;

  const record = async (status: 'done' | 'skipped', backups: LibraryBackupOutcome['backups'] = []) => {
    p.presetBackup = {
      status,
      at: new Date().toISOString(),
      backupIds: backups.map(b => b.backup_id),
      fileCount: backups.reduce((n, b) => n + b.file_count, 0)
    };
    addTimeline(p, {
      stepId: 'project', kind: 'note',
      summary: status === 'done'
        ? `Slicer presets backed up (${p.presetBackup.fileCount} file(s), ${backups.length} location(s))`
        : 'Slicer preset backup skipped'
    });
    await saveProject(p);
    await rerender();
  };

  if (!bridge.isDesktop()) {
    return h('div', { class: 'callout callout-warn' },
      h('p', { class: 'co-title' }, '🗄 Back up your slicer profiles before you start'),
      h('p', {}, 'This wizard will ask you to change values in your filament and printer profiles. In the browser version PerfectFit cannot do the backup for you — before starting, copy your slicer\'s user preset folder somewhere safe (Orca/Bambu: the "user" folder inside the slicer\'s configuration directory), or export your presets from the slicer itself.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => void record('skipped') }, 'Got it — continue'))
    );
  }

  const backupBtn = h('button', {
    class: 'btn btn-primary', onClick: async () => {
      backupBtn.disabled = true;
      backupBtn.textContent = 'Backing up…';
      try {
        const o = await runBackup(p.id, p.slicer.slicer);
        outcomeToast(o);
        if (o.backups.length) await record('done', o.backups);
        else { backupBtn.disabled = false; backupBtn.textContent = '🗄 Back up now'; }
      } catch (e) {
        toast(`Backup failed: ${String(e)}`, 'error');
        backupBtn.disabled = false;
        backupBtn.textContent = '🗄 Back up now';
      }
    }
  }, '🗄 Back up now') as HTMLButtonElement;

  return h('div', { class: 'callout callout-warn' },
    h('p', { class: 'co-title' }, '🗄 Back up your slicer profiles before you start'),
    h('p', {}, 'This wizard will ask you to change values in your filament and printer profiles. One click saves a checksummed snapshot of your current user presets (filament, printer, and process) so you can restore them exactly — Settings → Slicer profile backups.'),
    h('div', { class: 'btn-row' },
      backupBtn,
      h('button', { class: 'btn', onClick: () => void record('skipped') }, 'Skip'))
  );
}

// --- first-run dashboard card -----------------------------------------------

function firstRunAnswered(): boolean {
  try { return localStorage.getItem(FIRST_RUN_KEY) !== null; } catch { return true; }
}

function markFirstRunAnswered(action: 'backed-up' | 'dismissed'): void {
  try { localStorage.setItem(FIRST_RUN_KEY, JSON.stringify({ at: new Date().toISOString(), action })); } catch { /* storage unavailable */ }
}

/**
 * One-time desktop card offering a full preset-library backup on first use.
 * Resolves to null in the browser build, once answered, or when no slicer
 * with user presets is detected (in that case it will ask again next time).
 */
export async function maybeFirstRunBackupCard(): Promise<HTMLElement | null> {
  if (!bridge.isDesktop() || firstRunAnswered()) return null;
  let anyPresets = false;
  try {
    const detected = await bridge.detectSupportedSlicers();
    anyPresets = detected.some(s => s.user_locations.length > 0);
  } catch { return null; }
  if (!anyPresets) return null;

  const card = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, '🗄 First things first: back up your slicer profiles'),
    h('p', {}, 'Calibrating means changing values in your slicer\'s filament and printer profiles. Before any of that, let PerfectFit snapshot your current user presets — every file is checksummed and restorable from Settings → Slicer profile backups.'),
    h('p', { class: 'field-help' }, 'Backups are stored in PerfectFit\'s own data folder and never touch your slicer files. You can also do this later, per project.')
  );
  const backupBtn = h('button', {
    class: 'btn btn-primary', onClick: async () => {
      backupBtn.disabled = true;
      backupBtn.textContent = 'Backing up…';
      try {
        const o = await runBackup('first-run');
        outcomeToast(o);
        if (o.backups.length) {
          markFirstRunAnswered('backed-up');
          card.remove();
        } else {
          backupBtn.disabled = false;
          backupBtn.textContent = '🗄 Back up all detected slicers';
        }
      } catch (e) {
        toast(`Backup failed: ${String(e)}`, 'error');
        backupBtn.disabled = false;
        backupBtn.textContent = '🗄 Back up all detected slicers';
      }
    }
  }, '🗄 Back up all detected slicers') as HTMLButtonElement;
  card.append(h('div', { class: 'btn-row' },
    backupBtn,
    h('button', { class: 'btn', onClick: () => { markFirstRunAnswered('dismissed'); card.remove(); } }, 'Not now')
  ));
  return card;
}
