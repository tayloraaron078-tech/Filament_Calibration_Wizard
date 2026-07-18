# PerfectFit — Filament Calibration Wizard

Create a perfectly calibrated filament profile for Orca Slicer or Bambu Studio in one guided workflow. No tutorials, no guesswork, no spreadsheets.

A local-first web app that walks you step by step through calibrating a filament profile
for **Orca Slicer** (default) or **Bambu Studio** — temperature, flow ratio (two passes),
pressure advance, retraction, max volumetric speed, and a final verification print —
without tutorials, wikis, or guesswork.

- **Coach Mode**: plain-language guidance, good/bad examples, "I'm not sure" decision helpers,
  confidence checks, adaptive troubleshooting.
- **Expert Mode**: condensed flow — ranges, formulas, destinations.
- **No black boxes**: every calculation shows inputs, formula, substitution, and rounding.
- **Signature features**: calibration timeline, confidence score, smart retest recommendations,
  printable one-page calibration card with QR, printable full report, JSON backup/restore.
- **Privacy**: no account, no backend, no analytics/telemetry. Everything (photos included)
  stays in your browser's local storage. External model links open third-party sites.

## Requirements

- Node.js 18+ (for development/build only — the built app is static files)

## Install & run (development)

```bash
npm install
npm run dev          # http://localhost:5173
```

## Tests

```bash
npm test             # vitest: formulas, ranges, numbering, margins, import/export, migration, validation
```

A human-workflow checklist lives in [docs/MANUAL_TEST_CHECKLIST.md](docs/MANUAL_TEST_CHECKLIST.md).

## Production build

```bash
npm run build        # typechecks, then bundles to dist/
npm run preview      # serve the production bundle locally
```

`dist/` is fully static and uses relative paths — it works from any folder or subpath.

## Hosting on Nginx

```nginx
server {
    listen 80;
    server_name calibration.example.lan;
    root /var/www/perfectfit/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Copy the contents of `dist/` to the `root` directory — nothing else is needed
(no PHP, no database). Apache works identically (`DocumentRoot` at `dist/`).
Served over HTTP(S), the app also installs as a PWA and works offline after first load.

> Data is stored per-browser (IndexedDB + localStorage) under the origin you serve from.
> Moving the app to a different domain/port means starting fresh — export a backup first
> and restore it from Settings.

## Packaging as a Windows .exe (Tauri)

Tauri v2 wraps the static build in a small native shell (preferred over Electron: ~10 MB vs ~150 MB).

```bash
# prerequisites: Rust toolchain (rustup), Microsoft VS C++ Build Tools, WebView2 (preinstalled on Win 11)
npm install -D @tauri-apps/cli
npx tauri init
#   ✔ app name: PerfectFit
#   ✔ dev server URL: http://localhost:5173
#   ✔ frontend dist: ../dist
#   ✔ before dev command: npm run dev
#   ✔ before build command: npm run build
npx tauri dev      # develop inside the native window
npx tauri build    # produces src-tauri/target/release/PerfectFit.exe (+ MSI/NSIS installers)
```

No code changes are required — the app already avoids absolute URLs and needs no server.
Inside Tauri, data persists in the WebView's local storage; the JSON backup/restore in
Settings is the supported migration path between browser and desktop builds.

## Data storage & backups

| What | Where |
|---|---|
| Projects, printer profiles, photos | IndexedDB (`perfectfit-db`) |
| Settings, in-progress form drafts | localStorage |
| Backups | JSON files you export (Settings → Backup) |

- **Backup**: Settings → *Export all data* (optionally with photos, base64-embedded).
- **Restore**: Settings → *Restore from backup*. Imports never overwrite: colliding ids
  are imported as copies.
- Single projects can be exported/imported from the dashboard (printer profile embedded).
- Clearing browser site data deletes everything — back up first.

## Model licensing

Orca Slicer generates **all six core calibration tests in-slicer** — no model downloads are
required. Optional external models (3DBenchy for verification; stringing/extrusion tests for
Bambu Studio gaps) are **linked, not bundled**, because their licenses (e.g. CC BY-ND for
3DBenchy) don't clearly permit redistribution inside an app. See
[public/models/manifest.json](public/models/manifest.json) for source, license, and attribution
of each entry.

## Slicer version compatibility

Instructions are **version-aware data**, not code: `src/data/slicers.ts` holds per-slicer,
per-version content with a `verifiedOn` date (currently: Orca Slicer **2.4.x**, verified
2026-07-18 against the official wiki; Bambu Studio **1.7+**). Updating for a new release
means editing/adding one data entry. Research notes with sources and verified formulas:
[docs/RESEARCH.md](docs/RESEARCH.md).

**Assumptions worth re-verifying when a new slicer version ships:**
- Calibration menu still at top bar → `Calibration` (Orca) / `Calibration` tab (Bambu Studio)
- Temp tower still steps 5 °C per block; retraction/PA towers still step once per mm of height
- Flow YOLO modifiers still ±0.05 @ 0.01; Pass 2 still −9…0%
- Bambu Studio still lacks retraction & max-flow generators

## Architecture

```
src/
  types.ts               # all domain types
  app.ts / main.ts       # shell, hash router, theme, leave-guard
  styles.css             # design system (light/dark, large text, print)
  data/
    calibrations.ts      # the 7 test definitions (structured data, not pages)
    slicers.ts           # version-aware slicer instructions (Orca 2.4.x, Bambu 1.7+)
    materials.ts         # 14 material presets (suggestions only, always editable)
    glossary.ts          # searchable help content
    models.ts            # external model manifest (mirrored in public/models/)
  logic/
    formulas.ts          # formula engine — every calc returns inputs/formula/result/warnings
    ranges.ts            # suggested test ranges from material+printer+extruder
    validation.ts        # numeric/range/printer-limit validation
    confidence.ts        # confidence score
    recommendations.ts   # smart retest recommendations
  storage/               # IndexedDB wrapper + repository, drafts, settings
  export/backup.ts       # JSON export/import with schema versioning & migration
  ui/                    # dashboard, printers, project views, wizard, forms, report, card…
tests/                   # vitest suites (61 tests)
docs/                    # research notes + manual test checklist
```

Adding a calibration test = new entry in `data/calibrations.ts` + a form controller in
`ui/testForms.ts` + slicer steps in `data/slicers.ts`. No page redesign needed.

## Known limitations

- The QR code on the calibration card links to the app URL + project id — it opens the saved
  calibration on any device pointed at the **same hosted instance & browser profile**; it does
  not embed the data itself (the printed card carries the values in plain text).
- No slicer preset **file** export: Orca/Bambu preset JSON formats are version-volatile and
  were not safely verifiable for round-tripping, so the app deliberately guides manual entry
  instead of risking a broken preset. (Candidate for a future "experimental" feature.)
- Photos are stored and exported but not analyzed (AI photo evaluation is a designed-for,
  not-built v1 exclusion, like accounts, cloud sync, and printer control).
- Bambu Studio lacks retraction and max-flow test generators; the app provides honest fallbacks
  rather than pretending.
- Suggested ranges are conservative starting points, not guarantees — spool labels and
  datasheets always win.

## Future ideas

AI-assisted photo evaluation (storage schema already reserves an `analysis` field), photo
comparison, multiple nozzles/printers per filament, printer API integration, experimental
slicer preset export, community preset sharing, filament inventory with drying/spool tracking.
