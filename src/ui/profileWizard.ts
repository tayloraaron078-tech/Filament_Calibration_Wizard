// ---------------------------------------------------------------------------
// Slicer profile wizard: Choose slicer → Scan → Select base profile →
// Configure → Preview & validate → Export / Install → Success.
//
// Desktop-only actions (detection, scanning, direct install) degrade cleanly
// to manual file selection + download in the browser build.
// ---------------------------------------------------------------------------

import { h, clear, field, toast, confirmDialog, download } from './dom';
import { getProject, getPrinter, saveProject, addTimeline, uid } from '../storage/store';
import type { CalibrationProject, PrinterProfile } from '../types';
import type {
  DetectedFilamentProfile, GeneratedFilamentProfile, GeneratedProfileRecord,
  IntegrationSlicerId, ParsedFilamentProfile, ProfileInstallResult,
  ProfileValidationResult, ScoredProfile, SlicerInstallation, UserDataLocation
} from '../slicerIntegration/types';
import * as bridge from '../slicerIntegration/bridge';
import { detectInstallations, scanProfiles, currentPlatform } from '../slicerIntegration/scanner';
import { getAdapter } from '../slicerIntegration/adapters';
import { recommendProfiles } from '../slicerIntegration/recommendations';
import { buildPatchesFromProject, generateProfile } from '../slicerIntegration/generator';
import { formatChange, summarizeDiff, fullJsonDiff } from '../slicerIntegration/diff';
import { validateGeneratedProfile, unacknowledgedWarnings } from '../slicerIntegration/validation';
import { exportProfile, installProfile } from '../slicerIntegration/installer';
import { defaultProfileName } from '../slicerIntegration/orcaFamily';
import { slicerDisplayName, integrationIdsForProjectSlicer, findVerifiedVersion } from '../slicerIntegration/registry';
import { loadExperimentalFeatures } from '../slicerIntegration/featureFlags';
import { buildDiagnosticReport } from '../slicerIntegration/diagnostics';
import { errorTemplate } from '../slicerIntegration/errors';

type Stage = 'slicer' | 'profiles' | 'configure' | 'preview' | 'result';

interface WizState {
  stage: Stage;
  installations: SlicerInstallation[] | null;
  installation: SlicerInstallation | null;
  location: UserDataLocation | null;
  scan: { profiles: DetectedFilamentProfile[]; parsed: Map<string, ParsedFilamentProfile>; parseFailures: { fileName: string; error: string }[] } | null;
  advanced: boolean;
  filterText: string;
  filterSource: string;
  filterCompatibleOnly: boolean;
  selectedBase: ParsedFilamentProfile | null;
  manualSlicerId: IntegrationSlicerId;
  newName: string;
  targetExtruder: number;
  applyAll: boolean;
  enabledPatchKeys: Set<string> | null;
  generated: GeneratedFilamentProfile | null;
  validation: ProfileValidationResult | null;
  acknowledged: Set<string>;
  installResult: ProfileInstallResult | null;
  exportedTo: string | null;
}

const states = new Map<string, WizState>();

function stateFor(projectId: string): WizState {
  let s = states.get(projectId);
  if (!s) {
    s = {
      stage: 'slicer', installations: null, installation: null, location: null,
      scan: null, advanced: false, filterText: '', filterSource: 'all',
      filterCompatibleOnly: true, selectedBase: null, manualSlicerId: 'orca',
      newName: '', targetExtruder: 0, applyAll: false, enabledPatchKeys: null,
      generated: null, validation: null, acknowledged: new Set(),
      installResult: null, exportedTo: null
    };
    states.set(projectId, s);
  }
  return s;
}

export async function renderProfileWizard(root: HTMLElement, projectId: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) {
    root.append(h('div', { class: 'card' }, h('h1', {}, 'Project not found'),
      h('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard')));
    return;
  }
  const printer = await getPrinter(project.printerProfileId);
  const st = stateFor(projectId);
  const flags = loadExperimentalFeatures();

  if (!flags.slicerProfileGeneration) {
    root.append(h('div', { class: 'card' },
      h('h1', {}, 'Slicer profile generation is disabled'),
      h('p', {}, 'Enable “Experimental: slicer profile generation” in Settings to use this feature.'),
      h('a', { class: 'btn btn-primary', href: `#/project/${projectId}` }, 'Back to project')));
    return;
  }

  const rerender = () => { clear(root); void renderProfileWizard(root, projectId); };

  root.append(
    h('p', {}, h('a', { href: `#/project/${projectId}` }, '← Back to project')),
    h('h1', { style: 'margin:.2rem 0' }, 'Create and Install Filament Profile'),
    h('p', { class: 'field-help' },
      h('span', { class: 'badge badge-warn' }, '🧪 Experimental Profile Installer'), ' ',
      'PerfectFit will back up the affected slicer files before installation. Profile formats can change between slicer versions, so support is verified per version. Export always works.'),
    stageNav(st)
  );

  switch (st.stage) {
    case 'slicer': await renderSlicerStage(root, st, project, rerender); break;
    case 'profiles': await renderProfilesStage(root, st, project, printer, rerender); break;
    case 'configure': renderConfigureStage(root, st, project, printer, rerender); break;
    case 'preview': renderPreviewStage(root, st, project, printer, rerender); break;
    case 'result': renderResultStage(root, st, project, rerender); break;
  }
}

