import { h, clear, field, numberInput, toast, confirmDialog, download } from './dom';
import { loadSettings, saveSettings } from '../storage/store';
import { exportAll, importBackup } from '../export/backup';
import { importFilePicker } from './importExport';
import { applyTheme } from '../app';
import { idb } from '../storage/db';
import { loadExperimentalFeatures, saveExperimentalFeatures } from '../slicerIntegration/featureFlags';
import * as bridge from '../slicerIntegration/bridge';

export function renderSettings(root: HTMLElement): void {
  const s = loadSettings();

  const theme = h('select', {},
    h('option', { value: 'auto', selected: s.theme === 'auto' }, 'Follow system'),
    h('option', { value: 'light', selected: s.theme === 'light' }, 'Light'),
    h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Dark'));
  const largeText = h('input', { type: 'checkbox', checked: s.largeText });
  const mode = h('select', {},
    h('option', { value: 'coach', selected: s.defaultMode === 'coach' }, 'Coach (guided)'),
    h('option', { value: 'expert', selected: s.defaultMode === 'expert' }, 'Expert (condensed)'));
  const margin = numberInput({ value: Math.round((1 - s.mvsSafetyMargin) * 100), min: 0, max: 50, step: 5 });

  const save = () => {
    const next = {
      theme: theme.value as typeof s.theme,
      largeText: largeText.checked,
      defaultMode: mode.value as typeof s.defaultMode,
      mvsSafetyMargin: 1 - Number(margin.value) / 100
    };
    saveSettings(next);
    applyTheme();
    toast('Settings saved.', 'success');
  };
  [theme, mode].forEach(el => el.addEventListener('change', save));
  largeText.addEventListener('change', save);
  margin.addEventListener('change', save);

  root.append(
    h('h1', {}, 'Settings'),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Appearance & guidance'),
      h('div', { class: 'field-row' },
        field('Theme', theme),
        field('Default guidance level for new projects', mode),
        field('Default max-flow safety margin (%)', margin, 'Headroom kept below measured max flow. 15% is a sensible conservative default; raise it for critical parts.')
      ),
      h('div', { class: 'check-item' }, largeText,
        h('div', {}, h('strong', {}, 'Larger text'), h('p', { class: 'coach-note' }, 'Increases the base font size across the app.')))
    ),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Backup & restore'),
      h('p', { class: 'field-help' }, 'Everything lives in this browser\'s local storage. Clearing site data (or some browser cleanups) deletes it — export backups regularly.'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary', onClick: async () => {
            download(`perfectfit-backup-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(false));
          }
        }, '⭳ Export all data (no photos)'),
        h('button', {
          class: 'btn', onClick: async () => {
            download(`perfectfit-backup-full-${new Date().toISOString().slice(0, 10)}.json`, await exportAll(true));
          }
        }, '⭳ Export all data + photos'),
        h('button', { class: 'btn', onClick: () => importFilePicker(() => { clear(root); renderSettings(root); toast('Restored.', 'success'); }) }, '📥 Restore from backup')
      )
    ),
    experimentalCard(),
    slicerBackupsCard(),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Privacy'),
      h('ul', {},
        h('li', {}, 'No account. No cloud. No analytics, ads, trackers, or telemetry.'),
        h('li', {}, 'Nothing you enter — including photos — ever leaves this device.'),
        h('li', {}, 'External model links open third-party websites; nothing is sent to them from your data.'),
        h('li', {}, 'The optional offline (PWA) cache stores only the app\'s own files.'))
    ),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Danger zone'),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-danger', onClick: async () => {
            const ok = await confirmDialog({
              title: 'Erase ALL data?',
              body: 'Deletes every project, printer profile, photo, and setting from this device. This cannot be undone. Export a backup first.',
              confirmLabel: 'Erase everything', danger: true
            });
            if (!ok) return;
            const really = await confirmDialog({
              title: 'Really erase everything?',
              body: 'Last chance — there is no cloud copy to recover from.',
              confirmLabel: 'Yes, erase', danger: true
            });
            if (!really) return;
            await idb.clear('projects'); await idb.clear('printers'); await idb.clear('photos');
            localStorage.clear();
            toast('All local data erased.', 'info');
            location.hash = '#/'; location.reload();
          }
        }, '🗑 Erase all local data'))
    )
  );
}

function experimentalCard(): HTMLElement {
  const f = loadExperimentalFeatures();
  const mk = (key: keyof typeof f, label: string, help: string) => {
    const cb = h('input', { type: 'checkbox', checked: f[key] }) as HTMLInputElement;
    cb.addEventListener('change', () => {
      const next = loadExperimentalFeatures();
      next[key] = cb.checked;
      saveExperimentalFeatures(next);
      toast('Experimental settings saved.', 'success');
    });
    return h('label', { class: 'check-item' }, cb,
      h('div', {}, h('strong', {}, label), h('p', { class: 'coach-note' }, help)));
  };
  return h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, '🧪 Experimental features'),
    h('p', { class: 'field-help' }, 'The slicer profile installer is experimental. PerfectFit backs up affected slicer files before any installation, and unverified slicer versions stay export-only.'),
    mk('slicerProfileGeneration', 'Slicer profile generation', 'Create filament profiles from completed calibrations (clone a base profile, patch calibrated values).'),
    mk('automaticProfileInstallation', 'Automatic profile installation', 'Allow direct installation into verified slicer versions (desktop app only). Export always remains available.'),
    mk('advancedProfileSelection', 'Advanced profile selection', 'Show every detected profile with filters, raw JSON, and override options.'),
    mk('unsupportedVersionOverride', 'Unverified version override (not recommended)', 'Allow direct installation into slicer versions that have not been verified. Export is the safer choice.')
  );
}

function slicerBackupsCard(): HTMLElement {
  const card = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, '🗄 Slicer profile backups'),
    h('p', { class: 'field-help' }, 'Before installing a profile, PerfectFit backs up the affected slicer files with checksums. Restore puts the original files back exactly as they were.'));
  if (!bridge.isDesktop()) {
    card.append(h('p', { class: 'field-help' }, 'Available in the PerfectFit desktop app.'));
    return card;
  }
  const host = h('div', {});
  card.append(host);
  const refresh = async () => {
    clear(host);
    let backups;
    try {
      backups = await bridge.listProfileBackups();
    } catch (e) {
      host.append(h('p', { class: 'field-help' }, `Could not list backups: ${String(e)}`));
      return;
    }
    if (!backups.length) {
      host.append(h('p', { class: 'field-help' }, 'No backups yet. One is created automatically on every profile installation.'));
      return;
    }
    host.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Created'), h('th', {}, 'Slicer'), h('th', {}, 'Profile'), h('th', {}, 'Files'), h('th', {}, ''))),
      h('tbody', {}, backups.map(b => h('tr', {},
        h('td', {}, b.created_at.replace('T', ' ').replace('Z', ' UTC')),
        h('td', {}, b.slicer_id),
        h('td', {}, b.installed_profile_name),
        h('td', {}, String(b.file_count)),
        h('td', {}, h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-sm', onClick: () => bridge.openBackupDirectory(b.backup_id).catch(e => toast(String(e), 'error'))
          }, '📂 Open'),
          h('button', {
            class: 'btn btn-sm', onClick: async () => {
              const ok = await confirmDialog({
                title: 'Restore this backup?',
                body: `Restores the slicer files exactly as they were before installing “${b.installed_profile_name}”. The profile installed at that time will be removed. Close the slicer first.`,
                confirmLabel: 'Restore'
              });
              if (!ok) return;
              try {
                const r = await bridge.restoreProfileBackup(b.backup_id);
                toast(`Restored ${r.restored_files.length} file(s), removed ${r.deleted_files.length}.`, 'success');
              } catch (e) { toast(`Restore failed: ${String(e)}`, 'error'); }
            }
          }, '⟲ Restore'),
          h('button', {
            class: 'btn btn-sm btn-danger', onClick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this backup?',
                body: 'The backed-up slicer files will no longer be restorable from PerfectFit.',
                confirmLabel: 'Delete backup', danger: true
              });
              if (!ok) return;
              try { await bridge.deleteProfileBackup(b.backup_id); await refresh(); }
              catch (e) { toast(String(e), 'error'); }
            }
          }, '🗑')
        ))
      ))))));
  };
  void refresh();
  return card;
}
