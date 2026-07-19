// TEMPORARY harness (deleted after manual tests). Generates the exact preset
// files the PerfectFit app would produce, from a real slicer base profile,
// using the real generator — so the manual install test exercises production
// output. Run: npx vitest run tests/slicerIntegration/_manualGen.spec.ts
import { describe, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getAdapter } from '../../src/slicerIntegration/adapters';
import { buildPatchesFromProject, generateProfile } from '../../src/slicerIntegration/generator';
import type { IntegrationSlicerId } from '../../src/slicerIntegration/types';
import type { CalibrationProject } from '../../src/types';

const OUT = process.env.MANUAL_OUT || 'C:/Users/prsda/AppData/Local/Temp/claude/C--Users-prsda-Documents-GitHub-Filament-Calibration-Wizard/33b513e6-0ab9-4b33-a3bd-fb616ea6babe/scratchpad/gen';

const completed = { status: 'completed' as const, current: null, history: [] };
function project(): CalibrationProject {
  return {
    id: 'manual-e2e', createdAt: '', updatedAt: '', calibrationDate: '2026-07-19',
    filament: { manufacturer: 'TestBrand', productLine: 'E2E', material: 'PLA', color: 'TestGrey', diameter: 1.75, startingProfile: '' },
    printerProfileId: 'p', nozzleType: 'brass', slicer: { slicer: 'orca', version: '2.4.x' }, notes: '', mode: 'expert',
    stepOrder: ['temperature','flow-pass1','flow-pass2','pressure-advance','retraction','max-volumetric-speed','final-verification'],
    steps: { 'temperature':{...completed},'flow-pass1':{...completed},'flow-pass2':{...completed},'pressure-advance':{...completed},'retraction':{...completed},'max-volumetric-speed':{...completed},'final-verification':{...completed} },
    timeline: [], archived: false,
    finals: { nozzleTemp: 213, flowRatio: 1.03, pressureAdvance: 0.041, retractionDistance: 0.85, maxVolumetricSpeed: 17 }
  };
}

// slicer id -> a real base preset file on this machine to clone.
const BASES: { slicer: IntegrationSlicerId; base: string; out: string }[] = [
  { slicer: 'elegoo', base: `${process.env.APPDATA}/ElegooSlicer/user/default/filament/PolyMaker_Petg@Giga_0.6_Nozzle.json`, out: 'elegoo' },
  { slicer: 'orca', base: `${process.env.APPDATA}/OrcaSlicer/user/default/filament/Elegoo Rapid PLA+.json`, out: 'orca' },
  { slicer: 'snapmaker-orca', base: `${process.env.APPDATA}/Snapmaker_Orca/user/default/filament/BAMBU_PLA_BASIC.json`, out: 'snapmaker' },
  { slicer: 'flash-studio', base: `${process.env.APPDATA}/Orca-Flashforge/user/default/filament/TPU 95A - HS.json`, out: 'flash' },
  { slicer: 'bambu', base: `${process.env.APPDATA}/BambuStudio/user/3964423668/filament/Amolen PLA Metal.json`, out: 'bambu' }
];

describe('manual generation harness', () => {
  it('writes generated preset + info per slicer', () => {
    mkdirSync(OUT, { recursive: true });
    const name = 'PerfectFit E2E TEST DELETE-ME';
    for (const { slicer, base, out } of BASES) {
      let json: string;
      try { json = readFileSync(base, 'utf8'); }
      catch (e) { console.log(`SKIP ${slicer}: base not found ${base}`); continue; }
      const adapter = getAdapter(slicer);
      const parsed = adapter.parseProfile({ kind: 'manual-file', fileName: base.split(/[/\\]/).pop()!, json });
      if (!parsed) { console.log(`SKIP ${slicer}: base did not parse`); continue; }
      const p = project();
      const generated = generateProfile({
        slicerId: slicer, baseProfile: parsed.profile, newName: name,
        patches: buildPatchesFromProject(p), targetExtruderIndex: 0, applyToAllExtruders: false, project: p
      }, parsed);
      writeFileSync(join(OUT, `${out}.json`), generated.serialized);
      writeFileSync(join(OUT, `${out}.info`), generated.infoText);
      writeFileSync(join(OUT, `${out}.base.txt`), parsed.profile.name);
      console.log(`${slicer}: base="${parsed.profile.name}" changed=${generated.changedFields.length} extruders_ok`);
    }
  });
});
