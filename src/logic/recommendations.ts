import type { CalibrationProject, CalibrationId, VerificationMark } from '../types';
import { VERIFICATION_CATEGORIES } from '../data/calibrations';

/**
 * Smart Recommendations: cross-test heuristics that suggest revisiting an
 * earlier calibration when later observations point at it. Always phrased as
 * ranked suggestions — never certainty.
 */

export interface Recommendation {
  targetStep: CalibrationId;
  priority: number; // lower = more likely
  reason: string;
}

export function recommendationsForProject(p: CalibrationProject): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Retraction test still stringy at the top → temperature or moisture.
  const retr = p.steps.retraction?.current;
  if (retr && retr.result['stillStringyAtMax'] === true) {
    recs.push({
      targetStep: 'temperature', priority: 1,
      reason: 'Stringing persisted even at the highest retraction tested. That usually means the nozzle is running hot for this filament — or the filament is wet. Dry the spool first; if drying doesn\'t help, re-run the temp tower and favor the cooler end of your acceptable range.'
    });
  }

  // 2. Temperature chosen at extreme end of tested range → suggest wider retest.
  const temp = p.steps.temperature?.current;
  if (temp && typeof temp.computed['normalTemp'] === 'number') {
    const chosen = temp.computed['normalTemp'] as number;
    const start = Number(temp.settings['start']);
    const end = Number(temp.settings['end']);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const hi = Math.max(start, end), lo = Math.min(start, end);
      if (chosen >= hi || chosen <= lo) {
        recs.push({
          targetStep: 'temperature', priority: 2,
          reason: `Your chosen temperature (${chosen} °C) sits at the very edge of the range you tested (${lo}–${hi} °C). The true optimum may lie outside it — consider re-running the tower shifted ${chosen >= hi ? 'hotter' : 'cooler'}.`
        });
      }
    }
  }

  // 3. MVS measured far below material-typical AND temp chosen at cool end → hint.
  const mvs = p.steps['max-volumetric-speed']?.current;
  if (mvs && temp && typeof mvs.computed['measuredMax'] === 'number' && typeof temp.computed['normalTemp'] === 'number') {
    const measured = mvs.computed['measuredMax'] as number;
    const typical = Number(mvs.settings['typicalMvs']);
    if (Number.isFinite(typical) && typical > 0 && measured < typical * 0.6) {
      recs.push({
        targetStep: 'temperature', priority: 3,
        reason: `Measured max flow (${measured} mm³/s) is well below what's typical for this material (~${typical} mm³/s). If you chose a temperature at the cool end, a hotter "high-flow" temperature would raise the melt capacity — the temp tower step lets you record one.`
      });
    }
  }

  // 4. Flow pass 2 picked an extreme modifier → coarse pass may be off.
  const f2 = p.steps['flow-pass2']?.current;
  if (f2 && typeof f2.result['modifier'] === 'number') {
    const mod = f2.result['modifier'] as number;
    if (mod <= -8) {
      recs.push({
        targetStep: 'flow-pass1', priority: 2,
        reason: `Pass 2 landed at ${mod}%, the extreme edge of the fine range. The coarse pass may have overshot — re-running Pass 1 (or the YOLO method) is worth considering.`
      });
    }
  }

  // 5. Failed verification categories → their ranked causes.
  const ver = p.steps['final-verification']?.current;
  if (ver) {
    for (const cat of VERIFICATION_CATEGORIES) {
      const mark = ver.result[`cat-${cat.id}`] as VerificationMark | undefined;
      if (mark === 'needs-adjustment') {
        cat.likelyCauses.forEach((cause, i) => {
          recs.push({
            targetStep: cause.step, priority: 4 + i,
            reason: `Verification: "${cat.label}" needs adjustment. ${cause.why}`
          });
        });
      }
    }
  }

  // De-duplicate by (step, reason), sort by priority.
  const seen = new Set<string>();
  return recs.filter(r => {
    const k = r.targetStep + '|' + r.reason;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.priority - b.priority);
}

/** Marks earlier steps as retest-recommended based on current recommendations. */
export function applyRetestFlags(p: CalibrationProject): void {
  const recs = recommendationsForProject(p);
  const flagged = new Set(recs.filter(r => r.priority <= 3).map(r => r.targetStep));
  for (const id of p.stepOrder) {
    const st = p.steps[id];
    if (!st) continue;
    st.retestRecommended = flagged.has(id) && st.status === 'completed';
  }
}