function stageNav(st: WizState): HTMLElement {
  const stages: { id: Stage; label: string }[] = [
    { id: 'slicer', label: '1. Slicer' },
    { id: 'profiles', label: '2. Base profile' },
    { id: 'configure', label: '3. Configure' },
    { id: 'preview', label: '4. Preview & validate' },
    { id: 'result', label: '5. Install / export' }
  ];
  return h('p', {}, stages.map(s =>
    h('span', {
      class: `badge ${st.stage === s.id ? 'badge-accent' : 'badge-info'}`,
      style: 'margin-right:.35rem'
    }, s.label)));
}

// --- stage 1: slicer --------------------------------------------------------

async function renderSlicerStage(
  root: HTMLElement, st: WizState, project: CalibrationProject, rerender: () => void
): Promise<void> {
  const card = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Choose the target slicer'));
  root.append(card);

  if (!bridge.isDesktop()) {
    card.append(
      h('div', { class: 'callout callout-warn' },
        h('p', { class: 'co-title' }, 'Browser mode'),
        h('p', {}, 'Automatic slicer detection and installation require the PerfectFit desktop app. In the browser you can still load an exported profile below, apply your calibration to it, and download the result for manual import.'))
    );
    card.append(manualSelectionBlock(st, project, rerender));
    return;
  }

  if (st.installations === null) {
    card.append(h('p', {}, '🔍 Scanning for installed slicers…'));
    try {
      st.installations = await detectInstallations();
    } catch (e) {
      st.installations = [];
      card.append(h('p', { class: 'field-help' }, `Detection failed: ${String(e)}`));
    }
    rerender();
    return;
  }

  const preferred = integrationIdsForProjectSlicer(project.slicer.slicer);
  const sorted = [...st.installations].sort((a, b) =>
    Number(preferred.includes(b.slicerId)) - Number(preferred.includes(a.slicerId)));

  if (sorted.length === 0) {
    card.append(h('p', {}, 'No supported slicers were detected on this computer.'),
      h('p', { class: 'field-help' }, 'Supported: Orca Slicer, Bambu Studio, Snapmaker Orca, ElegooSlicer, Flash Studio Desktop (Orca-Flashforge). You can still use a profile file directly below.'));
  }

  for (const inst of sorted) {
    const platform = 'windows' as const; // desktop build platform is resolved natively; registry lookup below re-checks
    const verified = findVerifiedVersion(inst.slicerId, inst.version, platform);
    const canInstall = inst.capabilities.canInstallDirectly;
    const locations = inst.userDataLocations;
    const selected = st.installation?.id === inst.id;

    const locationRows = locations.map(loc => h('label', { class: 'check-item', style: 'display:flex;gap:.5rem;align-items:center' },
      h('input', {
        type: 'radio', name: `loc-${inst.id}`,
        checked: selected && st.location?.id === loc.id,
        onChange: () => { st.installation = inst; st.location = loc; st.scan = null; rerender(); }
      }),
      h('div', {},
        h('strong', {}, loc.accountId === 'default' ? 'Local presets' : `Account ${loc.accountId}`),
        loc.active ? h('span', { class: 'badge badge-ok', style: 'margin-left:.35rem' }, 'active in slicer') : null,
        loc.cloudLinked ? h('span', { class: 'badge badge-warn', style: 'margin-left:.35rem' }, 'cloud-linked') : null,
        h('p', { class: 'field-help', style: 'margin:0' }, `${loc.filamentProfileCount} filament preset(s) — ${loc.path}`))
    ));

    card.append(h('div', { class: 'eval-item', style: selected ? 'outline:2px solid var(--accent);border-radius:8px' : '' },
      h('div', { class: 'eval-icon', 'aria-hidden': 'true' }, '🖨'),
      h('div', { style: 'flex:1' },
        h('h4', {}, inst.displayName, ' ',
          h('span', { class: 'badge badge-info' }, inst.version ?? 'version unknown'),
          preferred.includes(inst.slicerId) ? h('span', { class: 'badge badge-accent', style: 'margin-left:.3rem' }, 'matches this project') : null),
        h('p', { class: 'eval-meaning' },
          `Scan: ${inst.capabilities.canScanProfiles ? 'yes' : 'no'} · Generate: yes · Export: yes · Direct install: ${canInstall ? 'verified' : 'not yet verified'}`),
        !verified?.directInstallVerified ? h('p', { class: 'field-help' },
          'This version has not yet been verified for automatic installation. You can still scan profiles, generate, and export for manual import.') : null,
        locations.length > 1 ? h('p', { class: 'field-help' }, 'Multiple preset locations found — pick the one your slicer actually uses (marked “active”).') : null,
        h('div', {}, locationRows)
      ),
      h('div', {},
        h('button', {
          class: 'btn btn-sm btn-primary', onClick: () => {
            st.installation = inst;
            st.location = st.location && locations.some(l => l.id === st.location!.id)
              ? st.location
              : (locations.find(l => l.active) ?? locations[0] ?? null);
            st.scan = null;
            if (!st.location) { toast('This slicer has no user preset folder yet. Open the slicer once, then retry.', 'error'); return; }
            st.stage = 'profiles';
            rerender();
          }
        }, selected ? 'Continue →' : 'Select'))
    ));
  }

  card.append(manualSelectionBlock(st, project, rerender));

  // Diagnostics
  const diagBtn = h('button', {
    class: 'btn btn-ghost btn-sm', onClick: async () => {
      const platform = await currentPlatform();
      const report = buildDiagnosticReport({ appVersion: '1.1.0-experimental', platform, installations: st.installations ?? [] });
      try {
        await navigator.clipboard.writeText(report);
        toast('Diagnostic report copied to clipboard.', 'success');
      } catch {
        download('perfectfit-diagnostics.txt', report, 'text/plain');
      }
    }
  }, '🩺 Copy diagnostic report');
  const diagSave = h('button', {
    class: 'btn btn-ghost btn-sm', onClick: async () => {
      const platform = await currentPlatform();
      download('perfectfit-diagnostics.txt', buildDiagnosticReport({ appVersion: '1.1.0-experimental', platform, installations: st.installations ?? [] }), 'text/plain');
    }
  }, '💾 Save diagnostic report');
  root.append(h('div', { class: 'btn-row' }, diagBtn, diagSave));
}

