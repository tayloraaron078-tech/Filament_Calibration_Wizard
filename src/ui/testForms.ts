import { h, field, numberInput, issueList, clear } from './dom';
import type {
  CalibrationId, CalibrationProject, MaterialPreset, PrinterProfile, VerificationMark
} from '../types';
import {
  flowYolo, flowPercent, paTower, paFromSample, retractionFromHeight,
  mvsFromHeight, mvsProduction, volumetricFlow, maxSpeedForFlow, generateRange, roundTo,
  type CalcResult
} from '../logic/formulas';
import {
  suggestTempRange, suggestPaRange, suggestRetractionRange, suggestMvsRange, suggestFlowMethodDefaults
} from '../logic/ranges';
import { validateNumber, validateTestRange, validateAgainstPrinter, validateFlowRatio, type ValidationIssue } from '../logic/validation';
import { VERIFICATION_CATEGORIES } from '../data/calibrations';
import { loadSettings } from '../storage/store';

export interface TestCtx {
  project: CalibrationProject;
  printer?: PrinterProfile;
  material: MaterialPreset;
  method: string;
  coach: boolean;
}

export interface FormBundle {
  el: HTMLElement;
  collect(): { data: Record<string, never> | Record<string, unknown>; issues: ValidationIssue[] };
}

export interface ComputeOutput {
  calcs: CalcResult[];
  computed: Record<string, number | string>;
  finalsPatch: Partial<CalibrationProject['finals']>;
  /** Short lines shown in the "enter this in your slicer" panel. */
  enterInSlicer: { label: string; value: string }[];
  warnings: string[];
}

export interface TestController {
  settingsForm(ctx: TestCtx, prior: Record<string, unknown> | null): FormBundle;
  resultForm(ctx: TestCtx, settings: Record<string, unknown>, prior: Record<string, unknown> | null): FormBundle;
  compute(ctx: TestCtx, settings: Record<string, unknown>, result: Record<string, unknown>): ComputeOutput;
}

const num = (v: unknown): number => Number(v);

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

