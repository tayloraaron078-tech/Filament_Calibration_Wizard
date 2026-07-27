// ---------------------------------------------------------------------------
// Automated Calibration Pipeline — UI entry screen (Stage 7, increment 1).
//
// Reachable at #/automated/:id, gated behind the `automatedCalibration`
// experimental flag (also linked from the project page when the flag is on).
// This increment covers: engine detection/status, and starting an automated
// session for a project using the printer + material the user already chose
// manually — no new printer/material picker is needed for that, since a
// CalibrationProject already carries `printerProfileId`/nozzle/`filament`.
//
// Preparing + slicing individual steps is a later increment; this screen
// shows the ordered, slice-needing steps and their readiness so the shape of
// what's coming is visible, without wiring the prepare/slice actions yet.
// ---------------------------------------------------------------------------

import { h, clear, toast } from './dom';
import { getProject, getPrinter, saveProject } from '../storage/store';
import { getCalibration } from '../data/calibrations';
import { getMaterial } from '../data/materials';
import {
  isAutomatedCalibrationEnabled,
  discoverEngines,
  InstalledOrcaEngine,
  beginSession,
  buildWorkingProfile,
  loadSessionSafe,
  stepReadiness,
  orderWorkflow,
  getStepDefinition,
  type EngineStatus,
  type PrinterSelection,
  type AutomatedCalibrationSession
} from '../automatedCalibration';