function manualSelectionBlock(st: WizState, project: CalibrationProject, rerender: () => void): HTMLElement {
  const fileInput = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
  const slicerSelect = h('select', {},
    (['orca', 'bambu', 'snapmaker-orca', 'elegoo', 'flash-studio'] as IntegrationSlicerId[]).map(id =>
      h('option', { value: id, selected: st.manualSlicerId === id }, slicerDisplayName(id)))) as HTMLSelectElement;

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.json')) { toast('Please choose a .json filament preset file.', 'error'); return; }
    const text = await f.text();
    st.manualSlicerId = slicerSelect.value as IntegrationSlicerId;
    try {
      const parsed = getAdapter(st.manualSlicerId).parseProfile({ kind: 'manual-file', fileName: f.name, json: text });
      if (!parsed) { toast('That file is not a recognizable filament preset.', 'error'); return; }
      if (!parsed.schemaRecognized) {
        const ok = await confirmDialog({
          title: 'Format not recognized',
          body: 'This file does not look like an Orca-family filament preset. Using it as a base may produce a profile the slicer rejects. Continue anyway?',
          confirmLabel: 'Use it anyway', danger: true
        });
        if (!ok) return;
      }
      st.installation = null; st.location = null; st.scan = null;
      st.selectedBase = parsed;
      st.newName = ''; // configure stage fills in the default (with printer suffix)
      st.stage = 'configure';
      rerender();
    } catch (e) {
      toast(`Could not parse that file: ${String(e)}`, 'error');
    }
  });

  return h('div', { style: 'margin-top:1rem;border-top:1px solid var(--surface-2);padding-top:.8rem' },
    h('h3', { style: 'margin:0 0 .3rem' }, 'Use a profile file from another location'),
    h('p', { class: 'field-help' },
      'For experienced users: pick an exported filament preset (.json) to use as the base profile. The original file is never modified. Without a detected slicer, the result is export-only.'),
    h('div', { class: 'field-row' },
      field('Profile file', fileInput),
      field('Which slicer is it from?', slicerSelect))
  );
}

// --- stage 2: base profile selection ---------------------------------------