const temperatureController: TestController = {
  settingsForm(ctx, prior) {
    const sug = suggestTempRange(ctx.material.id, ctx.printer);
    const start = numberInput({ value: prior?.start ?? sug.start, step: 5 });
    const end = numberInput({ value: prior?.end ?? sug.end, step: 5 });
    const step = numberInput({ value: prior?.step ?? sug.step, step: 1, min: 1 });
    const preview = h('div', {});
    const refresh = () => {
      clear(preview);
      const r = generateRange(num(start.value), num(end.value), num(step.value), 0);
      if (r.values.length) {
        preview.append(
          h('p', { class: 'field-help' }, `${r.count} tower blocks: `,
            h('span', { class: 'value-chip' }, r.values.join(' · ') + ' °C')));
      }
      for (const w of r.warnings) preview.append(h('p', { class: 'issue issue-warning' }, '⚠ ' + w));
    };
    [start, end, step].forEach(i => i.addEventListener('input', refresh));
    refresh();

    const el = h('div', {},
      sug.warnings.length ? issueList(sug.warnings.map(w => ({ level: 'warning' as const, message: w }))) : null,
      h('div', { class: 'field-row' },
        field('Start temperature (°C)', start, 'The HOTTER end — Orca towers print hottest block first (bottom).'),
        field('End temperature (°C)', end, 'The cooler end.'),
        field('Step (°C)', step, 'Orca uses 5 °C per block.')
      ),
      preview
    );
    return {
      el,
      collect() {
        const issues = [
          ...validateNumber(start.value, { label: 'Start temperature', min: 140, max: 500 }),
          ...validateNumber(end.value, { label: 'End temperature', min: 140, max: 500 }),
          ...validateTestRange(num(start.value), num(end.value), num(step.value), { label: 'Temperature range', maxSamples: 15 }),
          ...validateAgainstPrinter('nozzleTemp', Math.max(num(start.value), num(end.value)), ctx.printer)
        ];
        return { data: { start: num(start.value), end: num(end.value), step: num(step.value) }, issues };
      }
    };
  },

  resultForm(ctx, settings, prior) {
    const r = generateRange(num(settings.start), num(settings.end), num(settings.step), 0);
    const acceptable = new Set<number>((prior?.acceptableTemps as number[]) ?? []);
    const chipHost = h('div', { class: 'sample-grid', role: 'group', 'aria-label': 'Acceptable temperatures' });
    const normalSel = h('select', {}, h('option', { value: '' }, '— pick —'));

    const refreshNormalOptions = () => {
      const cur = normalSel.value;
      clear(normalSel);
      normalSel.append(h('option', { value: '' }, '— pick —'));
      const source = acceptable.size ? [...acceptable].sort((a, b) => a - b) : r.values;
      source.forEach(t => normalSel.append(h('option', { value: String(t), selected: String(t) === cur }, `${t} °C`)));
    };

    r.values.forEach(t => {
      const chip = h('button', {
        type: 'button', class: 'sample-chip', 'aria-pressed': String(acceptable.has(t)),
        onClick: () => {
          if (acceptable.has(t)) acceptable.delete(t); else acceptable.add(t);
          chip.setAttribute('aria-pressed', String(acceptable.has(t)));
          refreshNormalOptions();
        }
      }, `${t} °C`);
      chipHost.append(chip);
    });
    refreshNormalOptions();
    if (prior?.normalTemp) normalSel.value = String(prior.normalTemp);

    const adhesionChecked = h('input', { type: 'checkbox', checked: prior?.adhesionChecked ?? false });
    const firstLayer = numberInput({ value: prior?.firstLayerTemp ?? '', placeholder: 'optional', step: 5 });
    const highFlow = numberInput({ value: prior?.highFlowTemp ?? '', placeholder: 'optional', step: 5 });

    const unsure = ctx.coach ? h('details', { class: 'why' },
      h('summary', {}, '🤔 I\'m not sure which blocks are best'),
      h('div', { class: 'why-body' },
        h('p', {}, h('strong', {}, 'Q1 — Strength first: '), 'flex each block with pliers. Cross out every block that cracks along a layer line with little force — those are too cold, no matter how clean they look.'),
        h('p', {}, h('strong', {}, 'Q2 — Of the survivors, look between the towers: '), 'heavy hairs/strings? Cross out the worst stringers (usually the hottest blocks).'),
        h('p', {}, h('strong', {}, 'Q3 — Check the overhang/bridge on what\'s left: '), 'droopy, saggy undersides = too hot. Mark everything still standing as acceptable.'),
        h('p', {}, h('strong', {}, 'Still several candidates? '), 'That\'s normal and good — mark them ALL acceptable and pick the middle one as your normal temperature (or the hottest acceptable one if you\'ll print fast).'),
        h('p', {}, h('strong', {}, 'Everything looks equally bad? '), 'Dry the filament and re-check the nozzle for partial clogs — a tower that\'s uniformly ugly usually isn\'t a temperature problem.')
      )) : null;

    const el = h('div', {},
      h('p', {}, 'Mark every temperature that produced an acceptable block (strength included), then choose your normal printing temperature.'),
      chipHost,
      unsure,
      h('div', { class: 'check-item' }, adhesionChecked,
        h('div', {}, h('strong', {}, 'I checked layer adhesion, not just looks'),
          h('p', { class: 'coach-note' }, 'The wizard will not auto-pick the prettiest block — strength decides first, looks second.'))),
      h('div', { class: 'field-row' },
        field('Normal printing temperature (°C)', normalSel, 'Middle of your acceptable range is a safe default; the hotter end if you\'ll print fast.'),
        field('First-layer temperature (°C)', firstLayer, 'Optional: many profiles run the first layer 5–10 °C hotter for adhesion.'),
        field('High-flow temperature (°C)', highFlow, 'Optional: a hotter setting you\'d use for fast printing; useful in the max-flow test later.')
      )
    );
    return {
      el,
      collect() {
        const issues: ValidationIssue[] = [];
        if (!normalSel.value) issues.push({ level: 'error', message: 'Pick a normal printing temperature.' });
        if (!acceptable.size) issues.push({ level: 'warning', message: 'No blocks marked acceptable — marking at least the chosen one helps future comparisons.' });
        if (!adhesionChecked.checked) issues.push({ level: 'warning', message: 'You haven\'t confirmed a strength/adhesion check. Looks alone can be misleading.' });
        if (firstLayer.value !== '') issues.push(...validateNumber(firstLayer.value, { label: 'First-layer temp', min: 140, max: 500 }));
        if (highFlow.value !== '') issues.push(...validateNumber(highFlow.value, { label: 'High-flow temp', min: 140, max: 500 }));
        if (normalSel.value) issues.push(...validateAgainstPrinter('nozzleTemp', num(normalSel.value), ctx.printer));
        return {
          data: {
            acceptableTemps: [...acceptable].sort((a, b) => a - b),
            normalTemp: normalSel.value ? num(normalSel.value) : '',
            firstLayerTemp: firstLayer.value === '' ? '' : num(firstLayer.value),
            highFlowTemp: highFlow.value === '' ? '' : num(highFlow.value),
            adhesionChecked: adhesionChecked.checked
          }, issues
        };
      }
    };
  },

  compute(ctx, settings, result) {
    const normal = num(result.normalTemp);
    const computed: Record<string, number | string> = { normalTemp: normal };
    const enterInSlicer = [{ label: 'Nozzle temperature (other layers)', value: `${normal} °C` }];
    const finalsPatch: ComputeOutput['finalsPatch'] = { nozzleTemp: normal };
    if (result.firstLayerTemp !== '' && result.firstLayerTemp !== undefined) {
      computed.firstLayerTemp = num(result.firstLayerTemp);
      finalsPatch.firstLayerTemp = num(result.firstLayerTemp);
      enterInSlicer.push({ label: 'Nozzle temperature (first layer)', value: `${result.firstLayerTemp} °C` });
    }
    if (result.highFlowTemp !== '' && result.highFlowTemp !== undefined) {
      computed.highFlowTemp = num(result.highFlowTemp);
      finalsPatch.highFlowTemp = num(result.highFlowTemp);
    }
    const warnings: string[] = [];
    const acc = (result.acceptableTemps as number[]) ?? [];
    if (acc.length && (normal === Math.max(...acc) || normal === Math.min(...acc)) && acc.length > 2) {
      warnings.push('You chose an edge of your acceptable range — the middle is usually the safer default.');
    }
    return { calcs: [], computed, finalsPatch, enterInSlicer, warnings };
  }
};

// ---------------------------------------------------------------------------
// Flow pass 1 & 2
// ---------------------------------------------------------------------------

