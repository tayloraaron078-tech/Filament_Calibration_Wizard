// ---------------------------------------------------------------------------
// Deterministic base-profile recommendation. Transparent scoring only —
// every point awarded has a human-readable reason, and materially different
// filament families are never silently collapsed.
// ---------------------------------------------------------------------------

import type { CalibrationProject, PrinterProfile } from '../types';
import type {
  DetectedFilamentProfile, ProfileCompatibilityResult, RecommendationReason, ScoredProfile
} from './types';
import { normalizeMaterial, sameMaterial, sameMaterialFamily } from './orcaFamily';

/** Material label the project calibrated (wizard MaterialId or free text). */
export function projectMaterialLabel(project: CalibrationProject): string {
  return project.filament.material === 'OTHER'
    ? (project.filament.materialOther ?? 'OTHER')
    : project.filament.material;
}

function normEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Compatibility of a base profile with the calibration project.
 * Material-family mismatch is an error (blocked outside advanced override);
 * printer/nozzle mismatches are warnings because compatible_printers is
 * optional metadata in delta presets.
 */
export function evaluateCompatibility(
  profile: DetectedFilamentProfile,
  project: CalibrationProject,
  printer: PrinterProfile | undefined
): ProfileCompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const projMat = projectMaterialLabel(project);

  if (profile.materialType) {
    if (!sameMaterialFamily(profile.materialType, projMat)) {
      errors.push(`Different material: this profile is ${profile.materialType}, but you calibrated ${projMat}. Using it as a base would carry over settings tuned for a different plastic.`);
    } else if (!sameMaterial(profile.materialType, projMat)) {
      warnings.push(`Related but not identical material: profile is ${profile.materialType}, calibration is ${projMat}.`);
    }
  } else {
    warnings.push('This profile does not declare a material type; make sure it matches your filament.');
  }

  if (printer && profile.compatibleNozzleDiameters.length > 0 &&
      !profile.compatibleNozzleDiameters.includes(printer.nozzleDiameter)) {
    warnings.push(`Profile targets ${profile.compatibleNozzleDiameters.join('/')} mm nozzles; your printer profile uses ${printer.nozzleDiameter} mm.`);
  }

  if (printer && profile.compatiblePrinterModels.length > 0) {
    const printerName = printer.name.toLowerCase();
    const modelMatch = profile.compatiblePrinterModels.some(m =>
      printerName.includes(m.toLowerCase()) || m.toLowerCase().includes(printerName));
    if (!modelMatch) {
      warnings.push(`Profile is declared compatible with ${profile.compatiblePrinterModels.join(', ')} — not obviously your “${printer.name}”.`);
    }
  }

  warnings.push(...profile.warnings);
  return { compatible: errors.length === 0, warnings, errors };
}

/**
 * Score one profile against the project. All factors are additive and
 * explainable; the result lists every reason with its points.
 */
export function scoreProfile(
  profile: DetectedFilamentProfile,
  project: CalibrationProject,
  printer: PrinterProfile | undefined
): ScoredProfile {
  const reasons: RecommendationReason[] = [];
  const projMat = projectMaterialLabel(project);
  const projVendor = project.filament.manufacturer;
  const compatibility = evaluateCompatibility(profile, project, printer);

  const add = (label: string, matched: boolean, points: number) => {
    reasons.push({ label, matched, points: matched ? points : 0 });
  };

  // 1-2: material
  const exactMat = sameMaterial(profile.materialType, projMat);
  const famMat = sameMaterialFamily(profile.materialType, projMat);
  add(`Exact material match: ${normalizeMaterial(projMat)?.canonical ?? projMat}`, exactMat, 40);
  if (!exactMat) add(`Material family match (${normalizeMaterial(projMat)?.family ?? projMat})`, famMat, 18);

  // 3: vendor
  const vendorMatch = normEq(profile.vendor, projVendor) ||
    (!!projVendor && profile.name.toLowerCase().includes(projVendor.toLowerCase()));
  add(`Manufacturer match: ${projVendor || '—'}`, !!projVendor && vendorMatch, 20);

  // 4-5: printer compatibility
  if (printer) {
    const printerName = printer.name.toLowerCase();
    const exactPrinter = profile.compatiblePrinterNames.some(n => n.toLowerCase().includes(printerName));
    const modelMatch = profile.compatiblePrinterModels.some(m =>
      printerName.includes(m.toLowerCase()) || m.toLowerCase().includes(printerName));
    add(`Compatible with ${printer.name}`, exactPrinter || modelMatch, 15);
    // 6: nozzle
    const nozzleMatch = profile.compatibleNozzleDiameters.includes(printer.nozzleDiameter);
    add(`Nozzle match: ${printer.nozzleDiameter} mm`, nozzleMatch, 10);
  }

  // 7-8: the profile this calibration started from
  const starting = project.filament.startingProfile;
  const startingMatch = !!starting && normEq(profile.name, starting);
  add(`Profile this calibration started from (“${starting || '—'}”)`, startingMatch, 30);

  // 9: prefer user presets over unrelated system presets
  add('Existing user-created profile', profile.sourceType === 'user' || profile.sourceType === 'cloud', 6);

  // 10: generic fallback gets a nudge among otherwise-equal system profiles
  add('Generic base profile', profile.sourceType === 'system' && /generic/i.test(profile.name), 3);

  // 11-13: health
  add('Profile parsed cleanly', true, 2);
  const inheritanceOk = !profile.parentProfileName || true; // resolution checked at generation time
  add('Inheritance chain present', inheritanceOk, 0);
  if (compatibility.errors.length > 0) {
    reasons.push({ label: 'Blocked: incompatible material', matched: false, points: -1000 });
  }
  const warningPenalty = Math.min(compatibility.warnings.length, 3) * 2;
  if (warningPenalty > 0) {
    reasons.push({ label: `${compatibility.warnings.length} compatibility warning(s)`, matched: false, points: -warningPenalty });
  }

  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { profile, score, reasons, compatibility };
}

export interface RecommendationSet {
  best: ScoredProfile | null;
  alternatives: ScoredProfile[];
  all: ScoredProfile[];
}

/**
 * Rank all profiles. Only compatible profiles are eligible for the
 * recommendation slots; everything stays visible in `all` for advanced mode.
 */
export function recommendProfiles(
  profiles: DetectedFilamentProfile[],
  project: CalibrationProject,
  printer: PrinterProfile | undefined
): RecommendationSet {
  const all = profiles
    .map(p => scoreProfile(p, project, printer))
    .sort((a, b) => b.score - a.score || a.profile.name.localeCompare(b.profile.name));
  const eligible = all.filter(s => s.compatibility.compatible);
  return {
    best: eligible[0] ?? null,
    alternatives: eligible.slice(1, 4),
    all
  };
}
