import { h, clear, field, numberInput, toast, confirmDialog, download } from './dom';
import { loadSettings, saveSettings } from '../storage/store';
import { exportAll, importBackup } from '../export/backup';
import { importFilePicker } from './importExport';
import { applyTheme } from '../app';
import { idb } from '../storage/db';

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
