# Automated Calibration Pipeline — Architecture

> **Status: in development, disabled by default.** This document describes the
> architecture of PerfectFit's automated calibration pipeline as it is built out
> across multiple stages. The feature is gated behind the
> `automatedCalibration` experimental flag, which is **off** until the pipeline
> is complete. The existing manual calibration workflow and the slicer-profile
> installer are unaffected. **Stages 1-8 are complete** (session lifecycle,
> workflow engine, asset registry, engine layer, project generation for all
> three calibration-asset kinds, the guided UX, and the finish handoff into the
> profile generator/installer); Stages 9-10 remain before release.

## Goal

Let PerfectFit manage a whole calibration session: the user picks a printer,
nozzle, slicer workflow, and base filament profile, and PerfectFit prepares and
slices each calibration test itself — so the user no longer hand-drives the
slicer for every test. The user still prints, measures, and enters results, and
PerfectFit **never** starts a print on its own.

This does not replace the manual workflow; it adds an automated path alongside
it. Users without a compatible slicing engine keep the manual experience.

## Non-goals / boundaries

- Do **not** embed OrcaSlicer's UI or copy its source. Orca is driven only as an
  external executable over CLI arguments and files.
- Do **not** reverse-engineer Bambu Cloud or Bambu network protocols. Bambu
  Studio is a manual handoff destination only.
- Do **not** start a physical printer, or label an unsliced 3MF "printer-ready".
- Do **not** silently overwrite user slicer profiles or edit vendor/system
  presets.

## Core strategy: assemble a complete Orca project 3MF

A complete OrcaSlicer **project 3MF** embeds everything needed to slice with no
external preset files:

- `Metadata/project_settings.config` — a **flat, fully-resolved** settings object
  (no `inherits`).
- `Metadata/custom_gcode_per_layer.xml` — optional per-layer injected G-code used
  by parameterized tests (e.g. the pressure-advance pattern).
- `3D/3dmodel.model` — the calibration model geometry.

PerfectFit assembles such a project (calibration model + a `project_settings.config`
that merges the resolved printer/process settings with the session's calibrated
filament values + any test-specific custom G-code) and slices it via the CLI:

```
orca-slicer.exe --datadir <isolated> --outputdir <out> --slice 0 <project.3mf>
```

This mirrors what Orca's own Calibration menu produces internally, so we reuse
Orca's model instead of reverse-engineering an opaque CLI. Preset marshalling
via `--load-settings`/`--load-filaments` is **not** the primary path.

### Verified engine constraints (OrcaSlicer 2.4.2, Windows)

- **Slicing works headless.** A self-contained project 3MF slices to
  `<outputdir>/plate_1.gcode`, exit code 0, with no console.