async function renderProfilesStage(
  root: HTMLElement, st: WizState, project: CalibrationProject,
  printer: PrinterProfile | undefined, rerender: () => void
): Promise<void> {
  if (!st.installation || !st.location) { st.stage = 'slicer'; rerender(); return; }
  const card = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, `Select a base profile — ${st.installation.displayName}`),
    h('p', { class: 'field-help' },
      'PerfectFit clones the base profile and changes only the values you calibrated. Everything else (cooling, speeds, unknown future settings) is preserved. The base profile itself is never modified.'));
  root.append(card);

  if (!st.scan) {
    card.append(h('p', {}, '📂 Scanning filament presets…'));
    try {
      st.scan = await scanProfiles(st.installation.slicerId, st.location);
    } catch (e) {
      card.append(h('div', { class: 'callout callout-warn' },
        h('p', { class: 'co-title' }, 'Scan failed'),
        h('p', {}, String(e)),
        h('button', { class: 'btn', onClick: () => { st.scan = null; rerender(); } }, 'Try again')));
      return;
    }
    rerender();
    return;
  }

  const rec = recommendProfiles(st.scan.profiles, project, printer);

  const choose = (p: DetectedFilamentProfile) => {
    st.selectedBase = st.scan!.parsed.get(p.id) ?? null;
    if (!st.selectedBase) { toast('Internal error: profile not parsed.', 'error'); return; }
    st.newName = defaultName(project, printer);
    st.targetExtruder = 0; st.applyAll = false; st.enabledPatchKeys = null;
    st.stage = 'configure';
    rerender();
  };

  if (!st.advanced) {
    if (rec.best) {
      card.append(recommendedCard(rec.best, true, choose));
      for (const alt of rec.alternatives) card.append(recommendedCard(alt, false, choose));
    } else {
      card.append(h('div', { class: 'callout callout-warn' },
        h('p', { class: 'co-title' }, 'No compatible profile found'),
        h('p', {}, `None of the ${st.scan.profiles.length} scanned presets match your calibrated material (${project.filament.material}). Switch to advanced selection to pick any profile, or choose a generic profile of the right material in your slicer first.`)));
    }
    card.append(h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost', onClick: () => { st.advanced = true; rerender(); } }, '⚙ Advanced: show all profiles'),
      h('button', { class: 'btn btn-ghost', onClick: () => { st.stage = 'slicer'; rerender(); } }, '← Back')));
    return;
  }

  // Advanced mode: full filterable table.
  const search = h('input', { type: 'search', value: st.filterText, placeholder: 'Search name, vendor, material…' }) as HTMLInputElement;
  search.addEventListener('input', () => { st.filterText = search.value; renderTable(); });
  const sourceSel = h('select', {},
    ['all', 'user', 'cloud', 'system', 'project'].map(v =>
      h('option', { value: v, selected: st.filterSource === v }, v === 'all' ? 'All sources' : v))) as HTMLSelectElement;
  sourceSel.addEventListener('change', () => { st.filterSource = sourceSel.value; renderTable(); });
  const compatOnly = h('input', { type: 'checkbox', checked: st.filterCompatibleOnly }) as HTMLInputElement;
  compatOnly.addEventListener('change', () => { st.filterCompatibleOnly = compatOnly.checked; renderTable(); });

  card.append(h('div', { class: 'field-row' },
    field('Search', search), field('Source', sourceSel),
    h('label', { class: 'check-item', style: 'align-self:end' }, compatOnly, h('span', {}, ' Compatible only'))));

  const tableHost = h('div', { class: 'table-scroll' });
  card.append(tableHost);

  const renderTable = () => {
    clear(tableHost);
    const q = st.filterText.trim().toLowerCase();
    let rows = rec.all;
    if (st.filterCompatibleOnly) rows = rows.filter(r => r.compatibility.compatible);
    if (st.filterSource !== 'all') rows = rows.filter(r => r.profile.sourceType === st.filterSource);
    if (q) rows = rows.filter(r =>
      r.profile.name.toLowerCase().includes(q) ||
      (r.profile.vendor ?? '').toLowerCase().includes(q) ||
      (r.profile.materialType ?? '').toLowerCase().includes(q));
    tableHost.append(h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Profile'), h('th', {}, 'Material'), h('th', {}, 'Vendor'),
        h('th', {}, 'Source'), h('th', {}, 'Nozzle'), h('th', {}, 'Score'), h('th', {}, ''))),
      h('tbody', {}, rows.slice(0, 400).map(r => h('tr', {},
        h('td', {},
          r.profile.name,
          r.compatibility.errors.length ? h('span', { class: 'badge badge-warn', style: 'margin-left:.3rem' }, '⚠ incompatible') : null,
          r.profile.warnings.length ? h('span', { title: r.profile.warnings.join('\n'), style: 'cursor:help' }, ' ⚠') : null),
        h('td', {}, r.profile.materialType ?? '—'),
        h('td', {}, r.profile.vendor ?? '—'),
        h('td', {}, r.profile.sourceType),
        h('td', {}, r.profile.compatibleNozzleDiameters.join('/') || '—'),
        h('td', {}, String(r.score)),
        h('td', {}, h('button', {
          class: 'btn btn-sm', onClick: async () => {
            if (r.compatibility.errors.length) {
              const ok = await confirmDialog({
                title: 'Incompatible base profile',
                body: `${r.compatibility.errors.join(' ')} The source profile is never modified, but the generated profile may behave badly. Continue anyway?`,
                confirmLabel: 'Use it anyway', danger: true
              });
              if (!ok) return;
            }
            choose(r.profile);
          }
        }, 'Use as base'))
      )))));
    if (rows.length === 0) tableHost.append(h('p', { class: 'field-help' }, 'No profiles match the current filters.'));
  };
  renderTable();

  if (st.scan.parseFailures.length) {
    card.append(h('p', { class: 'field-help' }, `${st.scan.parseFailures.length} file(s) could not be parsed and are not listed.`));
  }
  card.append(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-ghost', onClick: () => { st.advanced = false; rerender(); } }, '← Recommended view'),
    h('button', { class: 'btn btn-ghost', onClick: () => { st.stage = 'slicer'; rerender(); } }, '← Back to slicer')));
}

