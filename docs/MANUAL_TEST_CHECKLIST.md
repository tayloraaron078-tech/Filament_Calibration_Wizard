# Manual test checklist

Run through this list before a release. Automated tests cover the math
(`npm test`); this covers the human workflow.

## Setup
- [ ] `npm run dev` starts; app loads with empty dashboard and welcome card
- [ ] Light/dark toggle works; theme persists after reload
- [ ] "Larger text" setting increases font size everywhere
- [ ] Keyboard-only: tab through dashboard → printers → form fields; focus rings visible

## Printer profiles
- [ ] Create printer (name required; invalid numbers rejected with messages)
- [ ] Retraction end ≤ start rejected
- [ ] Edit and delete (delete warns when projects reference the printer)

## Project creation
- [ ] Manufacturer required; "Other" material requires a name
- [ ] Material preset panel updates on selection; warnings appear when material temps exceed printer limits (try PC on a 260 °C printer)
- [ ] Coach/Expert selection respected; project appears on dashboard

## Wizard (each of the 7 modules)
- [ ] Coach mode shows purpose + evaluation stages; Expert mode skips them
- [ ] Prerequisites: continuing with unchecked boxes asks for confirmation
- [ ] Range validation: zero step blocked; absurd ranges blocked; sample count preview updates live
- [ ] Temperature: block chips generate from range; normal-temp dropdown narrows to acceptable picks; adhesion confirmation warning fires
- [ ] Flow YOLO vs Pass 1: correct formula shown for each; entering 98 as flow ratio produces the percentage error
- [ ] Pass 2 prefills the saved Pass 1 ratio
- [ ] PA: tower asks for height; line/pattern offer direct-value or sample-number (zero/one-based) entry
- [ ] Retraction: G-code entry mode and height mode both compute; "still stringy" checkbox triggers the temperature recommendation on the project page
- [ ] MVS: margin applied; value capped at printer max flow (set printer max low to verify); calculator updates live
- [ ] Verification: marking "Corners: needs adjustment" produces a PA-first suggestion list
- [ ] Draft auto-save: fill a result form, navigate away (confirm dialog appears), return — values restored
- [ ] Completing a step logs a timeline entry, updates finals, confidence score, and dashboard card

## Repeat / history
- [ ] Re-running a completed test preserves the previous attempt in history (visible in the wizard's "Previous attempts" and the report)
- [ ] Per-test draft reset works and does not delete history

## Reorder & skip
- [ ] Moving Flow above Temperature warns about dependencies
- [ ] Skipping a step warns and shows dependents; un-skip restores

## Data & export
- [ ] Export project JSON downloads; re-importing creates a copy (no overwrite)
- [ ] Full backup + restore round-trips (with and without photos)
- [ ] Corrupt JSON import shows a friendly error
- [ ] Copy final settings puts readable text on the clipboard
- [ ] Report page prints cleanly (print preview: no nav/buttons)
- [ ] Calibration card shows QR; scanning opens the project (same host)
- [ ] Erase-all requires double confirmation and clears everything

## Responsive
- [ ] 375 px wide: nav wraps, cards stack, buttons full-width, no horizontal scroll
- [ ] Tablet and desktop layouts sane

## PWA / hosting
- [ ] `npm run build && npm run preview`: app works from the production bundle
- [ ] Serving `dist/` from a subdirectory works (relative base)
- [ ] After first load, app works offline (service worker) when served over http(s)