- **CLI stdout/stderr carries little detail, and capturing it is inconsistent
  across invocation methods.** Redirecting from PowerShell reliably yields
  nothing; redirecting from bash (`orca-slicer.exe ... > out.log 2> err.log`)
  does capture *something*, but Windows builds only ever emit a generic
  `"Slic3r::CLI::run found error, exit"` line — the detailed JSON reason
  (`record_exit_reson()` in Orca's own `OrcaSlicer.cpp`) is compiled
  **Linux-only**, so the specific failure (which exit code, which check
  tripped) never reaches stdout on Windows regardless of how it's captured.
  **Success is judged from the output artifact and Orca's log at
  `<datadir>/log/`, never from stdout** — and when a real Orca exit code needs
  decoding, the authoritative source is Orca's own `src/libslic3r/Utils.hpp`
  (`#define CLI_* -N`), not anything the process prints.
- **Always use an isolated `--datadir`.** This gives readable logs and, critically,
  never touches the user's real Orca configuration (`%APPDATA%/OrcaSlicer/`).

## Key architectural interfaces

Defined in [`src/automatedCalibration/types.ts`](../src/automatedCalibration/types.ts):

- **`SlicingEngine`** — pluggable slicing backend. Planned implementations:
  `ManagedOrcaEngine`, `InstalledOrcaEngine`, `ManualExportEngine`,
  `BambuStudioHandoff`. Engines are **not** responsible for printer
  communication.
- **`PrintDestination`** — where a prepared/sliced job goes, kept separate from
  slicing. Initial: `SaveToFileDestination`, `OpenInInstalledSlicerDestination`.
  Future extension points: Moonraker, OctoPrint, PrusaLink.
- **`TemporaryCalibrationProfile`** — a working filament profile a session
  mutates as results arrive, tracking value provenance (base profile vs.
  material default vs. user input vs. calibration result). Normalized PerfectFit
  keys; slicer-specific mapping stays in `src/slicerIntegration/adapters`.
- **`CalibrationStepDefinition`** — the dependency-aware step model the workflow
  engine builds on top of the instructional content in
  `src/data/calibrations.ts`.
- **`CalibrationAssetDefinition`** — licensed, versioned, checksummed calibration
  model/registry entry (bundled, downloaded, or user-provided).

### Engine layer (Stage 5)

Two engines implement `SlicingEngine` so far:

- **`ManualExportEngine`** — always available, needs no external slicer. It
  reports export capability but **not** slice capability; `slice()` returns a
  deliberately not-sliced job (never a fake "printer-ready" one). This is the
  guaranteed fallback for browser builds and users without Orca.
- **`InstalledOrcaEngine`** — drives an OrcaSlicer install the user already has
  (auto-detected, or an executable they select manually) as an external process.

Discovery, validation, and slicing are delegated to native Tauri commands in
[`src-tauri/src/slicer_integration/engine.rs`](../src-tauri/src/slicer_integration/engine.rs):

- **Capability validation is by structure, not name.** An executable is trusted
  as a slicing engine only when it ships `resources/calib` and `resources/profiles`
  beside it — the assets the pipeline depends on — so a mis-named or unrelated
  binary is rejected rather than name-trusted.
- **A tamper-evident engine manifest** (id, executable path, version, sha256
  checksum, capabilities) is written under a PerfectFit-managed root. The slice
  runner launches only the manifest-vetted binary; the frontend never passes a
  raw executable path.
- **The process runner** captures exit code and duration, enforces a timeout,
  honors a cancellation token, and always reaps the child — but **never captures
  stdout**. Success is judged from the output artifact (present, non-empty) and
  the engine's `<datadir>/log/`.
- **Isolated per-job paths.** The frontend passes validated session/job ids, and
  the runner resolves them to `sessions/<id>/jobs/<id>/{workspace,datadir,out}`
  under the managed root — never touching the user's real Orca configuration.

`discoverEngines()` summarizes engine status (detected / valid / capabilities /
recommended engine); the Stage 7 UX (`src/ui/automatedCalibration.ts`, reachable
at `#/automated/:id`) renders it as a live status card with a re-check action.

### Project generation (Stage 6)

PerfectFit turns a shipped calibration project into one carrying the session's
calibrated values by assembling a complete project 3mf:

- **Config merge (pure TS,
  [`orcaProjectConfig.ts`](../src/automatedCalibration/orcaProjectConfig.ts)).**
  Parses the template's flat `project_settings.config`, overwrites only the
  calibrated filament keys (reusing the profile installer's verified
  calibration→Orca-key mapping and array-of-strings semantics), and serializes
  it back with the template's key order preserved. Every other setting stays
  byte-for-byte.
- **Assembly (native,
  [`project_assembly.rs`](../src-tauri/src/slicer_integration/project_assembly.rs)).**
  `read_project_config` extracts the template's config for the merge;
  `assemble_calibration_project` copies the template 3mf and swaps in the merged
  config, writing `project.3mf` into the job workspace. Only the one config
  entry changes; the model, per-layer custom g-code, and relationships are
  preserved. The source template is confined to the vetted engine's own
  `resources/` (a calibration model always comes from the user's install).
- **Verified end-to-end on real Orca (2.4.2, Windows).** An assembled, modified
  `pa_pattern` project slices headless to a 94 KB `plate_1.gcode`, exit 0.

Stage 6 covers all three calibration-asset kinds a project can ship as, each
verified with a real headless Orca slice:

- **`project-template`** (e.g. pressure-advance) — the case above: the template
  is already a complete project, so only the config entry is swapped.
- **`stl`** (the temperature tower) — a bare master STL with no config or plate
  at all. `model_project.rs` parses the binary STL, cuts it to the material's
  band count × 10 mm (Orca's own convention, reverse-engineered from real
  exported Orca artifacts), and synthesizes the missing `3D/3dmodel.model` +
  `Metadata/model_settings.config` scaffolding a project needs — a bare model
  plus a config alone does **not** slice (confirmed: Orca rejects it outright,
  no g-code produced, before this scaffolding was added). The per-band `M104`
  temperature schedule is injected as `custom_gcode_per_layer.xml`, the same
  proven injection path as pressure-advance — PerfectFit reproduces Orca's
  temperatures independently rather than depending on Orca's own (undocumented)
  temp-tower recognition.
- **`3mf`** (flow-rate: `flow-pass1`/`flow-pass2`/`flow-verify`) — Orca's
  shipped multi-object flow plates carry geometry but zero config, similar to
  the STL case but with 9-11 pre-positioned objects instead of one. The
  per-object `print_flow_ratio` override mechanism was reverse-engineered from
  OrcaSlicer's own public source (`Plater::calib_flowrate` in
  `src/slic3r/GUI/Plater.cpp`): each object's name (e.g. `flowrate_m10`)
  encodes a modifier, combined with the current flow ratio via one of two
  formulas (percent or linear/YOLO), serialized as per-object
  `model_settings.config` metadata. `flow_test.rs` reuses the template's own
  mesh byte-for-byte and only adds the missing scaffolding + per-object
  overrides. A real-Orca probe assembling `flowrate-test-pass1.3mf` with
  computed per-object ratios slices to 1.4 MB of g-code, exit 0.

**Printer preset resolution
([`preset_resolver.rs`](../src-tauri/src/slicer_integration/preset_resolver.rs)).**
An arbitrary printer's settings are resolved from Orca's own vendor profiles by
walking the `inherits` chains under `resources/profiles/<Vendor>/{machine,
process,filament}/`. Parents are vendor-local (every vendor ships its own base
presets), so resolution is a bounded single-vendor index-and-walk; each chain is
merged child-overrides-parent, and the three resolved objects combine into one
flat `project_settings.config`. Verified on the live install: resolving a Bambu
X1 Carbon selection yields that printer's config (364 keys, correct
`printer_model`/`nozzle_diameter`), and Orca slices a project built from it
(117 KB `plate_1.gcode`, exit 0 — distinct from the N1 template's output).

A PerfectFit printer selection is mapped to those exact preset names by
[`printerMapping.ts`](../src/automatedCalibration/printerMapping.ts): a
PerfectFit printer's `model` equals Orca's machine `printer_model`, so the
native `list_installed_machines` index is matched on model + nozzle to the
machine leaf, whose `default_print_profile` gives the process
(`InstalledOrcaEngine.resolveForPrinter(selection, filamentName)`). Filament is
a **separate selection**: Orca machine leaves carry no default filament, and in
a calibration the material is the thing being tuned, so the caller supplies the
filament preset (`resolveForMaterial` picks the best installed match for the
material automatically; the material→filament ranking lives in
`filamentSelection.ts`).

### Guided session UX (Stage 7)

[`src/ui/automatedCalibration.ts`](../src/ui/automatedCalibration.ts), reachable
at `#/automated/:id` and linked from the project page once the experimental
flag is on (`src/ui/settings.ts`):

- **Engine status** — a live card (`discoverEngines()`) with a re-check action.
- **Starting a session** reuses the printer/nozzle/material the project already
  has (no separate picker needed for the common case — `resolveForMaterial`
  maps it automatically); a **manual fallback picker** lists installed Orca
  machines/filaments directly (`list_installed_machines`/`list_vendor_filaments`)
  for printers not linked to PerfectFit's printer database (hand-entered
  profiles) or when the automatic mapping can't find a match. The chosen
  override (`manualOrcaPreset`) is reused for every later resolve in that
  session.
