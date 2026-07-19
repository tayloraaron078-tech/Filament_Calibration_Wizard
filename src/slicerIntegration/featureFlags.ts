// ---------------------------------------------------------------------------
// Experimental feature flags for the profile installer, persisted alongside
// app settings in localStorage (separate key so existing AppSettings and its
// backups are untouched).
// ---------------------------------------------------------------------------

import { DEFAULT_EXPERIMENTAL_FEATURES, type ExperimentalFeatures } from './types';

const FLAGS_KEY = 'perfectfit.experimentalFeatures';

export function loadExperimentalFeatures(): ExperimentalFeatures {
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return { ...DEFAULT_EXPERIMENTAL_FEATURES };
    return { ...DEFAULT_EXPERIMENTAL_FEATURES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_EXPERIMENTAL_FEATURES };
  }
}

export function saveExperimentalFeatures(f: ExperimentalFeatures): void {
  localStorage.setItem(FLAGS_KEY, JSON.stringify(f));
}
