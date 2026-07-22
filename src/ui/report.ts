import { h, toast } from './dom';
import { getProject, getPrinter, completionPercent } from '../storage/store';
import { getCalibration } from '../data/calibrations';
import { getMaterial } from '../data/materials';
import { getSlicerContent } from '../data/slicers';
import { confidenceScore, confidenceLabel } from '../logic/confidence';
import type { CalibrationProject, CalibrationId } from '../types';

/** Copy the final calibrated values to the clipboard as readable text. */
export async function copyFinalsToClipboard(p: CalibrationProject): Promise<void> {
  const mat = getMaterial(p.filament.material);
  const f = p.finals;
  const lines = [
    `${p.filament.manufacturer} ${mat.label} ${p.filament.color} — calibrated ${p.calibrationDate}`,
    f.nozzleTemp !== undefined ? `Nozzle temperature: ${f.nozzleTemp} °C` : null,
    f.firstLayerTemp !== undefined ? `First-layer temperature: ${f.firstLayerTemp} °C` : null,
    f.highFlowTemp !== undefined ? `High-flow temperature: ${f.highFlowTemp} °C` : null,
    f.flowRatio !== undefined ? `Flow ratio: ${f.flowRatio}` : null,
    f.pressureAdvance !== undefined ? `Pressure advance: ${f.pressureAdvance}` : null,
    f.retractionDistance !== undefined ? `Retraction length: ${f.retractionDistance} mm` : null,
    f.retractionSpeed !== undefined ? `Retraction speed: ${f.retractionSpeed} mm/s` : null,
    f.maxVolumetricSpeed !== undefined ? `Max volumetric speed: ${f.maxVolumetricSpeed} mm³/s` : null,
    f.shrinkagePercent !== undefined ? `Shrinkage (XY): ${f.shrinkagePercent}%` : null
  ].filter(Boolean);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    toast('Final settings copied to clipboard.', 'success');
  } catch {
    toast('Clipboard unavailable — use the report page instead.', 'error');
  }
}

/** Printable full calibration report. */
export async function renderReport(root: HTMLElement, id: string): Promise<void> {
  const p = await getProject(id);
  if (!p) { root.append(h('p', {}, 'Project not found.')); return; }
  const printer = await getPrinter(p.printerProfileId);
  const mat = getMaterial(p.filament.material);
  const slicer = getSlicerContent(p.slicer.slicer, p.slicer.version);
  const conf = confidenceScore(p);

  root.append(
    h('div', { class: 'no-print btn-row' },
      h('a', { class: 'btn', href: `#/project/${p.id}` }, '← Back'),
      h('button', { class: 'btn btn-primary', onClick: () => window.print() }, '🖨 Print / save as PDF')),
    h('h1', {}, `Calibration report — ${p.filament.manufacturer} ${mat.label} ${p.filament.color}`),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Overview'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('tbody', {},
        row('Filament', `${p.filament.manufacturer} ${p.filament.productLine} — ${mat.label}${p.filament.materialOther ? ` (${p.filament.materialOther})` : ''}, ${p.filament.color}, ${p.filament.diameter} mm`),
        row('Printer', printer ? `${printer.name} (${printer.manufacturer}) — ${printer.nozzleDiameter} mm ${p.nozzleType} nozzle, ${printer.extruderType === 'direct' ? 'direct drive' : 'Bowden'}` : '(printer profile deleted)'),
        row('Printer limits', printer ? `nozzle ≤ ${printer.maxNozzleTemp} °C · bed ≤ ${printer.maxBedTemp} °C · flow ${printer.maxVolumetricFlow ? `≤ ${printer.maxVolumetricFlow} mm³/s` : 'unrated'}` : '—'),
        row('Slicer', `${slicer.slicerLabel} ${p.slicer.version} (instructions verified ${slicer.verifiedOn})`),
        row('Starting profile', p.filament.startingProfile || '—'),
        row('Calibration date', p.calibrationDate),
        row('Completion', `${completionPercent(p)}%`),
        row('Confidence score', `${conf.score}/100 — ${confidenceLabel(conf.score)}`),
        p.notes ? row('Notes', p.notes) : null
      )))
    ),
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Final values'),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('tbody', {},
        p.finals.nozzleTemp !== undefined ? row('Nozzle temperature', `${p.finals.nozzleTemp} °C`) : null,
        p.finals.firstLayerTemp !== undefined ? row('First-layer temperature', `${p.finals.firstLayerTemp} °C`) : null,
        p.finals.highFlowTemp !== undefined ? row('High-flow temperature', `${p.finals.highFlowTemp} °C`) : null,
        p.finals.flowRatio !== undefined ? row('Flow ratio', String(p.finals.flowRatio)) : null,
        p.finals.pressureAdvance !== undefined ? row('Pressure advance', String(p.finals.pressureAdvance)) : null,
        p.finals.retractionDistance !== undefined ? row('Retraction length', `${p.finals.retractionDistance} mm`) : null,
        p.finals.retractionSpeed !== undefined ? row('Retraction speed', `${p.finals.retractionSpeed} mm/s`) : null,
        p.finals.maxVolumetricSpeed !== undefined ? row('Max volumetric speed', `${p.finals.maxVolumetricSpeed} mm³/s`) : null,
        p.finals.shrinkagePercent !== undefined ? row('Shrinkage (XY)', `${p.finals.shrinkagePercent}%`) : null
      )))
    )
  );

  // Per-test detail
  for (const sid of p.stepOrder) {
    const st = p.steps[sid];
    const def = getCalibration(sid);
    if (!st || (!st.current && !st.history.length)) continue;
    const a = st.current;
    root.append(h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, `${def.icon} ${def.name}`),
      h('p', {}, statusText(st.status), st.retestRecommended ? ' · retest recommended' : '',
        a?.confidence ? ` · confidence: ${a.confidence}` : ''),
      a ? h('div', { class: 'table-scroll' }, h('table', { class: 'data' }, h('tbody', {},
        a.method ? row('Method', a.method) : null,
        row('Test settings', kv(a.settings)),
        row('Result entry', kv(a.result)),
        row('Computed', kv(a.computed)),
        a.notes ? row('Notes', a.notes) : null,
        row('Completed', a.completedAt ? new Date(a.completedAt).toLocaleString() : '—')
      ))) : null,
      st.history.length ? h('p', { class: 'field-help' }, `${st.history.length} earlier attempt(s) preserved in history.`) : null
    ));
  }

  // Timeline
  root.append(h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Timeline'),
    h('ul', { class: 'timeline' }, [...p.timeline].reverse().map(e => h('li', {},
      h('div', { class: 'tl-time' }, new Date(e.at).toLocaleString()),
      h('div', {}, h('strong', {}, e.stepId === 'project' ? 'Project' : getCalibration(e.stepId as CalibrationId).shortName), ` — ${e.summary}`))))
  ));
}

function row(k: string, v: string): HTMLElement {
  return h('tr', {}, h('th', { style: 'width:220px' }, k), h('td', {}, v));
}
function kv(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ') || '—';
}
function statusText(s: string): string {
  return s === 'completed' ? '✓ Completed' : s === 'skipped' ? '⏭ Skipped' : s === 'in-progress' ? '▶ In progress' : '— Not started';
}