- **Per-step prepare → slice → review**, in place: each ready, slice-needing
  step gets a "Prepare & slice" action (`prepareProject` → `slice` →
  `inspectOutput`), rendering success (duration, g-code path, findings, a link
  into the *existing* manual wizard's result-entry step) or failure (exit
  code, engine log path, findings). Recording the measured result is
  deliberately **not** reimplemented — it's identical regardless of how the
  test was sliced, so a successful slice links straight to
  `#/wizard/:id/:step` instead of duplicating that UI.
- **Resume / cancel / restart** — a resumable session surfaces on the
  dashboard; cancelling (with confirmation) stops it without touching recorded
  calibration results; a cancelled/failed session offers a fresh restart with
  the same printer/material (or a re-picked manual override).

This repo's Vitest environment is `'node'`, so no `src/ui/*.ts` file has
unit-test coverage by convention — this screen is verified by real
click-through in a dev-server browser (with a faked Tauri bridge standing in
for the desktop native layer) instead.

### Finish & profile install (Stage 8)

The automated pipeline finishes by handing off to the **existing, verified**
slicer-profile generator/installer (`src/slicerIntegration/`, driven by
[`src/ui/profileWizard.ts`](../src/ui/profileWizard.ts) at `#/profile/:id`) —
it is **not** reimplemented for the automated path. This works because an
automated session *is* a `CalibrationProject` (Stage 2), and recording each
measured result writes `project.finals` — exactly the source the profile
generator already reads (`buildPatchesFromProject`). The measured results, not
any intermediate working-profile values, are what get baked into the exported
or installed filament profile.