function recommendedCard(s: ScoredProfile, best: boolean, choose: (p: DetectedFilamentProfile) => void): HTMLElement {
  return h('div', { class: 'eval-item', style: best ? 'outline:2px solid var(--ok);border-radius:8px' : '' },
    h('div', { class: 'eval-icon', 'aria-hidden': 'true' }, best ? '⭐' : '◽'),
    h('div', { style: 'flex:1' },
      h('h4', {}, best ? 'Recommended: ' : 'Alternative: ', s.profile.name,
        h('span', { class: 'badge badge-info', style: 'margin-left:.3rem' }, s.profile.sourceType)),
      h('p', { class: 'eval-meaning' }, best ? 'Why this is recommended:' : 'Why this is a reasonable choice:'),
      h('ul', { style: 'margin:.2rem 0 .3rem;padding-left:1.2rem' },
        s.reasons.filter(r => r.matched && r.points > 0).slice(0, 6).map(r => h('li', {}, `✓ ${r.label}`))),
      s.compatibility.warnings.length
        ? h('p', { class: 'field-help' }, `⚠ ${s.compatibility.warnings.join(' · ')}`)
        : null),
    h('div', {}, h('button', { class: `btn btn-sm ${best ? 'btn-primary' : ''}`, onClick: () => choose(s.profile) }, best ? 'Continue →' : 'Choose'))
  );
}

// --- stage 3: configure -----------------------------------------------------

function defaultName(project: CalibrationProject, printer: PrinterProfile | undefined): string {
  const mat = project.filament.material === 'OTHER' ? (project.filament.materialOther ?? 'Custom') : project.filament.material;
  return defaultProfileName({
    manufacturer: project.filament.manufacturer, material: mat, color: project.filament.color,
    printerName: printer?.name, nozzle: printer?.nozzleDiameter
  });
}

function renderConfigureStage(
  root: HTMLElement, st: WizState, project: CalibrationProject,
  printer: PrinterProfile | undefined, rerender: () => void
): void {
  const base = st.selectedBase;
  if (!base) { st.stage = 'profiles'; rerender(); return; }
  const allPatches = buildPatchesFromProject(project);
  if (st.enabledPatchKeys === null) st.enabledPatchKeys = new Set(allPatches.map(p => p.presetKey));
  if (!st.newName) st.newName = defaultName(project, printer);

  const card = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Configure the new profile'),
    h('p', { class: 'field-help' }, `Base: ${base.profile.name} (${base.profile.sourceType}${base.profile.parentProfileName ? `, inherits “${base.profile.parentProfileName}”` : ''})`));
  root.append(card);

  const nameInput = h('input', { type: 'text', value: st.newName }) as HTMLInputElement;
  nameInput.addEventListener('input', () => { st.newName = nameInput.value; });
  card.append(field('Profile name', nameInput, 'This becomes the preset name in the slicer and its file name. Only characters invalid for file names are removed.'));

  const dupNames = (st.scan?.profiles ?? []).filter(p => p.sourceType === 'user' || p.sourceType === 'cloud').map(p => p.name);

  if (allPatches.length === 0) {
    card.append(h('div', { class: 'callout callout-warn' },
      h('p', { class: 'co-title' }, 'No calibrated values yet'),
      h('p', {}, 'No completed calibration steps produced values to apply. Finish at least one calibration step first — PerfectFit never patches defaults or guesses.')));
  } else {
    card.append(h('h3', {}, 'Calibrated values to apply'),
      h('p', { class: 'field-help' }, 'Only values from completed calibration steps are listed. Untick anything you don\'t want in the generated profile.'));
    for (const p of allPatches) {
      const cb = h('input', { type: 'checkbox', checked: st.enabledPatchKeys.has(p.presetKey) }) as HTMLInputElement;
      cb.addEventListener('change', () => {
        if (cb.checked) st.enabledPatchKeys!.add(p.presetKey); else st.enabledPatchKeys!.delete(p.presetKey);
      });
      card.append(h('label', { class: 'check-item' }, cb,
        h('div', {}, h('strong', {}, p.label), h('p', { class: 'coach-note' }, `${p.value}${p.unit ? ` ${p.unit}` : ''}`))));
    }
  }

  if (base.extruderCount > 1) {
    const toolSel = h('select', {},
      Array.from({ length: base.extruderCount }, (_, i) =>
        h('option', { value: String(i), selected: st.targetExtruder === i }, `Tool / nozzle ${i + 1}`))) as HTMLSelectElement;
    toolSel.addEventListener('change', () => { st.targetExtruder = Number(toolSel.value); });
    const allCb = h('input', { type: 'checkbox', checked: st.applyAll }) as HTMLInputElement;
    allCb.addEventListener('change', () => { st.applyAll = allCb.checked; toolSel.disabled = allCb.checked; });
    card.append(h('h3', {}, 'Multi-tool profile'),
      h('p', { class: 'field-help' },
        `This profile carries per-tool values for ${base.extruderCount} tools/nozzles. Calibrated values will be written only to the tool you pick; other tools keep their existing values.`),
      h('div', { class: 'field-row' },
        field('Apply calibration to', toolSel),
        h('label', { class: 'check-item', style: 'align-self:end' }, allCb, h('span', {}, ' Apply to ALL tools (only if you calibrated with each)'))));
  }

  card.append(h('div', { class: 'btn-row' },
    h('button', {
      class: 'btn btn-primary', onClick: () => {
        const name = st.newName.trim();
        if (!name) { toast('Enter a profile name.', 'error'); return; }
        const patches = allPatches.filter(p => st.enabledPatchKeys!.has(p.presetKey));
        try {
          st.generated = generateProfile({
            slicerId: base.profile.slicerId, baseProfile: base.profile, newName: name,
            patches, targetExtruderIndex: st.targetExtruder,
            applyToAllExtruders: st.applyAll, project
          }, base);
        } catch (e) {
          toast(String(e), 'error'); return;
        }
        st.validation = validateGeneratedProfile(st.generated, {
          project, printer, baseProfile: base.profile, existingProfileNames: dupNames
        });
        st.acknowledged = new Set();
        st.stage = 'preview';
        rerender();
      }
    }, 'Generate & preview →'),
    h('button', { class: 'btn btn-ghost', onClick: () => { st.stage = st.installation ? 'profiles' : 'slicer'; rerender(); } }, '← Back')));
}

