import type {
  AppSettings, CalibrationProject, CalibrationId, CalibrationStepState,
  PrinterProfile, StoredPhoto, TimelineEntry, ExperienceMode
} from '../types';
import { DEFAULT_ORDER } from '../data/calibrations';
import { idb } from './db';

export const SCHEMA_VERSION = 1;

// --- ids -------------------------------------------------------------------

export function uid(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// --- settings (localStorage) ----------------------------------------------

const SETTINGS_KEY = 'perfectfit.settings';
const AUTOSAVE_KEY = 'perfectfit.autosave';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  largeText: false,
  defaultMode: 'coach',
  mvsSafetyMargin: 0.85
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/** Auto-save of in-progress form data, keyed by project+step. */
export function saveDraft(key: string, data: unknown): void {
  try {
    const all = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}');
    all[key] = { at: new Date().toISOString(), data };
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(all));
  } catch { /* quota errors are non-fatal for drafts */ }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const all = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}');
    return all[key]?.data ?? null;
  } catch { return null; }
}

export function clearDraft(key: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '{}');
    delete all[key];
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// --- printers --------------------------------------------------------------

export async function listPrinters(): Promise<PrinterProfile[]> {
  const all = await idb.getAll<PrinterProfile>('printers');
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPrinter(id: string): Promise<PrinterProfile | undefined> {
  return idb.get<PrinterProfile>('printers', id);
}

export async function savePrinter(p: PrinterProfile): Promise<void> {
  p.updatedAt = new Date().toISOString();
  await idb.put('printers', p);
}

export async function deletePrinter(id: string): Promise<void> {
  await idb.delete('printers', id);
}

// --- projects --------------------------------------------------------------

export function emptyStepState(): CalibrationStepState {
  return { status: 'not-started', current: null, history: [] };
}

export function newProjectSteps(): Record<CalibrationId, CalibrationStepState> {
  const steps = {} as Record<CalibrationId, CalibrationStepState>;
  for (const id of DEFAULT_ORDER) steps[id] = emptyStepState();
  return steps;
}

export async function listProjects(): Promise<CalibrationProject[]> {
  const all = await idb.getAll<CalibrationProject>('projects');
  return all.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export async function getProject(id: string): Promise<CalibrationProject | undefined> {
  return idb.get<CalibrationProject>('projects', id);
}

export async function saveProject(p: CalibrationProject): Promise<void> {
  p.updatedAt = new Date().toISOString();
  await idb.put('projects', p);
}

export async function deleteProject(id: string): Promise<void> {
  await idb.delete('projects', id);
  const photos = await idb.getAllByIndex<StoredPhoto>('photos', 'byProject', id);
  for (const ph of photos) await idb.delete('photos', ph.id);
}

export function addTimeline(p: CalibrationProject, entry: Omit<TimelineEntry, 'id' | 'at'>): void {
  p.timeline.push({ id: uid(), at: new Date().toISOString(), ...entry });
}

export function completionPercent(p: CalibrationProject): number {
  const total = p.stepOrder.length;
  const done = p.stepOrder.filter(id => p.steps[id]?.status === 'completed').length;
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function currentStage(p: CalibrationProject): CalibrationId | null {
  for (const id of p.stepOrder) {
    const st = p.steps[id]?.status;
    if (st !== 'completed' && st !== 'skipped') return id;
  }
  return null;
}

// --- photos ----------------------------------------------------------------

export async function savePhoto(photo: StoredPhoto): Promise<void> {
  await idb.put('photos', photo);
}

export async function getPhotosForProject(projectId: string): Promise<StoredPhoto[]> {
  return idb.getAllByIndex<StoredPhoto>('photos', 'byProject', projectId);
}

export async function deletePhoto(id: string): Promise<void> {
  await idb.delete('photos', id);
}

// --- factory ---------------------------------------------------------------

export function createProject(partial: {
  filament: CalibrationProject['filament'];
  printerProfileId: string;
  nozzleType: string;
  slicer: CalibrationProject['slicer'];
  notes: string;
  mode: ExperienceMode;
}): CalibrationProject {
  const now = new Date().toISOString();
  const p: CalibrationProject = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    calibrationDate: now.slice(0, 10),
    filament: partial.filament,
    printerProfileId: partial.printerProfileId,
    nozzleType: partial.nozzleType,
    slicer: partial.slicer,
    notes: partial.notes,
    mode: partial.mode,
    stepOrder: [...DEFAULT_ORDER],
    steps: newProjectSteps(),
    timeline: [],
    archived: false,
    finals: {}
  };
  addTimeline(p, { stepId: 'project', kind: 'created', summary: `Project created for ${partial.filament.manufacturer} ${partial.filament.material}` });
  return p;
}
