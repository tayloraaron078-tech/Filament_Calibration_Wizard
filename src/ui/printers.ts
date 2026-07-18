import { h, clear, field, numberInput, issueList, confirmDialog, toast } from './dom';
import { listPrinters, savePrinter, deletePrinter, listProjects, uid } from '../storage/store';
import { validateNumber } from '../logic/validation';
import type { PrinterProfile, ExtruderType } from '../types';

export async function renderPrinters(root: HTMLElement): Promise<void> {
  const printers = await listPrinters();

  root.append(
    h('div', { style: 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap' },
      h('h1', { style: 'margin:0;flex:1' }, 'Printer profiles'),
      h('button', { class: 'btn btn-primary', onClick: () => openEditor(root, null) }, '＋ Add printer')
    ),
    h('p', { class: 'field-help' },
      'Calibration projects reference a printer profile. Its limits (max temps, max flow) are used to warn you before any suggested setting could exceed what the machine can safely do.')
  );

  if (!printers.length) {
    root.append(h('div', { class: 'card', style: 'text-align:center;padding:2rem' },
      h('p', { style: 'font-size:2rem;margin:.2rem' }, '🖨️'),
      h('p', {}, 'No printers yet. Add the printer you\'ll calibrate on — nozzle size, temperature limits, and extruder type drive the suggested test ranges.'),
      h('button', { class: 'btn btn-primary', onClick: () => openEditor(root, null) }, 'Add your first printer')
    ));
    return;
  }

  root.append(h('div', { class: 'grid grid-cards' }, printers.map(p =>
    h('div', { class: 'card' },
      h('h3', { style: 'margin:0' }, p.name),
      h('p', { class: 'proj-sub' }, `${p.manufacturer} · ${p.nozzleDiameter} mm nozzle · ${p.extruderType === 'direct' ? 'Direct drive' : 'Bowden'}`),
      h('p', { class: 'proj-sub' },
        `Max nozzle ${p.maxNozzleTemp} °C · max bed ${p.maxBedTemp} °C` +
        (p.maxVolumetricFlow ? ` · max flow ${p.maxVolumetricFlow} mm³/s` : ' · max flow unknown')),
      p.notes ? h('p', { class: 'field-help' }, p.notes) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-sm', onClick: () => openEditor(root, p) }, '✎ Edit'),
        h('button', {
          class: 'btn btn-sm btn-danger', onClick: async () => {
            const projects = await listProjects();
            const used = projects.filter(pr => pr.printerProfileId === p.id).length;
            const ok = await confirmDialog({
              title: 'Delete printer profile?',
              body: used
                ? `"${p.name}" is referenced by ${used} project(s). Deleting it won't delete those projects, but they'll lose their printer limits and range suggestions.`
                : `Remove "${p.name}" from this device?`,
              confirmLabel: 'Delete', danger: true
            });
            if (!ok) return;
            await deletePrinter(p.id);
            clear(root); await renderPrinters(root);
          }
        }, '🗑 Delete')
      )
    )
  )));
}