// --- stage 4: preview & validate -------------------------------------------

function renderPreviewStage(
  root: HTMLElement, st: WizState, project: CalibrationProject,
  printer: PrinterProfile | undefined, rerender: () => void
): void {
  const gen = st.generated; const base = st.selectedBase; const val = st.validation;
  if (!gen || !base || !val) { st.stage = 'configure'; rerender(); return; }

  const diff = summarizeDiff(base.profile.rawProfile as Record<string, unknown>, gen);

  const card = h('div', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, 'Preview changes'),
    h('p', {}, h('strong', {}, 'Base profile: '), base.profile.name),
    h('p', {}, h('strong', {}, 'New profile: '), gen.name),
    printer ? h('p', { class: 'field-help' }, `Target printer: ${printer.name} · ${printer.nozzleDiameter} mm nozzle`) : null,
    st.installation ? h('p', { class: 'field-help' }, `Target slicer: ${st.installation.displayName} ${st.installation.version ?? ''} · destination: ${st.location?.path ?? '—'}`) : h('p', { class: 'field-help' }, 'No slicer selected — export only.'));
  root.append(card);

  card.append(h('h3', {}, 'Changes'));
  if (diff.calibrated.length === 0) {
    card.append(h('p', { class: 'field-help' }, 'No calibrated changes — the profile is a renamed copy of the base.'));
  } else {
    card.append(h('ul', { style: 'margin:.2rem 0;padding-left:1.2rem' },
      diff.calibrated.map(c => h('li', {}, formatChange(c)))));
  }
  card.append(h('p', { class: 'field-help' },
    `${diff.preservedFieldCount} field(s) preserved from the base profile. Identity fields updated: ${diff.identity.map(i => i.key).join(', ') || 'none'}.`));

  // full JSON diff (advanced)
  const details = h('details', {},
    h('summary', {}, 'Full JSON diff (advanced)'),
    h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Field'), h('th', {}, 'Before'), h('th', {}, 'After'))),
      h('tbody', {}, fullJsonDiff(base.profile.rawProfile as Record<string, unknown>, gen.data).map(e =>
        h('tr', {}, h('td', {}, e.key), h('td', {}, e.before ?? '—'), h('td', {}, e.after ?? '—')))))));
  card.append(details);

  // validation
  const vCard = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Validation'));
  root.append(vCard);
  if (val.errors.length === 0 && val.warnings.length === 0) {
    vCard.append(h('p', {}, '✅ All checks passed.'));
  }
  if (val.errors.length) {
    vCard.append(h('p', {}, `✖ ${val.errors.length} error(s) — installation and export are blocked until fixed:`),
      h('ul', { class: 'issues' }, val.errors.map(e => h('li', { class: 'issue issue-error' }, `✖ ${e.message}`))));
  }
  if (val.warnings.length) {
    vCard.append(h('p', {}, `⚠ ${val.warnings.length} warning(s):`));
    for (const w of val.warnings) {
      if (w.requiresAcknowledgement) {
        const cb = h('input', { type: 'checkbox', checked: st.acknowledged.has(w.code) }) as HTMLInputElement;
        cb.addEventListener('change', () => { if (cb.checked) st.acknowledged.add(w.code); else st.acknowledged.delete(w.code); });
        vCard.append(h('label', { class: 'check-item' }, cb, h('div', {}, h('strong', {}, 'I understand: '), w.message)));
      } else {
        vCard.append(h('p', { class: 'field-help' }, `⚠ ${w.message}`));
      }
    }
  }

  const pendingAcks = unacknowledgedWarnings(val, [...st.acknowledged]);
  root.append(h('div', { class: 'btn-row' },
    h('button', {
      class: 'btn btn-primary',
      onClick: () => {
        if (!val.valid) { toast('Fix the validation errors first.', 'error'); return; }
        if (unacknowledgedWarnings(val, [...st.acknowledged]).length) { toast('Acknowledge the warnings above first.', 'error'); return; }
        st.stage = 'result'; st.installResult = null; st.exportedTo = null;
        rerender();
      },
      disabled: !val.valid || pendingAcks.length > 0 ? true : undefined
    }, 'Continue →'),
    h('button', { class: 'btn btn-ghost', onClick: () => { st.stage = 'configure'; rerender(); } }, '← Back')));
}

