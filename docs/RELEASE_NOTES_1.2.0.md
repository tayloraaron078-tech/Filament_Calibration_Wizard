# PerfectFit 1.2.0

A community-driven release: everything in it started as feedback from **confuzled**
on the community Discord — thank you! Backups now happen where the risk actually
starts, the drying advice stops trusting factory-sealed bags, and the wizard
gained two new calibration steps: a post-PA flow re-check and shrinkage /
dimensional accuracy.

## Back up your slicer profiles BEFORE calibrating

The wizard directs you to edit your filament and printer profiles from the very
first calibration step — but until now, the only automatic backup happened at
the very end, when a generated profile was installed. Now:

- **First run:** the dashboard offers to back up every detected slicer's user
  preset library (filament, printer, and process presets) with one click.
- **Every project:** projects with calibration steps remaining show a prompt to
  snapshot the project's slicer before any profile edits are suggested. The
  outcome (backed up or skipped) is recorded on the project and its timeline.
- **Any time:** Settings → Slicer profile backups → "Back up all slicer presets
  now".

Snapshots use the same checksummed, verified backup store as install backups:
every file is SHA-256 checksummed, and restore puts files back exactly as they
were (presets you created after a snapshot survive a restore). Backups live in
PerfectFit's own data folder and never touch your slicer files. The browser
build, which cannot write backups, shows manual backup guidance instead.

## New step: Flow Ratio Re-check (after Pressure Advance)

Pressure Advance changes how plastic is distributed through speed transitions —
which is exactly what you judged when picking a flow block. The new step re-runs
the fine flow plate with PA active: if the 0% block wins, your flow ratio is
confirmed; if a neighbor wins, PA was masking a small flow error and you've
caught it cheaply. Sits between Pressure Advance and Retraction.

## New step: Shrinkage / Dimensional Accuracy

Without shrinkage compensation, holes come out tight, pegs loose, and parts
designed to fit… don't. Three methods, all linked in the wizard:

- **ap.engineering's free calibration plate** ([Printables](https://www.printables.com/model/480907-shrinkage-calculator-dimensional-calibration-tool),
  recommended): squares and diamonds at known sizes (150–25 mm). Measure with
  calipers, then either enter the author's companion-spreadsheet scale-error
  result (the wizard converts it: shrinkage% = 100 + error) or enter two
  measurements and let the wizard do the math.
- **Vector3D's CaliFlower MK2** ([vector3d.shop](https://vector3d.shop/products/califlower-calibration-tool-mk2),
  paid): high-precision XY shrinkage plus printer-skew detection; enter its
  calculator's percentages.
- **Any large object** of known size, measured with calipers.

X and Y are averaged, with a warning when they disagree enough to indicate a
printer mechanical issue (belts/squareness) rather than filament behavior. The
result shows on reports and calibration cards, and generated profiles now carry
it as the preset's `filament_shrink` value.

Existing projects gain both new steps automatically as "not started" — progress,
scores, and custom step order are preserved. Both steps are skippable.

## Honest drying advice

"Fresh from a sealed bag" no longer counts as dry. Mildly hygroscopic materials
— PETG, TPU, PCTG and friends — often arrive wet from the factory even sealed
with desiccant, which has tripped up many calibration first-timers. The
pre-flight checklist now requires dried-by-you, and the material warnings call
out factory-wet spools with typical drying temperatures.

## Better guidance

- **Bambu Studio Developer mode, described accurately:** the Preferences
  checkbox is literally labeled **"Develop Mode"** (translation quirk), and
  enabling it adds a **Calibration button to the title bar next to the Redo
  arrow** — the same menu Orca-based slicers have. All Bambu menu paths were
  corrected.
- **Every test names the profile to modify:** the New Project form suggests
  presets detected in your slicer (desktop app) for the "Starting filament
  profile" field — **ranked** so the brand-matching preset (or Generic, when
  your brand isn't stocked) for your material and printer sits at the top, with
  everything else below for advanced users, re-ranking live as you change
  brand, material, or printer. The slicer-instructions and save panels display
  that profile so values land in the right preset.
- Settings' two backup cards are clearly distinguished ("App data backup
  (projects & printers)" vs "Slicer profile backups").
- The final verification checklist gained a "Dimensional accuracy" category.

## Downloads

- Windows: NSIS installer (`.exe`).
- macOS: universal Apple Silicon + Intel disk image (`.dmg`).
- Linux: Debian package (`.deb`) plus portable AppImage (`.AppImage`).

## Notes for existing users

- Your projects will show the two new steps as "not started" after updating —
  that's the schema migration (v3), not data loss. Skip them if you're done.
- Data exports from 1.2.0 (schema v3) cannot be imported into older versions.
