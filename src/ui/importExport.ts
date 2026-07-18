import { h, toast } from './dom';
import { importBackup } from '../export/backup';

/** Open a file picker, import the chosen JSON, then run onDone. */
export function importFilePicker(onDone: () => void): void {
  const input = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const text = await file.text();
      const res = await importBackup(text);
      toast(res.message, res.ok ? 'success' : 'error');
      if (res.ok) onDone();
    } catch (err) {
      toast(`Import failed: ${String(err)}`, 'error');
    }
  });
  document.body.append(input);
  input.click();
}