// --- stage 5: install / export ---------------------------------------------

async function persistRecord(
  project: CalibrationProject, st: WizState,
  mode: 'export' | 'install' | 'saved', destination: string | null,
  backupId: string | null, verificationPassed: boolean | null, success: boolean
): Promise<void> {
  const gen = st.generated!;
  project.generatedProfiles = project.generatedProfiles ?? [];
  let rec = project.generatedProfiles.find(r => r.generatedProfileName === gen.name && r.generatedAt === gen.generatedAt);
  if (!rec) {
    rec = {
      id: uid(), projectId: project.id, slicerId: gen.slicerId,
      slicerVersion: st.installation?.version ?? null,
      installationId: st.installation?.id ?? null,
      baseProfileName: gen.baseProfileName,
      baseProfileFingerprint: gen.baseProfileFingerprint,
      generatedProfileName: gen.name, generatedAt: gen.generatedAt,
      generatedProfileData: gen.data, generatedInfoText: gen.infoText,
      changedFields: gen.changedFields, validation: st.validation,
      installHistory: []
    } satisfies GeneratedProfileRecord;
    project.generatedProfiles.push(rec);
  }
  rec.installHistory.push({
    at: new Date().toISOString(), mode, slicerId: gen.slicerId,
    slicerVersion: st.installation?.version ?? null,
    destination, backupId, verificationPassed, success
  });
  addTimeline(project, {
    stepId: 'project', kind: 'note',
    summary: mode === 'install'
      ? `Slicer profile “${gen.name}” ${success ? 'installed into' : 'failed to install into'} ${slicerDisplayName(gen.slicerId)}`
      : mode === 'export'
        ? `Slicer profile “${gen.name}” exported`
        : `Slicer profile “${gen.name}” saved in project`
  });
  await saveProject(project);
}

