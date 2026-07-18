// ---------------------------------------------------------------------------
// Core domain types for PerfectFit Filament Calibration Wizard
// ---------------------------------------------------------------------------

export type SlicerId = 'orca' | 'bambu';

export type ExperienceMode = 'coach' | 'expert';

export type ExtruderType = 'direct' | 'bowden';

export type MaterialId =
  | 'PLA' | 'PLA+' | 'PETG' | 'PCTG' | 'ABS' | 'ASA' | 'TPU'
  | 'PA' | 'PA-CF' | 'PA-GF' | 'PC' | 'PPA' | 'PPS' | 'OTHER';

export type CalibrationId =
  | 'temperature'
  | 'flow-pass1'
  | 'flow-pass2'
  | 'pressure-advance'
  | 'retraction'
  | 'max-volumetric-speed'
  | 'final-verification';

export type StepStatus = 'not-started' | 'in-progress' | 'completed' | 'skipped';

export type ConfidenceLevel = 'low' | 'medium' | 'high';

// --- Printer profile -------------------------------------------------------

export interface PrinterProfile {
  id: string;
  name: string;
  manufacturer: string;
  nozzleDiameter: number;        // mm
  maxNozzleTemp: number;         // °C
  maxBedTemp: number;            // °C
  maxVolumetricFlow?: number;    // mm³/s, if known
  extruderType: ExtruderType;
  retractionRange: { start: number; end: number }; // suggested mm
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// --- Material presets ------------------------------------------------------

export interface MaterialPreset {
  id: MaterialId;
  label: string;
  description: string;
  /** Suggested nozzle temperature range (°C). Editable, never enforced. */
  nozzleTemp: { min: number; max: number };
  bedTemp: { min: number; max: number };
  /** Suggested temp tower range. */
  towerRange: { start: number; end: number; step: number };
  /** Typical starting flow ratio. */
  startingFlowRatio: number;
  /** Typical max volumetric speed test range (mm³/s). */
  mvsRange: { start: number; end: number; step: number };
  /** Typical safe MVS ballpark used only for sanity warnings. */
  typicalMvs: number;
  /** True for flexible materials (TPU): changes PA + retraction guidance. */
  flexible?: boolean;
  /** Requires drying before calibration is meaningful. */
  hygroscopic?: boolean;
  /** Needs enclosure / warns about warping. */
  enclosureRecommended?: boolean;
  warnings: string[];
}

// --- Project ---------------------------------------------------------------

export interface FilamentInfo {
  manufacturer: string;
  productLine: string;
  material: MaterialId;
  materialOther?: string;    // when material === 'OTHER'
  color: string;
  diameter: number;          // mm (1.75 / 2.85)
  startingProfile: string;   // e.g. "Generic PLA"
}

export interface ProjectSlicerInfo {
  slicer: SlicerId;
  version: string;           // e.g. "2.4.x"
}

export interface CalibrationProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  calibrationDate: string;
  filament: FilamentInfo;
  printerProfileId: string;
  nozzleType: string;        // brass / hardened steel / etc.
  slicer: ProjectSlicerInfo;
  notes: string;
  mode: ExperienceMode;
  /** Order of calibration steps for this project (user may reorder). */
  stepOrder: CalibrationId[];
  steps: Record<CalibrationId, CalibrationStepState>;
  timeline: TimelineEntry[];
  archived: boolean;
  /** Final chosen values, denormalized for dashboard display. */
  finals: FinalValues;
}

export interface FinalValues {
  nozzleTemp?: number;
  firstLayerTemp?: number;
  highFlowTemp?: number;
  bedTemp?: number;
  flowRatio?: number;
  pressureAdvance?: number;
  retractionDistance?: number;
  retractionSpeed?: number;
  maxVolumetricSpeed?: number;
}

export interface CalibrationStepState {
  status: StepStatus;
  /** Latest attempt (working data). */
  current: CalibrationAttempt | null;
  /** Historical attempts, newest first. Never overwritten. */
  history: CalibrationAttempt[];
  confidence?: ConfidenceLevel;
  retestRecommended?: boolean;
  completedAt?: string;
}

/** One run of a calibration test — inputs, observations, and results. */
export interface CalibrationAttempt {
  id: string;
  startedAt: string;
  completedAt?: string;
  method?: string;                       // e.g. 'yolo' | 'pass1' | 'tower' | 'pattern' | 'line'
  /** Test range/settings the user configured. */
  settings: Record<string, number | string | boolean>;
  /** Raw result entry (selected sample, measured value, etc). */
  result: Record<string, number | string | boolean | number[] | string[]>;
  /** Computed outputs (the values to enter in the slicer). */
  computed: Record<string, number | string>;
  prerequisitesConfirmed: string[];
  notes: string;
  photoIds: string[];
  confidence?: ConfidenceLevel;
}

