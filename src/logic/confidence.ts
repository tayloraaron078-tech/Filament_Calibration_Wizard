import type { CalibrationProject, CalibrationId } from '../types';

/**
 * Calibration Confidence Score (0–100).
 *
 * Not a quality judgment of the filament — a measure of how complete and
 * trustworthy the PROFILE is:
 *  - each completed core test contributes its weight
 *  - user-reported confidence scales that contribution
 *  - skipped tests contribute nothing; retest-recommended flags subtract
 *  - final verification passing multiplies the whole thing
 */

const WEIGHTS: Record<CalibrationId, number> = {
  temperature: 22,
  'flow-pass1': 16,
  'flow-pass2': 8,
  'pressure-advance': 16,
  'flow-verify': 5,
  retraction: 12,
  'max-volumetric-speed': 12,
  shrinkage: 6,
  'final-verification': 14
};

const CONF_FACTOR = { low: 0.5, medium: 0.8, high: 1.0 } as const;

export interface ConfidenceBreakdown {
  score: number;
  parts: { step: CalibrationId; earned: number; possible: number; note: string }[];
}

export function confidenceScore(p: CalibrationProject): ConfidenceBreakdown {
  const parts: ConfidenceBreakdown['parts'] = [];
  let earnedTotal = 0;
  let possibleTotal = 0;
  // Score only the steps that exist in THIS project's plan, so projects
  // created before a step was introduced don't lose points for it.
  const ids = (p.stepOrder?.length ? p.stepOrder : Object.keys(WEIGHTS) as CalibrationId[])
    .filter(id => WEIGHTS[id] !== undefined);
  for (const id of ids) {
    const possible = WEIGHTS[id];
    possibleTotal += possible;
    const st = p.steps[id];
    if (!st || st.status !== 'completed') {
      parts.push({ step: id, earned: 0, possible, note: st?.status === 'skipped' ? 'skipped' : 'not completed' });
      continue;
    }
    const conf = st.current?.confidence ?? st.confidence ?? 'medium';
    let earned = possible * CONF_FACTOR[conf];
    let note = `completed (${conf} confidence)`;
    if (st.retestRecommended) { earned *= 0.6; note += ', retest recommended'; }
    parts.push({ step: id, earned, possible, note });
    earnedTotal += earned;
  }
  return { score: Math.round((earnedTotal / possibleTotal) * 100), parts };
}

export function confidenceLabel(score: number): string {
  if (score >= 85) return 'High — profile is complete and well-verified';
  if (score >= 60) return 'Good — usable, some steps could be firmer';
  if (score >= 35) return 'Partial — key calibrations missing or uncertain';
  return 'Low — profile is mostly uncalibrated';
}