- **From the automated screen** ([`src/ui/automatedCalibration.ts`](../src/ui/automatedCalibration.ts)):
  once at least one calibrated value is recorded, a **"Finish calibration"**
  card summarizes the recorded values and links into `#/profile/:id`. A
  completed session's card links there too, so a finished session can still
  (re)generate or re-install a profile.
- **A deliberate "Mark session complete"** action (`completeSession`, with a
  confirmation) closes the session. Completion is terminal but non-destructive:
  recorded results and any generated profile are kept, and a new session can be
  started later.
- **From the profile wizard back to the session:** after a successful install
  or export, if the project still has an open automated session, the result
  stage offers "Back to automated session" and the same "Mark session complete"
  close-out — so the loop closes from whichever screen the user finishes on.

Nothing in Stage 8 changes the installer itself; it only wraps it. The
installer's own guarantees hold unchanged — it backs up affected slicer files
first, never edits vendor/system presets, and export always works even when a
version isn't verified for direct install. Verified by real dev-server
click-through (per the `src/ui/*.ts` convention above): the finish handoff, the
`#/profile/:id` target loading, a full generate→export cycle surfacing the
close-out, and the mark-complete transition persisting `sessionStatus:
completed`.

### Relationship to existing code

The automated session **extends the existing `CalibrationProject`** — it is not a
parallel entity. `AutomatedSessionExtension`'s (all-optional) fields folded into
`CalibrationProject` in Stage 2 (storage schema v5, purely additive — no
`DB_VERSION`/`onupgradeneeded` change was needed since IndexedDB already stores
whatever optional fields an object carries). Session state lives in IndexedDB
like the rest of the app; only slicer working directories and sliced artifacts
live on the filesystem.

## Expected filesystem layout (engine + jobs)

The `sessions/<id>/jobs/<id>/{workspace,datadir,out}` layout below is
implemented and in active use since Stage 5 (the process runner) and Stage 6
(project assembly). Only `engines/managed-orca/` — a bundled/downloaded Orca
binary — remains future work (Stage 9); today `InstalledOrcaEngine` only ever
points at the user's own install, never a managed one. Everything lives under
an application-managed root, isolated per session and per job:

```
<app-data>/perfectfit/
  engines/
    managed-orca/
      manifest.json            # engine id, upstream version, checksum, capabilities
      bin/…                    # the managed Orca executable (Stage 9)
  sessions/
    <sessionId>/
      jobs/
        <jobId>/
          workspace/           # staged model + assembled project.3mf + manifest
          datadir/             # isolated Orca --datadir (config + log/)
          out/                 # sliced artifacts (plate_1.gcode, …)
```

No Orca executable is bundled in the repository. The managed engine is a
separately-packaged component targeted for Stage 9 — see the note under
"Staged delivery" on why it's required, not optional, for release.

## Staged delivery

Built on a long-running `feature/automated-calibration` branch (never on `main`
until complete). Each stage keeps the app buildable, keeps existing tests green,
and leaves the automated behavior disabled until it is ready.

| Stage | Focus |
|-------|-------|
| 0 | Orca CLI spike (throwaway) — proved headless slicing viability |
| 1 | Repository audit + architectural contracts + disabled flag (this document) |
| 2 | Durable sessions + temporary profiles (extend `CalibrationProject`) |
| 3 | Workflow registry + result inheritance / stale-job invalidation |
| 4 | Calibration asset registry + project preparation (unsliced workspace) |
| 5 | Engine discovery/validation + safe process runner |
| 6 | Orca project generation + automated slicing (all calibration-asset kinds) |
| 7 | End-to-end guided automated session UX |
| 8 | Finish Calibration — profile export/install (wraps the verified installer) |
| 9 | Managed Orca engine + packaging + third-party notices |
| 10 | Hardening, compatibility matrix, docs, beta prep |

Stage 9 is **not optional**: at release, PerfectFit has no way to know whether a
given user has OrcaSlicer installed at all — many print with Bambu Studio (or
another slicer) exclusively and have never installed Orca. Without a managed
engine, the automated pipeline only ever benefits users who already happen to
have Orca on their machine; everyone else keeps the manual workflow with no
automation, regardless of how complete Stages 1-8 are.

## Licensing note

OrcaSlicer is AGPL-3.0; PerfectFit is AGPL-3.0-only. Driving Orca as a separate
executable keeps a bundled engine "mere aggregation" rather than a derivative
work. Distributing or downloading the Orca binary still obliges PerfectFit to
provide the pinned version's corresponding source and AGPL notices. Third-party
licensing/attribution artifacts are added in Stage 9 and **must be reviewed by
the project owner before any public distribution** — nothing here constitutes
verified legal advice.