function flowController(pass: 1 | 2): TestController {
  return {
    settingsForm(ctx, prior) {
      const priorRatio = pass === 2
        ? (ctx.project.finals.flowRatio ?? ctx.material.startingFlowRatio)
        : (ctx.project.finals.flowRatio ?? ctx.material.startingFlowRatio);
      const oldRatio = numberInput({ value: prior?.oldRatio ?? priorRatio, step: 0.001 });
      const el = h('div', {},
        field(`Current flow ratio in the slicer profile ${pass === 2 ? '(after Pass 1 was saved)' : ''} *`, oldRatio,
          'Find it under Filament settings → Filament → Flow ratio. A decimal like 0.98 — if the field shows something like 98, that\'s a percentage from another slicer; enter 0.98.'),
        h('p', { class: 'field-help' },
          pass === 1
            ? 'The printed blocks carry their modifiers; you\'ll pick one after printing.'
            : 'Pass 2 blocks run −9% to 0% in 1% steps, relative to the SAVED Pass 1 value.')
      );
      return {
        el,
        collect() {
          const issues = validateFlowRatio(num(oldRatio.value));
          return { data: { oldRatio: num(oldRatio.value), typicalMvs: ctx.material.typicalMvs }, issues };
        }
      };
    },

    resultForm(ctx, settings, prior) {
      const mods = suggestFlowMethodDefaults(pass === 2 ? 'pass2' : ctx.method).modifiers;
      let selected: number | null = (prior?.modifier as number) ?? null;
      const isYolo = pass === 1 && ctx.method.startsWith('yolo');
      const chips = h('div', { class: 'sample-grid', role: 'group', 'aria-label': 'Printed block modifiers' });
      mods.forEach(m => {
        const label = isYolo ? (m > 0 ? `+${m}` : `${m}`) : (m > 0 ? `+${m}%` : `${m}%`);
        const chip = h('button', {
          type: 'button', class: 'sample-chip', 'aria-pressed': String(selected === m),
          onClick: () => {
            selected = m;
            chips.querySelectorAll('.sample-chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
            chip.setAttribute('aria-pressed', 'true');
          }
        }, label);
        chips.append(chip);
      });

      const unsure = ctx.coach ? h('details', { class: 'why' },
        h('summary', {}, '🤔 I\'m not sure which block is best'),
        h('div', { class: 'why-body' },
          h('p', {}, h('strong', {}, 'Q1: '), 'Tilt each block against the light. Do you see parallel grooves/gaps between lines? Those blocks are UNDER-extruded — eliminate them.'),
          h('p', {}, h('strong', {}, 'Q2: '), 'Run a fingernail across the tops. Ridgy, bumpy, "corduroy" texture that catches the nail = OVER-extruded — eliminate those too.'),
          h('p', {}, h('strong', {}, 'Q3: '), 'Usually 2–3 blocks remain. Pick the one closest to the middle of the survivors; when torn between two neighbors, pick the LOWER-flow one (slight under beats slight over for dimensional accuracy).'),
          h('p', {}, h('strong', {}, 'All blocks look identical? '), 'Your lighting is probably too flat — use one strong lamp at a shallow angle, or take a photo with flash from a low angle.')
        )) : null;

      const el = h('div', {},
        h('p', {}, `Pick the block with the smoothest, gap-free, ridge-free top surface. Labels match what's printed on each block (${isYolo ? 'absolute modifiers' : 'percent modifiers'}).`),
        chips, unsure
      );
      return {
        el,
        collect() {
          const issues: ValidationIssue[] = [];
          if (selected === null) issues.push({ level: 'error', message: 'Select the block you judged best.' });
          return { data: { modifier: selected as number }, issues };
        }
      };
    },

    compute(ctx, settings, result) {
      const old = num(settings.oldRatio);
      const mod = num(result.modifier);
      const isYolo = pass === 1 && ctx.method.startsWith('yolo');
      const calc = isYolo ? flowYolo(old, mod) : flowPercent(old, mod);
      const finalsPatch = { flowRatio: calc.rounded };
      return {
        calcs: [calc],
        computed: { newFlowRatio: calc.rounded },
        finalsPatch,
        enterInSlicer: [{ label: 'Flow ratio (decimal — not a percentage)', value: String(calc.rounded) }],
        warnings: calc.warnings
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Pressure advance
// ---------------------------------------------------------------------------

const paController: TestController = {
  settingsForm(ctx, prior) {
    const extruder = ctx.printer?.extruderType ?? 'direct';
    const sug = suggestPaRange(extruder, ctx.material);
    const start = numberInput({ value: prior?.start ?? sug.start, step: 0.001 });
    const end = numberInput({ value: prior?.end ?? sug.end, step: 0.001 });
    const step = numberInput({ value: prior?.step ?? sug.step, step: 0.001 });
    const preview = h('div', {});
    const refresh = () => {
      clear(preview);
      const r = generateRange(num(start.value), num(end.value), num(step.value), 4);
      if (r.count > 0 && r.values.length) preview.append(h('p', { class: 'field-help' }, `${r.count} samples from ${r.values[0]} to ${r.values[r.values.length - 1]}.`));
      for (const w of r.warnings) preview.append(h('p', { class: 'issue issue-warning' }, '⚠ ' + w));
    };
    [start, end, step].forEach(i => i.addEventListener('input', refresh));
    refresh();

    const el = h('div', {},
      h('p', { class: 'field-help' },
        `Suggested range for ${extruder === 'direct' ? 'direct drive' : 'Bowden'}${ctx.material.flexible ? ' + flexible filament' : ''}: ` +
        `${sug.start}–${sug.end} step ${sug.step}. Editable — high-flow hotends often need less.`),
      sug.warnings.length ? issueList(sug.warnings.map(w => ({ level: 'warning' as const, message: w }))) : null,
      h('div', { class: 'field-row' },
        field('Start PA', start), field('End PA', end), field('Step', step)
      ),
      preview
    );
    return {
      el,
      collect() {
        const issues = [
          ...validateNumber(start.value, { label: 'Start PA', min: 0, max: 5 }),
          ...validateNumber(end.value, { label: 'End PA', min: 0, max: 5 }),
          ...validateTestRange(num(start.value), num(end.value), num(step.value), { label: 'PA range', maxSamples: 120 })
        ];
        return { data: { start: num(start.value), end: num(end.value), step: num(step.value) }, issues };
      }
    };
  },

  resultForm(ctx, settings, prior) {
    const method = ctx.method; // tower | pattern | line
    const el = h('div', {});
    let mode: 'height' | 'direct' | 'sample' = method === 'tower' ? 'height' : 'direct';

    const height = numberInput({ value: prior?.measuredHeight ?? '', step: 0.5, placeholder: 'e.g. 8' });
    const direct = numberInput({ value: prior?.directValue ?? '', step: 0.001, placeholder: 'e.g. 0.016' });
    const sampleNo = numberInput({ value: prior?.sampleNumber ?? '', step: 1, placeholder: 'e.g. 9' });
    const zeroBased = h('select', {},
      h('option', { value: 'zero', selected: prior?.numbering !== 'one' }, 'Zero-based — the FIRST sample equals the start value'),
      h('option', { value: 'one', selected: prior?.numbering === 'one' }, 'One-based — I counted the first sample as #1'));

    if (method === 'tower') {
      el.append(
        h('p', {}, 'Examine the tower\'s corners. Find the height where corners are sharpest — no bulge, no gap after the corner — and measure that height from the base in millimeters.'),
        field('Best height (mm)', height, 'Measure with calipers or a steel rule. The tower raises PA once per millimeter of height.')
      );
    } else {
      const modeSel = h('select', {},
        h('option', { value: 'direct', selected: true }, 'I can read the printed PA value next to the best line'),
        h('option', { value: 'sample' }, 'I counted samples instead (labels unreadable)'));
      const directWrap = h('div', {}, field('PA value read from the print', direct, 'Both the line and pattern tests print the values on the plate — reading them directly avoids counting mistakes.'));
      const sampleWrap = h('div', { style: 'display:none' },
        field('Sample number of the best line', sampleNo),
        field('How did you count?', zeroBased, 'This matters: off-by-one here shifts the result a whole step.'));
      modeSel.addEventListener('change', () => {
        mode = modeSel.value as 'direct' | 'sample';
        directWrap.style.display = mode === 'direct' ? '' : 'none';
        sampleWrap.style.display = mode === 'sample' ? '' : 'none';
      });
      el.append(
        h('p', {}, 'Find the line/corner with the most even width: no bulging at the corner, no thin gaps right after it.'),
        field('How will you report the result?', modeSel),
        directWrap, sampleWrap
      );
    }

    if (ctx.coach) {
      el.append(h('details', { class: 'why' },
        h('summary', {}, '🤔 I\'m not sure which sample is best'),
        h('div', { class: 'why-body' },
          h('p', {}, h('strong', {}, 'Q1: '), 'Look at the corners. Swollen/bulging outward with rounded blobs? PA too low there — look HIGHER in the print/values.'),
          h('p', {}, h('strong', {}, 'Q2: '), 'Corners look hollow, chamfered, or the line thins/breaks right after the turn? PA too high there — look LOWER.'),
          h('p', {}, h('strong', {}, 'Q3: '), 'Roughly even? You\'re in the right zone. Between two even-looking candidates, prefer the LOWER value — slightly low PA fails more gracefully than slightly high.'),
          h('p', {}, h('strong', {}, 'The whole print looks identical top to bottom? '), 'Your firmware may be ignoring PA (Marlin without Linear Advance enabled). Check the prerequisites again.')
        )));
    }

    return {
      el,
      collect() {
        const issues: ValidationIssue[] = [];
        const data: Record<string, unknown> = { mode };
        if (method === 'tower') {
          issues.push(...validateNumber(height.value, { label: 'Best height', min: 0, max: 200 }));
          data.measuredHeight = num(height.value);
        } else if (mode === 'direct') {
          issues.push(...validateNumber(direct.value, { label: 'PA value', min: 0, max: 5 }));
          data.directValue = num(direct.value);
        } else {
          issues.push(...validateNumber(sampleNo.value, { label: 'Sample number', min: 0, max: 500, integer: true }));
          data.sampleNumber = num(sampleNo.value);
          data.numbering = zeroBased.value;
        }
        return { data, issues };
      }
    };
  },

  compute(ctx, settings, result) {
    const start = num(settings.start), step = num(settings.step);
    let calc: CalcResult;
    if (ctx.method === 'tower') {
      calc = paTower(start, step, num(result.measuredHeight));
    } else if (result.mode === 'direct') {
      const v = num(result.directValue);
      calc = {
        inputs: { value: v }, formulaText: 'PA read directly from the printed label',
        substituted: `${v}`, raw: v, rounded: roundTo(v, 3), precision: 3, unit: '', warnings: []
      };
    } else {
      calc = paFromSample(start, step, num(result.sampleNumber), result.numbering !== 'one');
    }
    return {
      calcs: [calc],
      computed: { pressureAdvance: calc.rounded },
      finalsPatch: { pressureAdvance: calc.rounded },
      enterInSlicer: [
        { label: 'Enable pressure advance', value: 'checked' },
        { label: ctx.project.slicer.slicer === 'bambu' ? 'K factor (Flow Dynamics)' : 'Pressure advance', value: String(calc.rounded) }
      ],
      warnings: calc.warnings
    };
  }
};

// ---------------------------------------------------------------------------
// Retraction
// ---------------------------------------------------------------------------

const retractionController: TestController = {
  settingsForm(ctx, prior) {
    const extruder = ctx.printer?.extruderType ?? 'direct';
    const sug = suggestRetractionRange(extruder, ctx.material, ctx.printer);
    const start = numberInput({ value: prior?.start ?? sug.start, step: 0.1 });
    const end = numberInput({ value: prior?.end ?? sug.end, step: 0.1 });
    const step = numberInput({ value: prior?.step ?? (extruder === 'bowden' ? 0.2 : 0.1), step: 0.05 });
    const speed = numberInput({ value: prior?.speed ?? '', placeholder: 'leave empty to keep profile default', step: 5 });
    const preview = h('div', {});
    const refresh = () => {
      clear(preview);
      const r = generateRange(num(start.value), num(end.value), num(step.value), 2);
      if (r.values.length) preview.append(h('p', { class: 'field-help' }, `${r.count} sections, ${r.values[0]} → ${r.values[r.values.length - 1]} mm.`));
      for (const w of r.warnings) preview.append(h('p', { class: 'issue issue-warning' }, '⚠ ' + w));
    };
    [start, end, step].forEach(i => i.addEventListener('input', refresh));
    refresh();

    const el = h('div', {},
      h('p', { class: 'field-help' }, `Suggested for ${extruder === 'direct' ? 'direct drive' : 'Bowden'}: ${sug.start}–${sug.end} mm, step ${extruder === 'bowden' ? 0.2 : 0.1}.`),
      sug.warnings.length ? issueList(sug.warnings.map(w => ({ level: 'warning' as const, message: w }))) : null,
      h('div', { class: 'field-row' },
        field('Start length (mm)', start), field('End length (mm)', end), field('Step (mm)', step)
      ),
      field('Retraction speed for this test (mm/s)', speed, 'Optional. Test ONE variable at a time: run the distance tower first at the profile\'s default speed; only test speed afterwards if problems remain.'),
      h('div', { class: 'callout callout-warn' },
        h('p', { class: 'co-title' }, '⚠ More is not better'),
        h('p', {}, 'Long retractions drag soft plastic into the cold zone: clogs, heat creep, and filament grinding. You\'re looking for the SHORTEST distance that\'s acceptably clean.'))
    );
    return {
      el,
      collect() {
        const issues = [
          ...validateNumber(start.value, { label: 'Start length', min: 0, max: 10 }),
          ...validateNumber(end.value, { label: 'End length', min: 0, max: 15 }),
          ...validateTestRange(num(start.value), num(end.value), num(step.value), { label: 'Retraction range', maxSamples: 60 })
        ];
        if (speed.value !== '') issues.push(...validateNumber(speed.value, { label: 'Retraction speed', min: 5, max: 120 }));
        if (num(end.value) > 8) issues.push({ level: 'warning', message: 'Testing beyond 8 mm invites clogs — only Bowden setups with long tubes should go there.' });
        return { data: { start: num(start.value), end: num(end.value), step: num(step.value), speed: speed.value === '' ? '' : num(speed.value) }, issues };
      }
    };
  },

  resultForm(ctx, settings, prior) {
    const byHeight = h('select', {},
      h('option', { value: 'height', selected: prior?.entry !== 'gcode' }, 'I measured the height where the tower becomes clean'),
      h('option', { value: 'gcode', selected: prior?.entry === 'gcode' }, 'I read the exact length from the G-code preview (Calib_Retraction_tower)'));
    const height = numberInput({ value: prior?.bestHeight ?? '', step: 0.5, placeholder: 'mm from base' });
    const gcodeLen = numberInput({ value: prior?.gcodeLength ?? '', step: 0.05, placeholder: 'mm of retraction' });
    const stillStringy = h('input', { type: 'checkbox', checked: prior?.stillStringyAtMax ?? false });
    const grinding = h('input', { type: 'checkbox', checked: prior?.grindingHeard ?? false });

    const heightWrap = h('div', {}, field('Lowest clean height (mm)', height, 'The LOWEST height where stringing stops being objectionable — not the very top.'));
    const gcodeWrap = h('div', { style: prior?.entry === 'gcode' ? '' : 'display:none' },
      field('Retraction length read from G-code (mm)', gcodeLen, 'In the sliced preview, search the G-code for "Calib_Retraction_tower" at your chosen height.'));
    byHeight.addEventListener('change', () => {
      heightWrap.style.display = byHeight.value === 'height' ? '' : 'none';
      gcodeWrap.style.display = byHeight.value === 'gcode' ? '' : 'none';
    });
    if (prior?.entry === 'gcode') heightWrap.style.display = 'none';

    const el = h('div', {},
      field('How are you reporting the result?', byHeight),
      heightWrap, gcodeWrap,
      h('div', { class: 'check-item' }, stillStringy,
        h('div', {}, h('strong', {}, 'Strings persisted even in the top (longest-retraction) sections'),
          h('p', { class: 'coach-note' }, 'If checked, the app will suggest drying the filament and revisiting temperature rather than chasing more retraction.'))),
      h('div', { class: 'check-item' }, grinding,
        h('div', {}, h('strong', {}, 'I heard clicking/grinding during the print'),
          h('p', { class: 'coach-note' }, 'A sign the tested range went too far for this extruder.'))),
      ctx.coach ? h('details', { class: 'why' },
        h('summary', {}, '🤔 What am I looking at?'),
        h('div', { class: 'why-body' },
          h('p', {}, h('strong', {}, 'Fine hairs '), 'that brush away = borderline; acceptable for most people.'),
          h('p', {}, h('strong', {}, 'Thick strings/branches '), '= clearly under-retracted at that height.'),
          h('p', {}, h('strong', {}, 'Gaps right after travels '), '= OVER-retracted (higher sections may show this — prefer a lower height).'),
          h('p', {}, h('strong', {}, 'Clean from the very bottom? '), 'Enter a small height anyway — the official guidance is ~0.2–0.4 mm minimum for direct drive rather than 0.')
        )) : null
    );
    return {
      el,
      collect() {
        const issues: ValidationIssue[] = [];
        const entry = byHeight.value;
        const data: Record<string, unknown> = {
          entry,
          stillStringyAtMax: stillStringy.checked,
          grindingHeard: grinding.checked
        };
        if (entry === 'height') {
          issues.push(...validateNumber(height.value, { label: 'Clean height', min: 0, max: 200 }));
          data.bestHeight = num(height.value);
        } else {
          issues.push(...validateNumber(gcodeLen.value, { label: 'Retraction length', min: 0, max: 15 }));
          data.gcodeLength = num(gcodeLen.value);
        }
        return { data, issues };
      }
    };
  },

  compute(ctx, settings, result) {
    let calc: CalcResult;
    if (result.entry === 'gcode') {
      const v = num(result.gcodeLength);
      calc = {
        inputs: { value: v }, formulaText: 'Length read from Calib_Retraction_tower G-code comment',
        substituted: `${v} mm`, raw: v, rounded: roundTo(v, 2), precision: 2, unit: 'mm', warnings: []
      };
    } else {
      calc = retractionFromHeight(num(settings.start), num(settings.step), num(result.bestHeight));
    }
    const warnings = [...calc.warnings];
    if (result.stillStringyAtMax) {
      warnings.push('Stringing persisted at max retraction — dry the filament and consider a cooler temperature before trusting this value.');
    }
    if (result.grindingHeard) {
      warnings.push('You heard grinding: don\'t use values from the top of the tested range; prefer the lowest acceptable distance.');
    }
    const enterInSlicer = [{ label: 'Retraction length', value: `${calc.rounded} mm` }];
    const finalsPatch: ComputeOutput['finalsPatch'] = { retractionDistance: calc.rounded };
    if (settings.speed !== '' && settings.speed !== undefined) {
      finalsPatch.retractionSpeed = num(settings.speed);
      enterInSlicer.push({ label: 'Retraction speed', value: `${settings.speed} mm/s` });
    }
    return { calcs: [calc], computed: { retractionDistance: calc.rounded }, finalsPatch, enterInSlicer, warnings };
  }
};

// ---------------------------------------------------------------------------
// Max volumetric speed
// ---------------------------------------------------------------------------

const mvsController: TestController = {
  settingsForm(ctx, prior) {
    const sug = suggestMvsRange(ctx.material.id, ctx.printer);
    const settings = loadSettings();
    const start = numberInput({ value: prior?.start ?? sug.start, step: 0.5 });
    const end = numberInput({ value: prior?.end ?? sug.end, step: 0.5 });
    const step = numberInput({ value: prior?.step ?? sug.step, step: 0.1 });
    const temp = numberInput({ value: prior?.temp ?? ctx.project.finals.highFlowTemp ?? ctx.project.finals.nozzleTemp ?? '', step: 5, placeholder: '°C used for the test' });
    const margin = numberInput({ value: prior?.margin ?? Math.round((1 - settings.mvsSafetyMargin) * 100), step: 5, min: 0, max: 50 });

    // calculator
    const lh = numberInput({ value: prior?.layerHeight ?? 0.2, step: 0.04 });
    const lw = numberInput({ value: prior?.lineWidth ?? (ctx.printer ? roundTo(ctx.printer.nozzleDiameter * 1.05, 2) : 0.42), step: 0.02 });
    const spd = numberInput({ value: 150, step: 10 });
    const calcOut = h('p', { class: 'field-help' });
    const refreshCalc = () => {
      const r = volumetricFlow(num(lh.value), num(lw.value), num(spd.value));
      calcOut.textContent = r.warnings.length ? r.warnings[0] :
        `${r.substituted} mm³/s — that's what printing at ${spd.value} mm/s actually demands.`;
    };
    [lh, lw, spd].forEach(i => i.addEventListener('input', refreshCalc));
    refreshCalc();

    const preview = h('div', {});
    const refresh = () => {
      clear(preview);
      const heightNeeded = (num(end.value) - num(start.value)) / num(step.value);
      if (Number.isFinite(heightNeeded) && heightNeeded > 0) {
        preview.append(h('p', { class: 'field-help' }, `Flow ramps ${start.value} → ${end.value} mm³/s over ${heightNeeded.toFixed(0)} mm of tower height (${step.value} mm³/s per mm).`));
      }
      const issues = validateTestRange(num(start.value), num(end.value), num(step.value), { label: 'Flow range', maxSamples: 100 });
      const l = issueList(issues.filter(i => i.level === 'warning')); if (l) preview.append(l);
    };
    [start, end, step].forEach(i => i.addEventListener('input', refresh));
    refresh();

    const el = h('div', {},
      h('div', { class: 'panel' },
        h('h3', { style: 'margin:0 0 .3rem' }, '🧮 What flow do you actually need?'),
        h('div', { class: 'field-row' },
          field('Layer height (mm)', lh), field('Line width (mm)', lw), field('Print speed (mm/s)', spd)),
        calcOut),
      h('div', { class: 'field-row' },
        field('Start (mm³/s)', start), field('End (mm³/s)', end), field('Step (mm³/s per mm)', step)
      ),
      h('div', { class: 'field-row' },
        field('Test temperature (°C)', temp, 'Use your calibrated temp — or your high-flow temp if you set one. Max flow rises with temperature.'),
        field('Safety margin (%)', margin, 'Headroom kept below the measured max. Default 15% — the official guidance is 10–20%, more for critical parts. This is deliberately conservative: the test is a best-case scenario.')
      ),
      preview,
      ctx.printer?.maxVolumetricFlow
        ? h('p', { class: 'field-help' }, `Printer profile limit: ${ctx.printer.maxVolumetricFlow} mm³/s — recommendations will never exceed it.`)
        : h('p', { class: 'field-help' }, 'No max flow set in the printer profile — consider adding the manufacturer\'s rating so recommendations can be capped.'),
      sug.warnings.length ? issueList(sug.warnings.map(w => ({ level: 'warning' as const, message: w }))) : null
    );
    return {
      el,
      collect() {
        const issues = [
          ...validateNumber(start.value, { label: 'Start flow', min: 0.5, max: 100 }),
          ...validateNumber(end.value, { label: 'End flow', min: 1, max: 120 }),
          ...validateTestRange(num(start.value), num(end.value), num(step.value), { label: 'Flow range', maxSamples: 100 }),
          ...validateNumber(margin.value, { label: 'Safety margin', min: 0, max: 50 })
        ];
        if (temp.value !== '') issues.push(...validateAgainstPrinter('nozzleTemp', num(temp.value), ctx.printer));
        return {
          data: {
            start: num(start.value), end: num(end.value), step: num(step.value),
            temp: temp.value === '' ? '' : num(temp.value),
            marginPct: num(margin.value),
            layerHeight: num(lh.value), lineWidth: num(lw.value),
            typicalMvs: ctx.material.typicalMvs
          }, issues
        };
      }
    };
  },

  resultForm(ctx, settings, prior) {
    const modeSel = h('select', {},
      h('option', { value: 'lastGood', selected: (prior?.mode ?? 'lastGood') === 'lastGood' }, 'Height where quality was still GOOD (just below first defects)'),
      h('option', { value: 'firstFail', selected: prior?.mode === 'firstFail' }, 'Height where the FIRST failure appeared'),
      h('option', { value: 'manual', selected: prior?.mode === 'manual' }, 'I\'ll enter a safe limit manually (mm³/s)'));
    const height = numberInput({ value: prior?.height ?? '', step: 0.5, placeholder: 'mm' });
    const manual = numberInput({ value: prior?.manualValue ?? '', step: 0.5, placeholder: 'mm³/s' });
    const clicking = h('input', { type: 'checkbox', checked: prior?.clickingHeard ?? false });

    const heightWrap = h('div', {}, field('Measured height (mm)', height, 'Calipers from the base to the point you identified.'));
    const manualWrap = h('div', { style: 'display:none' }, field('Safe limit (mm³/s)', manual));
    const sync = () => {
      heightWrap.style.display = modeSel.value === 'manual' ? 'none' : '';
      manualWrap.style.display = modeSel.value === 'manual' ? '' : 'none';
    };
    modeSel.addEventListener('change', sync); sync();

    const el = h('div', {},
      h('p', {}, 'Inspect the tower bottom-up: sheen change → rough/gappy walls → weak layers → clicking → failure. Report the point you\'re most confident about.'),
      field('What are you reporting?', modeSel),
      heightWrap, manualWrap,
      h('div', { class: 'check-item' }, clicking,
        h('div', {}, h('strong', {}, 'I heard extruder clicking during the print'),
          h('p', { class: 'coach-note' }, 'Note roughly where — clicking is the extruder losing the fight, a hard limit.'))),
      ctx.coach ? h('details', { class: 'why' },
        h('summary', {}, '🤔 I\'m not sure where it failed'),
        h('div', { class: 'why-body' },
          h('p', {}, h('strong', {}, 'Q1: '), 'Any point where the surface goes from shiny to matte (or the reverse)? That\'s often the earliest warning — note that height.'),
          h('p', {}, h('strong', {}, 'Q2: '), 'Slide a fingertip up the wall: where does it turn rough, thin, or see-through?'),
          h('p', {}, h('strong', {}, 'Q3: '), 'Flex the tower gently near the top — if it feels papery or crackles, weakness started below there.'),
          h('p', {}, h('strong', {}, 'Pick the LOWEST of those heights'), ' and report it as "still good just below". When in doubt, err low: the safety margin protects you, but only if the base measurement isn\'t optimistic.')
        )) : null
    );
    return {
      el,
      collect() {
        const issues: ValidationIssue[] = [];
        const data: Record<string, unknown> = { mode: modeSel.value, clickingHeard: clicking.checked };
        if (modeSel.value === 'manual') {
          issues.push(...validateNumber(manual.value, { label: 'Safe limit', min: 0.5, max: 120 }));
          data.manualValue = num(manual.value);
        } else {
          issues.push(...validateNumber(height.value, { label: 'Measured height', min: 0, max: 300 }));
          data.height = num(height.value);
        }
        return { data, issues };
      }
    };
  },

  compute(ctx, settings, result) {
    const calcs: CalcResult[] = [];
    let measured: number;
    if (result.mode === 'manual') {
      measured = num(result.manualValue);
      calcs.push({
        inputs: { value: measured }, formulaText: 'Manually entered safe limit',
        substituted: `${measured} mm³/s`, raw: measured, rounded: roundTo(measured, 1), precision: 1, unit: 'mm³/s', warnings: []
      });
    } else {
      let h1 = num(result.height);
      const mCalc = mvsFromHeight(num(settings.start), num(settings.step), h1);
      if (result.mode === 'firstFail') {
        mCalc.warnings.push('You reported the FIRST FAILED height — the calculation steps one increment below it to get the last good flow.');
        const adjusted = mvsFromHeight(num(settings.start), num(settings.step), Math.max(0, h1 - 1));
        calcs.push(mCalc);
        measured = adjusted.rounded;
        calcs.push(adjusted);
      } else {
        calcs.push(mCalc);
        measured = mCalc.rounded;
      }
    }
    const marginFactor = 1 - num(settings.marginPct) / 100;
    const prod = mvsProduction(measured, marginFactor, ctx.printer?.maxVolumetricFlow);
    calcs.push(prod);

    const speedExample = maxSpeedForFlow(prod.rounded, num(settings.layerHeight) || 0.2, num(settings.lineWidth) || 0.42);

    const warnings = [...prod.warnings];
    if (result.clickingHeard && result.mode === 'lastGood') {
      warnings.push('You heard clicking — double-check your "still good" height sits clearly below where clicking began.');
    }
    return {
      calcs,
      computed: { measuredMax: measured, productionMvs: prod.rounded, exampleMaxSpeed: speedExample.rounded },
      finalsPatch: { maxVolumetricSpeed: prod.rounded },
      enterInSlicer: [{ label: 'Max volumetric speed', value: `${prod.rounded} mm³/s` }],
      warnings: warnings.concat([`At ${settings.layerHeight || 0.2} mm layers × ${settings.lineWidth || 0.42} mm lines, this supports about ${speedExample.rounded} mm/s.`])
    };
  }
};

// ---------------------------------------------------------------------------
// Final verification
// ---------------------------------------------------------------------------

const verificationController: TestController = {
  settingsForm(ctx, prior) {
    const model = h('input', { type: 'text', value: (prior?.model as string) ?? '', placeholder: 'e.g. 3DBenchy, my bracket v2' });
    const el = h('div', {},
      field('Verification model used', model, 'A torture-style model or a real part — printed with your NORMAL process profile and the newly saved filament preset.'));
    return {
      el,
      collect() {
        return { data: { model: model.value }, issues: model.value.trim() ? [] : [{ level: 'warning' as const, message: 'Recording which model you used helps future comparisons.' }] };
      }
    };
  },

  resultForm(ctx, settings, prior) {
    const marks = new Map<string, VerificationMark>();
    const el = h('div', {},
      h('p', {}, 'Inspect the print category by category. Nothing here is perfectly objective — mark honestly, "Acceptable" is a valid answer.'));
    const options: { v: VerificationMark; label: string; cls: string; icon: string }[] = [
      { v: 'pass', label: 'Pass', cls: 'badge-ok', icon: '✓' },
      { v: 'acceptable', label: 'Acceptable', cls: 'badge-accent', icon: '~' },
      { v: 'needs-adjustment', label: 'Needs adjustment', cls: 'badge-bad', icon: '✖' },
      { v: 'not-tested', label: 'Not tested', cls: 'badge-info', icon: '·' }
    ];
    for (const cat of VERIFICATION_CATEGORIES) {
      const preset = (prior?.[`cat-${cat.id}`] as VerificationMark) ?? null;
      if (preset) marks.set(cat.id, preset);
      const group = h('div', { role: 'radiogroup', 'aria-label': cat.label, class: 'sample-grid' },
        options.map(o => {
          const b = h('button', {
            type: 'button', class: 'sample-chip', 'aria-pressed': String(preset === o.v),
            onClick: () => {
              marks.set(cat.id, o.v);
              group.querySelectorAll('.sample-chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
              b.setAttribute('aria-pressed', 'true');
            }
          }, `${o.icon} ${o.label}`);
          return b;
        }));
      el.append(h('div', { class: 'eval-item' },
        h('div', { style: 'flex:1' },
          h('h4', {}, cat.label),
          ctx.coach ? h('p', { class: 'eval-meaning' }, cat.coachHint) : null,
          group)));
    }
    return {
      el,
      collect() {
        const issues: ValidationIssue[] = [];
        const data: Record<string, unknown> = {};
        let any = false;
        for (const cat of VERIFICATION_CATEGORIES) {
          const m = marks.get(cat.id);
          if (m) { data[`cat-${cat.id}`] = m; any = true; }
          else data[`cat-${cat.id}`] = 'not-tested';
        }
        if (!any) issues.push({ level: 'error', message: 'Mark at least one category.' });
        return { data, issues };
      }
    };
  },

  compute(ctx, settings, result) {
    let pass = 0, acceptable = 0, fail = 0, notTested = 0;
    const failedCats: string[] = [];
    for (const cat of VERIFICATION_CATEGORIES) {
      const m = result[`cat-${cat.id}`] as VerificationMark;
      if (m === 'pass') pass++;
      else if (m === 'acceptable') acceptable++;
      else if (m === 'needs-adjustment') { fail++; failedCats.push(cat.label); }
      else notTested++;
    }
    const verdict = fail === 0
      ? (pass + acceptable > 0 ? 'Profile verified — no category needs adjustment.' : 'Nothing tested yet.')
      : `${fail} categor${fail === 1 ? 'y' : 'ies'} need attention: ${failedCats.join(', ')}.`;
    const warnings: string[] = [];
    if (fail > 0) warnings.push('See the ranked suggestions on the project page — they point to the calibration most likely responsible for each failed category. They are likelihoods, not verdicts.');
    return {
      calcs: [],
      computed: { pass, acceptable, needsAdjustment: fail, notTested, verdict },
      finalsPatch: {},
      enterInSlicer: [],
      warnings
    };
  }
};

export const CONTROLLERS: Record<CalibrationId, TestController> = {
  temperature: temperatureController,
  'flow-pass1': flowController(1),
  'flow-pass2': flowController(2),
  'pressure-advance': paController,
  retraction: retractionController,
  'max-volumetric-speed': mvsController,
  'final-verification': verificationController
};