export async function renderAutomated(root: HTMLElement, id: string): Promise<void> {
  const p = await getProject(id);
  if (!p) {
    root.append(h('div', { class: 'card' },
      h('h1', {}, 'Project not found'),
      h('p', {}, 'It may have been deleted on this device.'),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard')));
    return;
  }

  root.append(h('p', {}, h('a', { href: `#/project/${p.id}` }, '← Back to project')));

  if (!isAutomatedCalibrationEnabled()) {
    root.append(h('div', { class: 'card' },
      h('h1', {}, '🤖 Automated calibration'),
      h('p', {}, 'This feature is experimental and off by default.'),
      h('a', { class: 'btn btn-primary', href: '#/settings' }, 'Turn it on in Settings')));
    return;
  }

  const load = loadSessionSafe(p);
  if (load.degraded) {
    await saveProject(p);
    load.warnings.forEach(w => toast(w, 'error'));
  }

  root.append(
    h('h1', {}, '🤖 Automated calibration'),
    h('p', { class: 'field-help' },
      'Experimental. PerfectFit prepares and slices each calibration test itself using an OrcaSlicer install you already have — you review the finished project and print it. Nothing in your slicer’s presets is changed.')
  );

  const rerender = async () => { clear(root); await renderAutomated(root, id); };
  const engine = new InstalledOrcaEngine();

  // --- engine status card ---
  const engineCard = h('div', { class: 'card' });
  root.append(engineCard);
  const paintEngineCard = async (): Promise<ReturnType<typeof discoverEngines> extends Promise<infer T> ? T : never> => {
    clear(engineCard);
    const diag = await discoverEngines();
    engineCard.append(h('h2', { style: 'margin-top:0' }, 'Slicing engine'));
    if (!diag.desktop) {
      engineCard.append(h('div', { class: 'callout callout-warn' },
        h('p', {}, 'Automated slicing needs the PerfectFit desktop app — this browser build can only show what would happen.')));
    }
    diag.engines.forEach(e => engineCard.append(engineStatusRow(e)));
    diag.warnings.forEach(w => engineCard.append(h('p', { class: 'field-help' }, w)));
    engineCard.append(h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-sm', onClick: async () => { await engine.detect(); await paintEngineCard(); }
      }, '🔄 Re-check')));
    return diag;
  };
  const diag = await paintEngineCard();
  await engine.detect();

  // --- session card ---
  const sessionCard = h('div', { class: 'card' });
  root.append(sessionCard);

  if (!load.automated) {
    const printer = await getPrinter(p.printerProfileId);
    const mat = getMaterial(p.filament.material);
    const canStart = diag.recommendedEngineId === 'installed_orca' && !!printer;

    sessionCard.append(h('div', {},
      h('h2', { style: 'margin-top:0' }, 'Start an automated session'),
      h('p', {}, `Uses the printer and material already set on this project: `,
        h('strong', {}, printer ? `${printer.name} · ${printer.nozzleDiameter} mm` : 'no printer profile set'),
        ` · `, h('strong', {}, mat.label), '.'),
      !printer ? h('p', { class: 'callout callout-warn' }, 'This project has no printer profile — set one on the project page first.') : null,
      diag.recommendedEngineId !== 'installed_orca'
        ? h('p', { class: 'callout callout-warn' }, 'No usable OrcaSlicer install was detected — install OrcaSlicer 2.4.x, or select its executable, then re-check above.')
        : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary', disabled: !canStart, onClick: async () => {
            if (!printer) return;
            const selection: PrinterSelection = {
              printerProfileId: p.printerProfileId,
              nozzleDiameterMm: printer.nozzleDiameter,
              slicer: p.slicer.slicer
            };
            try {
              const resolved = await engine.resolveForMaterial(selection, p.filament.material);
              const workingProfile = buildWorkingProfile({
                projectId: p.id,
                displayName: `${mat.label} · ${printer.name}`,
                sourceProfileName: resolved.printerSettingsId ?? undefined
              });
              beginSession(p, { slicerMode: 'installed_orca', engineId: 'installed_orca', workingProfile });
              await saveProject(p);
              toast(`Session started on ${resolved.printerModel ?? printer.name}.`, 'success');
              await rerender();
            } catch (err) {
              toast(describeResolveError(err), 'error');
            }
          }
        }, '▶ Start automated session')
      )
    ));
    return;
  }

  // A usable session exists (load.automated === true guarantees these fields
  // are actually present at runtime; the intersection type itself still marks
  // them optional, so the fallbacks below are for the type checker only).
  const session = p as AutomatedCalibrationSession;
  const status = session.sessionStatus ?? 'created';
  const workingProfile = session.workingProfile!;
  const statusLabel: Record<string, string> = {
    created: 'Created', in_progress: 'In progress', waiting_for_print: 'Waiting for print',
    waiting_for_result: 'Waiting for result', completed: 'Completed', cancelled: 'Cancelled', failed: 'Failed'
  };
  sessionCard.append(h('div', {},
    h('h2', { style: 'margin-top:0' }, 'Session'),
    h('p', {},
      h('span', { class: `badge ${status === 'completed' ? 'badge-ok' : status === 'failed' || status === 'cancelled' ? 'badge-warn' : 'badge-accent'}` },
        statusLabel[status] ?? status),
      ` · ${workingProfile.displayName}`),
    session.sessionWarnings?.length
      ? h('ul', {}, session.sessionWarnings.map(w => h('li', { class: 'field-help' }, w.message)))
      : null
  ));

  // --- workflow steps preview (prepare/slice actions land in a later increment) ---
  const sliceableSteps = orderWorkflow(p.stepOrder).filter(sid => getStepDefinition(sid).needsSlicing);
  const stepsCard = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Steps this pipeline can slice for you'));
  if (!sliceableSteps.length) {
    stepsCard.append(h('p', { class: 'field-help' }, 'No steps in this project’s workflow support automated slicing yet.'));
  }
  for (const sid of sliceableSteps) {
    const def = getCalibration(sid);
    const readiness = stepReadiness(workingProfile, sid);
    const st = p.steps[sid];
    const done = st?.status === 'completed';
    stepsCard.append(h('div', { class: 'eval-item' },
      h('div', { class: 'eval-icon', 'aria-hidden': 'true' }, def.icon),
      h('div', { style: 'flex:1' },
        h('h4', {}, def.name, ' ',
          done ? h('span', { class: 'badge badge-ok' }, '✓ done') :
          readiness.ready ? h('span', { class: 'badge badge-accent' }, 'ready to prepare') :
          h('span', { class: 'badge badge-info' }, 'needs earlier steps first')),
        !readiness.ready && !done
          ? h('p', { class: 'field-help' }, `Waiting on: ${readiness.missingInputs.join(', ')}`)
          : null
      )
    ));
  }
  root.append(stepsCard);
  root.append(h('p', { class: 'field-help' }, 'Preparing and slicing individual steps lands in the next increment.'));
}

function engineStatusRow(e: EngineStatus): HTMLElement {
  const badge = e.detected && e.valid
    ? h('span', { class: 'badge badge-ok' }, '✓ ready')
    : e.detected
      ? h('span', { class: 'badge badge-warn' }, '⚠ detected, not usable')
      : h('span', { class: 'badge badge-info' }, '— not detected');
  return h('div', { class: 'eval-item' },
    h('div', { style: 'flex:1' },
      h('h4', {}, e.displayName, ' ', badge, e.version ? h('span', { class: 'field-help' }, ` v${e.version}`) : null),
      e.executablePath ? h('p', { class: 'field-help' }, e.executablePath) : null,
      e.errors.length ? h('p', { class: 'field-help' }, e.errors.join(' ')) : null,
      e.warnings.length ? h('p', { class: 'field-help' }, e.warnings.join(' ')) : null
    ));
}

function describeResolveError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('PRINTER_NOT_IN_ORCA')) return 'This printer/nozzle isn’t installed in OrcaSlicer as a machine preset.';
  if (msg.includes('FILAMENT_NOT_FOUND')) return 'No installed OrcaSlicer filament preset matches this material for this printer.';
  if (msg.includes('PRINTER_NOT_FOUND')) return 'This project’s printer profile could not be found.';
  return `Could not start the session: ${msg}`;
}