function renderResultStage(
  root: HTMLElement, st: WizState, project: CalibrationProject, rerender: () => void
): void {
  const gen = st.generated;
  if (!gen) { st.stage = 'configure'; rerender(); return; }
  const flags = loadExperimentalFeatures();
  const canInstall = !!st.installation?.capabilities.canInstallDirectly && !!st.location && flags.automaticProfileInstallation;
  const res = st.installResult;

  if (res?.success) {
    const applied = gen.changedFields.map(c => `✓ ${formatChange(c)}`);
    root.append(h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, '✅ Profile Installed Successfully'),
      h('p', {}, h('strong', {}, gen.name), ` — installed into ${st.installation!.displayName}.`),
      h('p', { class: 'field-help' }, `Based on: ${gen.baseProfileName}`),
      h('h3', {}, 'Applied'),
      h('ul', { style: 'margin:.2rem 0;padding-left:1.2rem' }, applied.map(a => h('li', {}, a))),
      h('p', {}, `A backup was created before installation${res.backupId ? ` (id ${res.backupId})` : ''}. The installed file was re-read and verified.`),
      res.warnings.length ? h('p', { class: 'field-help' }, res.warnings.map(w => `⚠ ${w}`).join(' ')) : null,
      h('p', {}, h('strong', {}, `Restart ${st.installation!.displayName} to load the new profile.`)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', onClick: () => bridge.openSlicer(gen.slicerId).catch(e => toast(String(e), 'error')) }, `▶ Launch ${st.installation!.displayName}`),
        h('button', { class: 'btn', onClick: () => bridge.openProfileDirectory(st.location!.path + '\\filament').catch(() => bridge.openProfileDirectory(st.location!.path)).catch(e => toast(String(e), 'error')) }, '📂 Open profile folder'),
        res.backupId ? h('button', { class: 'btn', onClick: () => bridge.openBackupDirectory(res.backupId!).catch(e => toast(String(e), 'error')) }, '🗄 View backup') : null,
        h('a', { class: 'btn', href: `#/report/${project.id}` }, '📄 View calibration report'))
    ));
    return;
  }

  const card = h('div', { class: 'card' }, h('h2', { style: 'margin-top:0' }, 'Install or export'));
  root.append(card);

  if (res && res.error) {
    const t = errorTemplate(res.error.code);
    card.append(h('div', { class: 'callout callout-warn' },
      h('p', { class: 'co-title' }, `✖ ${t.title}`),
      h('p', {}, t.whatHappened, ' ', t.anythingChanged),
      h('ul', { style: 'margin:.2rem 0;padding-left:1.2rem' }, t.nextSteps.map(s2 => h('li', {}, s2))),
      res.error.detail ? h('details', {}, h('summary', {}, 'Technical details'), h('p', { class: 'field-help' }, res.error.detail)) : null,
      res.backupId ? h('p', { class: 'field-help' }, `Backup id: ${res.backupId} (Settings → Slicer profile backups)`) : null));
  }

  // Export
  card.append(h('h3', {}, '1. Export profile file'),
    h('p', { class: 'field-help' }, bridge.isDesktop()
      ? 'Save the generated preset anywhere, then import it in the slicer (Filament settings → import, or drag & drop into the slicer window).'
      : 'Download the generated preset, then import it in the slicer (Filament settings → import, or drag & drop into the slicer window).'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-primary', onClick: async () => {
          try {
            const dest = await exportProfile(gen);
            if (dest === null) return; // cancelled
            st.exportedTo = dest;
            await persistRecord(project, st, 'export', dest, null, null, true);
            toast(dest === 'download' ? 'Profile downloaded.' : `Saved to ${dest}`, 'success');
            rerender();
          } catch (e) { toast(String(e), 'error'); }
        }
      }, '⭳ Export profile'),
      st.exportedTo ? h('span', { class: 'badge badge-ok' }, `exported ✓`) : null));

  // Install
  card.append(h('h3', {}, '2. Install automatically'));
  if (!bridge.isDesktop()) {
    card.append(h('p', { class: 'field-help' }, 'Automatic installation requires the PerfectFit desktop app.'));
  } else if (!st.installation || !st.location) {
    card.append(h('p', { class: 'field-help' }, 'No slicer/location selected (manual file mode) — use export instead.'));
  } else if (!canInstall) {
    card.append(h('p', { class: 'field-help' },
      `Automatic installation is disabled for ${st.installation.displayName} ${st.installation.version ?? ''}: this version has not been verified for direct install yet. Use export — it is just as good, minus one manual import step.`));
  } else {
    card.append(
      h('p', { class: 'field-help' },
        `Destination: ${st.location.path}\\filament\\${gen.fileStem}.json — a timestamped backup is created first, the file is written to a temp file, verified, atomically moved, and re-verified. ${st.installation.displayName} must be closed.`),
      h('div', { class: 'btn-row' },
        h('button', {
          class: 'btn btn-primary', onClick: () => void doInstall(false)
        }, '⚙ Install into slicer')));
  }

  // Save in PerfectFit
  card.append(h('h3', {}, '3. Save inside PerfectFit'),
    h('p', { class: 'field-help' }, 'Keep the generated profile in this calibration project to export or install later.'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn', onClick: async () => {
          await persistRecord(project, st, 'saved', null, null, null, true);
          toast('Profile saved in the project.', 'success');
        }
      }, '💾 Save in project')));

  card.append(h('div', { class: 'btn-row', style: 'margin-top:.6rem' },
    h('button', { class: 'btn btn-ghost', onClick: () => { st.stage = 'preview'; rerender(); } }, '← Back to preview')));

  async function doInstall(allowReplace: boolean): Promise<void> {
    if (!st.installation || !st.location || !gen) return;
    // Live process check with explicit user flow.
    try {
      const running = await bridge.detectRunningSlicerProcess(gen.slicerId);
      if (running) {
        const again = await confirmDialog({
          title: `${st.installation.displayName} is currently open`,
          body: `Close ${st.installation.displayName} before installing this profile so it does not overwrite or ignore the new preset. Click “Check again” after closing it.`,
          confirmLabel: 'Check again'
        });
        if (again) return void doInstall(allowReplace);
        return;
      }
    } catch { /* native check unavailable → the install command re-checks anyway */ }

    const result = await installProfile({
      profile: gen, location: st.location, projectId: project.id, allowReplace
    });

    if (result.error?.code === 'DUPLICATE_PROFILE' && !allowReplace) {
      const replace = await confirmDialog({
        title: 'A profile with this name already exists',
        body: `“${gen.name}” already exists in ${st.installation.displayName}. Replace it? A backup of the existing preset is created first. (Cancel to go back and pick a different name.)`,
        confirmLabel: 'Replace (with backup)', danger: true
      });
      if (replace) return void doInstall(true);
      st.stage = 'configure'; rerender(); return;
    }

    st.installResult = result;
    await persistRecord(project, st, 'install',
      result.installedFiles[0] ?? null, result.backupId, result.verificationPassed, result.success);
    rerender();
  }
}
