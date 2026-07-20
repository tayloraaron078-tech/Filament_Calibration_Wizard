// Diagnostic probe for the profile scanner (issue: stock baselines not
// suggested on H2S). Replicates the native scan + adapter filter +
// recommendation eligibility in plain Node, read-only, against the real
// slicer data dir. Run on the machine with Bambu Studio installed:
//
//   node scripts/probe-scan.mjs                 (defaults: BambuStudio, H2S, 0.4)
//   node scripts/probe-scan.mjs OrcaSlicer "Bambu Lab H2S" 0.4
//
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [, , dataDirName = 'BambuStudio', printerName = 'Bambu Lab H2S', nozzleArg = '0.4'] = process.argv;
const nozzle = Number(nozzleArg);
const appdata = process.env.APPDATA;
if (!appdata) { console.error('APPDATA not set — run this on Windows.'); process.exit(1); }
const root = join(appdata, dataDirName);
console.log(`\n=== PerfectFit scan probe ===\nData dir: ${root}\nPrinter: "${printerName}" · nozzle ${nozzle}\n`);
if (!existsSync(root)) { console.error(`NOT FOUND: ${root}`); process.exit(1); }

const jsonsIn = d => { try { return readdirSync(d).filter(f => f.toLowerCase().endsWith('.json')).map(f => join(d, f)); } catch { return []; } };
const subdirsIn = d => { try { return readdirSync(d).map(n => join(d, n)).filter(p => { try { return statSync(p).isDirectory(); } catch { return false; } }); } catch { return []; } };

// --- user locations ---------------------------------------------------------
console.log('--- user locations (user/{account}/filament) ---');
for (const acct of subdirsIn(join(root, 'user'))) {
  const n = jsonsIn(join(acct, 'filament')).length;
  console.log(`  ${acct.split(/[\\/]/).pop()}: ${n} filament preset(s)`);
}

// --- system libraries (this is what scan_slicer_profiles reads) -------------
const systemRoot = join(root, 'system');
console.log(`\n--- system libraries (${systemRoot}) ---`);
if (!existsSync(systemRoot)) {
  console.log('  !! system/ DOES NOT EXIST — the native scan finds 0 stock presets.');
  console.log('  !! ROOT CAUSE if you see this: stock suggestions can never work.');
  process.exit(0);
}

// Token match replicating recommendations.ts printerCompatible()
const STOP = new Set(['bambu','lab','printer','nozzle','mm','the','edition','series','orca','flashforge','elegoo','snapmaker','creality','3d']);
const toks = s => new Set(s.toLowerCase().replace(/\d+\.\d+\s*nozzle/g,' ').replace(/[^a-z0-9]+/g,' ').split(' ').filter(t => t.length >= 2 && !STOP.has(t)));
const printerToks = toks(printerName);
const modelMatches = model => { for (const t of toks(model)) if (printerToks.has(t)) return true; return false; };
const nozzlesOf = names => names.map(n => /(\d+\.\d+)\s*nozzle/i.exec(n)).filter(Boolean).map(m => Number(m[1]));

let total = 0, typed = 0, concrete = 0, printerOk = 0;
const samples = [];
for (const vendorDir of subdirsIn(systemRoot)) {
  const vendor = vendorDir.split(/[\\/]/).pop();
  // exact layout the Rust scan uses: system/{Vendor}/filament/*.json (flat)
  const flat = jsonsIn(join(vendorDir, 'filament'));
  // also check for nested subdirs the Rust scan would MISS
  const nestedDirs = subdirsIn(join(vendorDir, 'filament'));
  const nested = nestedDirs.flatMap(d => jsonsIn(d));
  if (flat.length + nested.length === 0) continue;
  console.log(`  ${vendor}: ${flat.length} flat json(s)` + (nested.length ? ` + ${nested.length} in SUBDIRS (${nestedDirs.map(d => d.split(/[\\/]/).pop()).join(', ')}) — Rust scan_dir is NOT recursive, these are MISSED` : ''));
  for (const f of flat) {
    total++;
    let d; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (d.type !== 'filament') continue; typed++;
    if (d.instantiation === 'false') continue; concrete++;
    const compat = Array.isArray(d.compatible_printers) ? d.compatible_printers : [];
    const models = compat.map(n => n.replace(/\s+\d+\.\d+\s*nozzle.*$/i,'').trim());
    const nozzles = nozzlesOf(compat);
    const pOk = (nozzles.length === 0 || nozzles.includes(nozzle)) && (models.length === 0 || models.some(modelMatches));
    if (pOk) {
      printerOk++;
      if (samples.length < 5) samples.push({ name: d.name, filament_type: d.filament_type ?? '(none — inherited)', compatible_printers: compat.slice(0,2) });
    }
  }
}
console.log(`\n--- verdict ---`);
console.log(`  system jsons scanned (flat): ${total}`);
console.log(`  type==="filament":           ${typed}   ${typed === 0 && total > 0 ? '<– !! adapter filter drops everything (check "type" field)' : ''}`);
console.log(`  concrete (instantiation):    ${concrete}`);
console.log(`  pass printer+nozzle match:   ${printerOk}  ${printerOk === 0 && concrete > 0 ? '<– !! printerCompatible() rejects all (naming mismatch?)' : ''}`);
if (samples.length) {
  console.log(`\n  sample qualifying stock presets:`);
  for (const s of samples) console.log(`   · ${s.name} | filament_type=${JSON.stringify(s.filament_type)} | printers=${JSON.stringify(s.compatible_printers)}…`);
  console.log(`\n  Stock presets DO qualify here — if the app still shows only user`);
  console.log(`  profiles, the bug is between the native scan and recommendProfiles`);
  console.log(`  (check the new scan-count line in the wizard, step 2).`);
}
