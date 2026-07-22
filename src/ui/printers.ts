import { h, clear, field, numberInput, issueList, confirmDialog, toast } from './dom';
import { listPrinters, savePrinter, deletePrinter, listProjects, uid } from '../storage/store';
import { validateNumber } from '../logic/validation';
import {
  groupedPrinterSpecs, getPrinterSpec, specLabel, profileValuesFromSpec, PRINTER_DB_COUNT
} from '../data/printerDatabase';
import type { PrinterProfile, ExtruderType, PrinterSpecification } from '../types';

export async function renderPrinters(root: HTMLElement): Promise<void> {
  const printers = await listPrinters();

  root.append(
    h('div', { style: 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap' },
      h('h1', { style: 'margin:0;flex:1' }, 'Printer profiles'),
      h('button', { class: 'btn btn-primary', onClick: () => openEditor(root, null) }, '＋ Add printer')
    ),
    h('p', { class: 'field-help' },
      `Calibration projects reference a printer profile. Its limits (max temps, max flow) are used to warn you before any suggested setting could exceed what the machine can safely do. Pick from ${PRINTER_DB_COUNT.toLocaleString()} known printers to fill the specs in automatically, or enter your own.`)
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
      p.databasePrinterId
        ? h('p', { class: 'field-help', style: 'color:var(--ok)' }, '✓ Specs from printer database')
        : h('p', { class: 'field-help' }, '✎ Manually configured'),
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

// --- searchable printer combobox -------------------------------------------

/**
 * Minimal dependency-free searchable combobox: a text input plus a grouped,
 * scrollable results panel. Manufacturers are grouped and alphabetical; models
 * are alphabetical within each. Supports type-to-filter and keyboard nav
 * (Arrow keys, Enter, Escape). Calls onSelect with the chosen spec.
 */
function printerCombobox(onSelect: (spec: PrinterSpecification) => void): { root: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
    autocomplete: 'off', placeholder: 'Search by brand or model — e.g. "X1", "Ender 3", "Qidi"'
  });
  const panel = h('div', { class: 'combo-panel', role: 'listbox', style: 'display:none' });
  const wrap = h('div', { class: 'combo', style: 'position:relative' }, input, panel);

  let items: HTMLElement[] = [];
  let active = -1;

  const close = () => { panel.style.display = 'none'; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const setActive = (i: number) => {
    items.forEach(el => el.classList.remove('combo-active'));
    active = Math.max(-1, Math.min(i, items.length - 1));
    if (active >= 0) { items[active].classList.add('combo-active'); items[active].scrollIntoView({ block: 'nearest' }); }
  };

  const render = () => {
    clear(panel);
    items = [];
    const groups = groupedPrinterSpecs(input.value);
    if (!groups.length) {
      panel.append(h('div', { class: 'combo-empty' }, 'No matching printer. Use “My printer is not listed” below.'));
    }
    let shown = 0;
    for (const g of groups) {
      if (shown > 400) break; // keep the DOM light for very broad queries
      panel.append(h('div', { class: 'combo-group' }, g.manufacturer));
      for (const spec of g.printers) {
        const model = spec.model.toLowerCase().startsWith(g.manufacturer.toLowerCase() + ' ')
          ? spec.model.slice(g.manufacturer.length + 1) : spec.model;
        const opt = h('div', { class: 'combo-item', role: 'option', tabindex: '-1' }, model);
        opt.addEventListener('mousedown', e => { e.preventDefault(); onSelect(spec); input.value = specLabel(spec); close(); });
        panel.append(opt);
        items.push(opt);
        shown++;
      }
    }
    panel.style.display = 'block';
    input.setAttribute('aria-expanded', 'true');
    setActive(items.length ? 0 : -1);
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Enter') {
      if (active >= 0 && items[active]) { e.preventDefault(); (items[active] as HTMLElement).dispatchEvent(new MouseEvent('mousedown')); }
    } else if (k === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  return { root: wrap, input };
}

// --- editor ----------------------------------------------------------------

function openEditor(root: HTMLElement, existing: PrinterProfile | null): void {
  // Working copy holding all values, including extended specs not shown as
  // top-level inputs but persisted and used by the calibration workflow.
  const p: PrinterProfile = existing
    ? { ...existing, retractionRange: { ...existing.retractionRange }, buildVolume: existing.buildVolume ? { ...existing.buildVolume } : undefined }
    : {
      id: uid(), name: '', manufacturer: '', nozzleDiameter: 0.4,
      maxNozzleTemp: 260, maxBedTemp: 100, maxVolumetricFlow: undefined,
      extruderType: 'direct', retractionRange: { start: 0, end: 2 },
      notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      isManual: true
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

  // --- advanced (extended machine specs) -----------------------------------
  const maxChamber = numberInput({ value: p.maxChamberTemp ?? '', step: 5, min: 0, max: 120, placeholder: 'not specified' });
  const heatedChamber = h('select', {},
    h('option', { value: '', selected: p.heatedChamber === undefined }, 'Not specified'),
    h('option', { value: 'yes', selected: p.heatedChamber === true }, 'Yes — actively heated'),
    h('option', { value: 'no', selected: p.heatedChamber === false }, 'No'));
  const supportedNozzles = h('input', { type: 'text', value: (p.supportedNozzleDiameters ?? []).join(', '), placeholder: 'e.g. 0.2, 0.4, 0.6, 0.8' });
  const bvx = numberInput({ value: p.buildVolume?.x ?? '', step: 1, min: 0, placeholder: 'X' });
  const bvy = numberInput({ value: p.buildVolume?.y ?? '', step: 1, min: 0, placeholder: 'Y' });
  const bvz = numberInput({ value: p.buildVolume?.z ?? '', step: 1, min: 0, placeholder: 'Z' });
  const maxSpeed = numberInput({ value: p.maxPrintSpeed ?? '', step: 10, min: 0, placeholder: 'not specified' });
  const maxAccel = numberInput({ value: p.maxAcceleration ?? '', step: 100, min: 0, placeholder: 'not specified' });
  const firmware = h('input', { type: 'text', value: p.firmware ?? '', placeholder: 'e.g. Klipper, Marlin' });
  const extruderCount = numberInput({ value: p.extruderCount ?? '', step: 1, min: 1, max: 8, placeholder: '1' });
  const mmu = h('input', { type: 'text', value: p.multiMaterialCompatibility ?? '', placeholder: 'e.g. AMS, MMU3 — leave blank if none' });

  const issuesHost = h('div', {});
  const dbBadge = h('p', { class: 'field-help', style: 'display:none;color:var(--ok);font-weight:600' });
  const setBadge = (spec: PrinterSpecification | null) => {
    if (spec) { dbBadge.textContent = `✓ Filled from database: ${specLabel(spec)}. Review and change any value for modified or custom hardware.`; dbBadge.style.display = ''; }
    else { dbBadge.style.display = 'none'; }
  };
  if (existing?.databasePrinterId) setBadge(getPrinterSpec(existing.databasePrinterId) ?? null);

  // Track edits so we can warn before a new selection discards them.
  let dirtySinceSelect = false;
  const markDirty = () => { dirtySinceSelect = true; };
  for (const el of [name, manufacturer, nozzle, maxNozzleTemp, maxBedTemp, maxFlow, extruder, retrStart, retrEnd, notes,
    maxChamber, heatedChamber, supportedNozzles, bvx, bvy, bvz, maxSpeed, maxAccel, firmware, extruderCount, mmu]) {
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  }

  const applySpec = (spec: PrinterSpecification) => {
    const v = profileValuesFromSpec(spec);
    // Persist everything on the working copy (incl. fields with no visible input).
    Object.assign(p, v);
    p.databasePrinterId = spec.id;
    p.isManual = false;
    // Reflect into visible inputs (blank DB fields don't clobber existing values).
    if (!name.value.trim()) name.value = specLabel(spec).replace(' · ', ' ');
    if (v.manufacturer) manufacturer.value = v.manufacturer;
    if (v.nozzleDiameter !== undefined) nozzle.value = String(v.nozzleDiameter);
    if (v.maxNozzleTemp !== undefined) maxNozzleTemp.value = String(v.maxNozzleTemp);
    if (v.maxBedTemp !== undefined) maxBedTemp.value = String(v.maxBedTemp);
    if (v.maxVolumetricFlow !== undefined) maxFlow.value = String(v.maxVolumetricFlow);
    if (v.extruderType) extruder.value = v.extruderType;
    maxChamber.value = v.maxChamberTemp !== undefined ? String(v.maxChamberTemp) : '';
    heatedChamber.value = v.heatedChamber === true ? 'yes' : v.heatedChamber === false ? 'no' : '';
    supportedNozzles.value = (v.supportedNozzleDiameters ?? []).join(', ');
    bvx.value = v.buildVolume?.x !== undefined ? String(v.buildVolume.x) : '';
    bvy.value = v.buildVolume?.y !== undefined ? String(v.buildVolume.y) : '';
    bvz.value = v.buildVolume?.z !== undefined ? String(v.buildVolume.z) : '';
    maxSpeed.value = v.maxPrintSpeed !== undefined ? String(v.maxPrintSpeed) : '';
    maxAccel.value = v.maxAcceleration !== undefined ? String(v.maxAcceleration) : '';
    firmware.value = v.firmware ?? '';
    extruderCount.value = v.extruderCount !== undefined ? String(v.extruderCount) : '';
    mmu.value = v.multiMaterialCompatibility ?? '';
    setBadge(spec);
    dirtySinceSelect = false;
  };

  const combo = printerCombobox(async (spec) => {
    if (dirtySinceSelect) {
      const ok = await confirmDialog({
        title: 'Replace edited values?',
        body: `You've edited some fields. Filling from “${specLabel(spec)}” will overwrite them with the database values. Continue?`,
        confirmLabel: 'Replace'
      });
      if (!ok) return;
    }
    applySpec(spec);
  });

  const manualBtn = h('button', {
    class: 'btn btn-sm', type: 'button', onClick: () => {
      p.databasePrinterId = null; p.isManual = true;
      combo.input.value = '';
      setBadge(null);
      toast('Manual entry — enter your printer\'s specs by hand.', 'info');
      name.focus();
    }
  }, 'My printer is not listed — enter manually');

  const advanced = h('details', { class: 'advanced' },
    h('summary', {}, 'Advanced machine specs (chamber, build volume, firmware…)'),
    h('p', { class: 'field-help' }, 'Optional. Filled from the database when available and used for extra safety checks. Blank means “not specified”.'),
    h('div', { class: 'field-row' },
      field('Max chamber temp (°C)', maxChamber, 'Highest controlled chamber temperature, if the printer heats its chamber.'),
      field('Heated chamber', heatedChamber),
      field('Supported nozzle sizes (mm)', supportedNozzles, 'Comma-separated. Used to sanity-check the selected nozzle diameter.')),
    h('div', { class: 'field-row' },
      field('Build volume X (mm)', bvx),
      field('Build volume Y (mm)', bvy),
      field('Build volume Z (mm)', bvz)),
    h('div', { class: 'field-row' },
      field('Max print speed (mm/s)', maxSpeed),
      field('Max acceleration (mm/s²)', maxAccel),
      field('Number of extruders', extruderCount)),
    h('div', { class: 'field-row' },
      field('Firmware', firmware),
      field('Multi-material (AMS/MMU)', mmu))
  );

  const overlay = h('div', { class: 'modal-overlay' },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: 'max-width:640px;max-height:90vh;overflow:auto' },
      h('h3', {}, existing ? `Edit ${existing.name}` : 'New printer profile'),
      field('Find your printer', combo.root, `Choose from ${PRINTER_DB_COUNT.toLocaleString()} known printers to auto-fill specs, then adjust anything for your setup.`),
      h('div', { style: 'margin:-.5rem 0 .75rem' }, manualBtn),
      dbBadge,
      h('hr', { style: 'border:none;border-top:1px solid var(--border,#ddd);margin:.5rem 0 1rem' }),
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
      advanced,
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
            // Soft warning: selected nozzle not in the printer's supported set.
            const supported = parseNozzleCsv(supportedNozzles.value);
            if (supported.length && !supported.includes(Number(nozzle.value))) {
              issues.push({ level: 'warning', message: `Nozzle ${nozzle.value} mm isn't in this printer's supported sizes (${supported.join(', ')} mm). Save anyway if you've fitted a different nozzle.` });
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
              notes: notes.value,
              // Extended specs — undefined (not 0/NaN) when left blank.
              maxChamberTemp: numOrUndef(maxChamber.value),
              heatedChamber: heatedChamber.value === '' ? undefined : heatedChamber.value === 'yes',
              supportedNozzleDiameters: supported.length ? supported : undefined,
              buildVolume: buildVolumeOrUndef(bvx.value, bvy.value, bvz.value),
              maxPrintSpeed: numOrUndef(maxSpeed.value),
              maxAcceleration: numOrUndef(maxAccel.value),
              firmware: firmware.value.trim() || undefined,
              extruderCount: numOrUndef(extruderCount.value),
              multiMaterialCompatibility: mmu.value.trim() || undefined,
              isManual: !p.databasePrinterId
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
  (existing ? name : combo.input).focus();
}

// --- small helpers ---------------------------------------------------------

function parseNozzleCsv(s: string): number[] {
  const nums = s.split(/[,;/]/).map(x => parseFloat(x.trim())).filter(x => Number.isFinite(x));
  return [...new Set(nums)].sort((a, b) => a - b);
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildVolumeOrUndef(x: string, y: string, z: string): PrinterProfile['buildVolume'] {
  const bx = numOrUndef(x), by = numOrUndef(y), bz = numOrUndef(z);
  if (bx === undefined && by === undefined && bz === undefined) return undefined;
  return { x: bx, y: by, z: bz };
}