function openEditor(root: HTMLElement, existing: PrinterProfile | null): void {
  const p: PrinterProfile = existing ? { ...existing, retractionRange: { ...existing.retractionRange } } : {
    id: uid(), name: '', manufacturer: '', nozzleDiameter: 0.4,
    maxNozzleTemp: 260, maxBedTemp: 100, maxVolumetricFlow: undefined,
    extruderType: 'direct', retractionRange: { start: 0, end: 2 },
    notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };

  const name = h('input', { type: 'text', value: p.name, placeholder: 'e.g. Bambu Lab P1S, Ender 3 v2' });
  const manufacturer = h('input', { type: 'text', value: p.manufacturer, placeholder: 'e.g. Bambu Lab' });
  const nozzle = numberInput({ value: p.nozzleDiameter, step: 0.05, min: 0.1, max: 2 });
  const maxNozzleTemp = numberInput({ value: p.maxNozzleTemp, step: 5, min: 150, max: 500 });
  const maxBedTemp = numberInput({ value: p.maxBedTemp, step: 5, min: 0, max: 200 });
  const maxFlow = numberInput({ value: p.maxVolumetricFlow ?? '', step: 0.5, min: 1, max: 100, placeholder: 'leave empty if unknown' });
  const extruder = h('select', {},
    h('option', { value: 'direct', selected: p.extruderType === 'direct' }, 'Direct drive'),
    h('option', { value: 'bowden', selected: p.extruderType === 'bowden' }, 'Bowden'));
  const retrStart = numberInput({ value: p.retractionRange.start, step: 0.1, min: 0, max: 10 });
  const retrEnd = numberInput({ value: p.retractionRange.end, step: 0.1, min: 0, max: 15 });
  const notes = h('textarea', { placeholder: 'Hotend mods, firmware, anything future-you should know' }, p.notes);
  const issuesHost = h('div', {});

  const overlay = h('div', { class: 'modal-overlay' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'max-width:640px;max-height:90vh;overflow:auto' },
      h('h3', {}, existing ? `Edit ${existing.name}` : 'New printer profile'),
      field('Profile name *', name),
      h('div', { class: 'field-row' },
        field('Manufacturer', manufacturer),
        field('Nozzle diameter (mm)', nozzle, 'The nozzle you will calibrate with. Different nozzle sizes need separate calibrations.')
      ),
      h('div', { class: 'field-row' },
        field('Max nozzle temp (°C)', maxNozzleTemp, 'From the printer/hotend spec. The app blocks suggestions above this.'),
        field('Max bed temp (°C)', maxBedTemp),
        field('Max volumetric flow (mm³/s)', maxFlow, 'If the maker publishes one (e.g. ~32 for a P1S stock hotend). Used to cap max-flow recommendations.')
      ),
      h('div', { class: 'field-row' },
        field('Extruder type', extruder, 'Direct drive = motor on the print head. Bowden = motor on the frame with a PTFE tube.'),
        field('Retraction range start (mm)', retrStart),
        field('Retraction range end (mm)', retrEnd)
      ),
      field('Notes', notes),
      issuesHost,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: () => overlay.remove() }, 'Cancel'),
        h('button', {
          class: 'btn btn-primary', onClick: async () => {
            const issues = [
              ...(name.value.trim() ? [] : [{ level: 'error' as const, message: 'Profile name is required.' }]),
              ...validateNumber(nozzle.value, { label: 'Nozzle diameter', min: 0.1, max: 2 }),
              ...validateNumber(maxNozzleTemp.value, { label: 'Max nozzle temp', min: 150, max: 500 }),
              ...validateNumber(maxBedTemp.value, { label: 'Max bed temp', min: 0, max: 200 }),
              ...(maxFlow.value === '' ? [] : validateNumber(maxFlow.value, { label: 'Max volumetric flow', min: 1, max: 100 })),
              ...validateNumber(retrStart.value, { label: 'Retraction start', min: 0, max: 10 }),
              ...validateNumber(retrEnd.value, { label: 'Retraction end', min: 0, max: 15 })
            ];
            if (Number(retrEnd.value) <= Number(retrStart.value)) {
              issues.push({ level: 'error', message: 'Retraction range end must be greater than start.' });
            }
            clear(issuesHost);
            if (issues.some(i => i.level === 'error')) {
              const list = issueList(issues); if (list) issuesHost.append(list);
              return;
            }
            const saved: PrinterProfile = {
              ...p,
              name: name.value.trim(),
              manufacturer: manufacturer.value.trim(),
              nozzleDiameter: Number(nozzle.value),
              maxNozzleTemp: Number(maxNozzleTemp.value),
              maxBedTemp: Number(maxBedTemp.value),
              maxVolumetricFlow: maxFlow.value === '' ? undefined : Number(maxFlow.value),
              extruderType: extruder.value as ExtruderType,
              retractionRange: { start: Number(retrStart.value), end: Number(retrEnd.value) },
              notes: notes.value
            };
            await savePrinter(saved);
            overlay.remove();
            toast('Printer profile saved.', 'success');
            clear(root); await renderPrinters(root);
          }
        }, 'Save printer')
      )
    )
  );
  document.body.append(overlay);
  name.focus();
}
