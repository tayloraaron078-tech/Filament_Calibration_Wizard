# README additions — Slicer Profile Generator & Installer (DRAFT)

> Proposed README section for the profile installer. Merge into README.md
> only after the feature is verified and approved for release.

---

## 🧵 Turn calibrations into slicer profiles (experimental)

When a calibration is finished, PerfectFit can build a real filament profile
for your slicer — no more copying numbers field by field.

**How it works**

1. **Pick your slicer.** The desktop app detects installed slicers (Orca
   Slicer, Bambu Studio, Snapmaker Orca, ElegooSlicer, Flash Studio Desktop)
   and every preset location, including which account folder the slicer
   actually uses.
2. **Pick a base profile.** PerfectFit scans your filament presets and
   recommends the best match for your filament, printer, and nozzle — with a
   plain-language explanation. Advanced users can pick any preset, or browse
   to an exported profile file.
3. **Review the changes.** The base profile is cloned; only the values you
   calibrated are changed (temperature, flow ratio, pressure advance,
   retraction, max volumetric speed). Everything else — cooling, speeds,
   fields PerfectFit doesn't even know about — is preserved exactly. You see
   a before → after diff of every change.
4. **Export or install.**
   - **Export** (all platforms, all versions): save the preset file and
     import it in the slicer — drag & drop works in all supported slicers.
   - **Install automatically** (desktop, verified slicer versions only):
     PerfectFit backs up the affected files, writes the preset
     transactionally, verifies the result, and rolls back on any failure.
     Restart the slicer and the profile is there.

**Where profiles are installed**

Into the slicer's own user preset folder, e.g.
`%APPDATA%\OrcaSlicer\user\<account>\filament\<name>.json` on Windows — the
same place the slicer saves your presets.

**Desktop vs browser**

The browser/PWA build cannot access slicer folders. It still generates
profiles from a preset file you choose and downloads the result for manual
import. Automatic detection and installation need the desktop app.

**Backups**

Every installation first writes a checksummed backup (Settings → Slicer
profile backups) with one-click restore. Backups are never deleted
automatically.

**Experimental status & version compatibility**

Profile formats change between slicer versions, so support is verified per
version. Unverified versions are export-only — PerfectFit will say so rather
than guess. The whole feature can be disabled in Settings → Experimental
features.

**Privacy**

Everything happens locally. Scanning is read-only; nothing is uploaded;
cloud slicer accounts are never touched. Diagnostic reports redact your user
folder and are only created when you ask.

**Troubleshooting**

- *Slicer not detected* → open the slicer once (it creates its data folder),
  or pick a profile file manually.
- *"Slicer is running"* → close it and press Check again; presets written
  while the slicer is open can be ignored or overwritten.
- *Profile doesn't appear* → restart the slicer; check you installed into
  the account folder marked **active**.
- *Something looks wrong after install* → Settings → Slicer profile backups
  → Restore.
- Include a diagnostic report (profile wizard → Copy diagnostic report) when
  filing issues.
