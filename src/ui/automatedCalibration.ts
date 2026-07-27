// ---------------------------------------------------------------------------
// Automated Calibration Pipeline — UI entry screen (Stage 7).
//
// Reachable at #/automated/:id, gated behind the `automatedCalibration`
// experimental flag (also linked from the project page when the flag is on).
//
// increment 1: engine detection/status, and starting an automated session for
// a project using the printer + material the user already chose manually —
// no new printer/material picker is needed for that, since a
// CalibrationProject already carries `printerProfileId`/nozzle/`filament`.
//
// increment 2: the actual per-step prepare → slice → review loop. Recording
// the MEASURED result (what the user observed on the physical print) is
// deliberately NOT reimplemented here — that's identical to the manual
// workflow's existing result-entry step regardless of how the test was
// sliced, so a successful slice links straight to `#/wizard/:id/:step`
// instead of duplicating that UI.
//
// increment 3: surfaces a resumable session from the dashboard (see
// dashboard.ts), and lets the user cancel a session in progress. A
// cancelled/failed session's steps card is replaced with a restart prompt
// (beginSession again); a completed session just points back at the project.
// ---------------------------------------------------------------------------

import { h, clear, toast, confirmDialog } from './dom';
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
  cancelSession,
  stepReadiness,
  orderWorkflow,
  getStepDefinition,
  type EngineStatus,
  type PrinterSelection,
  type AutomatedCalibrationSession,
  type CalibrationStepDefinition,
  type ResolvedPrinterPreset
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

  const printer = await getPrinter(p.printerProfileId);
  const mat = getMaterial(p.filament.material);
  // PrinterSelection.printerProfileId is the STATIC printer-database id
  // (PrinterSpecification.id, e.g. "bambu-lab-x1-carbon") that resolveForMaterial
  // looks up via getPrinterSpec — NOT this saved PrinterProfile's own IndexedDB
  // uuid. Only printers created from (or since re-matched to) the database
  // carry that link; a hand-entered printer has no database counterpart to map
  // to an installed Orca machine preset.
  const selection: PrinterSelection | null = printer?.databasePrinterId
    ? { printerProfileId: printer.databasePrinterId, nozzleDiameterMm: printer.nozzleDiameter, slicer: p.slicer.slicer }
    : null;

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
    const canStart = diag.recommendedEngineId === 'installed_orca' && !!selection;

    sessionCard.append(h('div', {},
      h('h2', { style: 'margin-top:0' }, 'Start an automated session'),
      h('p', {}, `Uses the printer and material already set on this project: `,
        h('strong', {}, printer ? `${printer.name} · ${printer.nozzleDiameter} mm` : 'no printer profile set'),
        ` · `, h('strong', {}, mat.label), '.'),
      !printer ? h('p', { class: 'callout callout-warn' }, 'This project has no printer profile — set one on the project page first.') : null,
      printer && !selection ? h('p', { class: 'callout callout-warn' },
        'This printer profile isn’t linked to PerfectFit’s printer database, so it can’t be matched to an installed OrcaSlicer machine preset yet. Re-select it from the database on the Printers page (or add it there) to enable automated calibration.') : null,
      diag.recommendedEngineId !== 'installed_orca'
        ? h('p', { class: 'callout callout-warn' }, 'No usable OrcaSlicer install was detected — install OrcaSlicer 2.4.x, or select its executable, then re-check above.')
        : null,
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary', disabled: !canStart, onClick: async () => {
            if (!selection || !printer) return;
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
  const terminal = status === 'completed' || status === 'cancelled' || status === 'failed';
  sessionCard.append(h('div', {},
    h('h2', { style: 'margin-top:0' }, 'Session'),
    h('p', {},
      h('span', { class: `badge ${status === 'completed' ? 'badge-ok' : status === 'failed' || status === 'cancelled' ? 'badge-warn' : 'badge-accent'}` },
        statusLabel[status] ?? status),
      ` · ${workingProfile.displayName}`),
    session.sessionWarnings?.length
      ? h('ul', {}, session.sessionWarnings.map(w => h('li', { class: 'field-help' }, w.message)))
      : null,
    !terminal ? h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-sm btn-danger', onClick: async () => {
          const ok = await confirmDialog({
            title: 'Cancel this automated session?',
            body: 'Any test you already prepared/sliced stays on disk, but the session stops here. Your recorded calibration results are never affected — you can still finish this project manually, or start a new automated session later.',
            confirmLabel: 'Cancel session', danger: true
          });
          if (!ok) return;
          cancelSession(p);
          await saveProject(p);
          toast('Automated session cancelled.', 'info');
          await rerender();
        }
      }, '✖ Cancel session')
    ) : null
  ));

  if (status === 'cancelled' || status === 'failed') {
    root.append(h('div', { class: 'card' },
      h('p', { class: 'callout callout-warn' },
        `This session was ${status}. Starting a new one uses the same printer and material and begins fresh.`),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary', disabled: !selection || !printer, onClick: async () => {
            if (!selection || !printer) return;
            try {
              const resolved = await engine.resolveForMaterial(selection, p.filament.material);
              const newProfile = buildWorkingProfile({
                projectId: p.id,
                displayName: `${mat.label} · ${printer.name}`,
                sourceProfileName: resolved.printerSettingsId ?? undefined
              });
              beginSession(p, { slicerMode: 'installed_orca', engineId: 'installed_orca', workingProfile: newProfile });
              await saveProject(p);
              toast('New automated session started.', 'success');
              await rerender();
            } catch (err) {
              toast(describeResolveError(err), 'error');
            }
          }
        }, '▶ Start a new session')
      )
    ));
    return;
  }

  if (status === 'completed') {
    root.append(h('div', { class: 'card' },
      h('p', { class: 'callout callout-ok' }, 'This automated session is complete.'),
      h('a', { class: 'btn btn-primary', href: `#/project/${p.id}` }, '← Back to project')
    ));
    return;
  }

  // --- workflow steps: prepare + slice each one, in place ---
  const canSlice = diag.recommendedEngineId === 'installed_orca' && !!selection;
  const sliceableSteps = orderWorkflow(p.stepOrder).filter(sid => getStepDefinition(sid).needsSlicing);
  const stepsCard = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Steps this pipeline can slice for you'));
  if (!canSlice) {
    stepsCard.append(h('p', { class: 'callout callout-warn' },
      'No usable OrcaSlicer install was detected above — install OrcaSlicer 2.4.x, or select its executable, then re-check.'));
  }
  if (!sliceableSteps.length) {
    stepsCard.append(h('p', { class: 'field-help' }, 'No steps in this project’s workflow support automated slicing yet.'));
  }
  for (const sid of sliceableSteps) {
    const def = getCalibration(sid);
    const stepDef = getStepDefinition(sid);
    const readiness = stepReadiness(workingProfile, sid);
    const st = p.steps[sid];
    const done = st?.status === 'completed';
    const resultBox = h('div', {});
    const runBtn = h('button', {
      class: 'btn btn-sm btn-primary',
      disabled: !canSlice || !readiness.ready,
      onClick: async () => {
        if (!selection || !printer) return;
        (runBtn as HTMLButtonElement).disabled = true;
        await prepareAndSlice({ engine, session, selection, material: p.filament.material, stepDef, resultBox });
        await saveProject(p);
        (runBtn as HTMLButtonElement).disabled = false;
      }
    }, '▶ Prepare & slice') as HTMLButtonElement;

    stepsCard.append(h('div', { class: 'eval-item' },
      h('div', { class: 'eval-icon', 'aria-hidden': 'true' }, def.icon),
      h('div', { style: 'flex:1' },
        h('h4', {}, def.name, ' ',
          done ? h('span', { class: 'badge badge-ok' }, '✓ done') :
          readiness.ready ? h('span', { class: 'badge badge-accent' }, 'ready to prepare') :
          h('span', { class: 'badge badge-info' }, 'needs earlier steps first')),
        !readiness.ready && !done
          ? h('p', { class: 'field-help' }, `Waiting on: ${readiness.missingInputs.join(', ')}`)
          : null,
        resultBox
      ),
      done ? h('a', { class: 'btn btn-sm', href: `#/wizard/${p.id}/${sid}` }, 'Review / redo') : runBtn
    ));
  }
  root.append(stepsCard);
}