export interface TimelineEntry {
  id: string;
  at: string;
  stepId: CalibrationId | 'project';
  kind: 'started' | 'value-set' | 'completed' | 'retest' | 'note' | 'created' | 'skipped' | 'reset';
  summary: string;
  detail?: string;
}

// --- Calibration definitions (data-driven) --------------------------------

export interface NumericInputDef {
  key: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Explains the input in Coach mode. */
  help?: string;
}

export interface MethodDef {
  id: string;
  label: string;
  description: string;
  /** Which slicers support this method natively. */
  slicers: SlicerId[];
  recommended?: boolean;
}

export interface CalibrationDef {
  id: CalibrationId;
  name: string;
  shortName: string;
  icon: string;
  /** Beginner-friendly purpose text. */
  purpose: string;
  /** Why this step sits where it does in the order. */
  whyThisOrder: string;
  /** "Why am I doing this?" expanded explanation. */
  whyExpanded: string;
  dependencies: CalibrationId[];
  prerequisites: { id: string; label: string; coachNote?: string }[];
  methods: MethodDef[];
  /** What the user inspects on the print. */
  evaluationGuide: EvaluationItem[];
  resultPrecision: number; // decimal places for the final value
  slicerDestination: SlicerDestination;
  versionNotes: string[];
}

export interface EvaluationItem {
  title: string;
  look: string;             // what to look for
  meaning: string;          // what it indicates
  severity: 'good' | 'adjust' | 'bad';
}

export interface SlicerDestination {
  scope: 'filament' | 'printer' | 'process' | 'per-object' | 'calibration-only';
  /** Human path per slicer, filled from slicer content files. */
  note: string;
}

// --- Slicer instruction content (version-aware) ----------------------------

export interface SlicerVersionContent {
  slicer: SlicerId;
  slicerLabel: string;
  version: string;             // version family this content was verified against
  verifiedOn: string;          // ISO date the docs were checked
  docsUrl: string;
  calibrationMenuPath: string; // e.g. "Menu bar → Calibration"
  perTest: Partial<Record<CalibrationId, SlicerTestInstructions>>;
}

export interface SlicerTestInstructions {
  available: boolean;
  builtIn: boolean;            // generated in-slicer (no model download needed)
  menuPath: string;
  steps: string[];             // numbered instructions, original wording
  saveTo: { path: string; field: string; scope: SlicerDestination['scope']; note: string };
  disableFirst?: string[];     // things to temporarily disable
  gotchas?: string[];
}

// --- Models manifest -------------------------------------------------------

export interface ModelManifestEntry {
  test: string;
  localFile: string | null;    // filename under /models or null when download-only
  bundled: boolean;
  sourceUrl: string;
  license: string;
  attribution: string;
  recommendedUse: string;
  slicerCompatibility: string;
  fileType: string;
}

// --- Settings & misc -------------------------------------------------------

export interface AppSettings {
  theme: 'light' | 'dark' | 'auto';
  largeText: boolean;
  defaultMode: ExperienceMode;
  /** Safety margin applied to measured MVS, e.g. 0.85 = keep 15% headroom. */
  mvsSafetyMargin: number;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  related?: string[];
}

export interface StoredPhoto {
  id: string;
  projectId: string;
  stepId: CalibrationId;
  attemptId: string;
  createdAt: string;
  name: string;
  type: string;
  blob: Blob;
  /** Reserved for future AI analysis results; unused in v1. */
  analysis?: null;
}

// --- Backup format ---------------------------------------------------------

export interface BackupFile {
  app: 'perfectfit-filament-calibration-wizard';
  schemaVersion: number;
  exportedAt: string;
  projects: CalibrationProject[];
  printers: PrinterProfile[];
  settings?: AppSettings;
  /** Photos are exported as base64 only in full backups. */
  photos?: { meta: Omit<StoredPhoto, 'blob'>; dataUrl: string }[];
}

export interface VerificationCategory {
  id: string;
  label: string;
  coachHint: string;
  /** Calibration steps most likely responsible when this category fails, in priority order. */
  likelyCauses: { step: CalibrationId; why: string }[];
}

export type VerificationMark = 'pass' | 'acceptable' | 'needs-adjustment' | 'not-tested';