/** Prepare a step's project, slice it, and render the outcome into `resultBox`
 *  in place. Never throws — every failure is rendered as a callout. */
async function prepareAndSlice(args: {
  engine: InstalledOrcaEngine;
  session: AutomatedCalibrationSession;
  selection: PrinterSelection;
  material: AutomatedCalibrationSession['filament']['material'];
  stepDef: CalibrationStepDefinition;
  resultBox: HTMLElement;
}): Promise<void> {
  const { engine, session, selection, material, stepDef, resultBox } = args;
  clear(resultBox);
  resultBox.append(h('p', { class: 'field-help' }, '⏳ Resolving your printer + preparing the project…'));
  let resolved: ResolvedPrinterPreset;
  try {
    resolved = await engine.resolveForMaterial(selection, material);
  } catch (err) {
    clear(resultBox);
    resultBox.append(h('p', { class: 'callout callout-bad' }, describeResolveError(err)));
    return;
  }

  let prepared;
  try {
    prepared = await engine.prepareProject(session, stepDef, resolved);
  } catch (err) {
    clear(resultBox);
    resultBox.append(h('p', { class: 'callout callout-bad' }, describePrepareError(err)));
    return;
  }

  clear(resultBox);
  resultBox.append(h('p', { class: 'field-help' }, '⏳ Slicing…'));
  const job = await engine.slice(prepared, { outputDir: prepared.workspaceDir, timeoutMs: 300_000 });
  const inspection = await engine.inspectOutput(job);
  clear(resultBox);

  if (job.succeeded) {
    resultBox.append(h('div', { class: 'callout callout-ok' },
      h('p', {}, `✓ Sliced in ${(job.durationMs / 1000).toFixed(1)}s.`),
      job.outputGcodePath ? h('p', { class: 'field-help' }, job.outputGcodePath) : null,
      inspection.findings.length ? h('ul', {}, inspection.findings.map(f => h('li', {}, f))) : null,
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary btn-sm', href: `#/wizard/${session.id}/${stepDef.id}` },
          '→ Print it, then record your result'))
    ));
  } else {
    resultBox.append(h('div', { class: 'callout callout-bad' },
      h('p', {}, `✖ Slicing did not succeed (exit code ${job.exitCode ?? 'unknown'}).`),
      job.logPath ? h('p', { class: 'field-help' }, `Engine log: ${job.logPath}`) : null,
      inspection.findings.length ? h('ul', {}, inspection.findings.map(f => h('li', {}, f))) : null
    ));
  }
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
  return `Could not resolve your printer: ${msg}`;
}

function describePrepareError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('UNSUPPORTED_ASSET')) return 'This test doesn’t support automated preparation yet.';
  if (msg.includes('ASSET_UNAVAILABLE')) return 'The calibration model for this test couldn’t be found in your OrcaSlicer install.';
  if (msg.includes('ENGINE_NOT_DETECTED')) return 'OrcaSlicer isn’t detected — re-check the slicing engine above.';
  return `Could not prepare this test: ${msg}`;
}
