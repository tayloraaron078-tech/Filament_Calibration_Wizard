// ---------------------------------------------------------------------------
// Server bridge: the single boundary between store.ts and the optional
// self-hosted HTTP backend (server/, phase 1). Mirrors the shape of
// slicerIntegration/bridge.ts — everything downstream degrades cleanly to
// the IndexedDB/localStorage path when no backend is reachable.
//
// All request paths are relative (`./api/v1/...`) so this works from any
// subpath/static host per vite.config.ts's `base: './'` contract.
// ---------------------------------------------------------------------------

import type { AppSettings, CalibrationId, CalibrationProject, PrinterProfile, StoredPhoto } from '../types';

const API_BASE = './api/v1';
const TOKEN_KEY = 'perfectfit.apiToken';

// --- backend detection -------------------------------------------------------

let backendReadyPromise: Promise<boolean> | null = null;
/** Synchronous snapshot of the last resolved detection result — false until backendReady() resolves once. */
let backendReadyValue = false;

async function detectBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body?.ok === true;
  } catch {
    return false;
  }
}

/** Probes for a live backend once per page load and memoizes the result. */
export function backendReady(): Promise<boolean> {
  if (!backendReadyPromise) {
    backendReadyPromise = detectBackend().then((ready) => {
      backendReadyValue = ready;
      return ready;
    });
  }
  return backendReadyPromise;
}

/**
 * Synchronous read of the already-resolved backend-detection result, for callers
 * (like store.ts's synchronous saveSettings) that must not block on a fresh probe.
 * Always false until backendReady() has resolved at least once.
 */
export function isBackendReadySync(): boolean {
  return backendReadyValue;
}

// --- fetch helpers ------------------------------------------------------------

function authHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) }
  });
}

async function getJson<T>(path: string): Promise<T | undefined> {
  const res = await apiFetch(path);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function listJson<T>(path: string): Promise<T[]> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T[];
}

async function putJson(path: string, body: unknown): Promise<void> {
  const res = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
}

async function del(path: string): Promise<void> {
  const res = await apiFetch(path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

// --- photo wire helpers ---------------------------------------------------

type PhotoMeta = Omit<StoredPhoto, 'blob'>;

function photoQuery(photo: PhotoMeta): string {
  const params = new URLSearchParams({
    projectId: photo.projectId,
    stepId: photo.stepId,
    attemptId: photo.attemptId,
    createdAt: photo.createdAt,
    name: photo.name,
    type: photo.type
  });
  return params.toString();
}

async function putPhotoHttp(photo: StoredPhoto): Promise<void> {
  const res = await apiFetch(`/photos/${encodeURIComponent(photo.id)}?${photoQuery(photo)}`, {
    method: 'PUT',
    body: photo.blob
  });
  if (!res.ok) throw new Error(`PUT /photos/${photo.id} failed: ${res.status}`);
}

async function fetchPhotosForProject(projectId: string): Promise<StoredPhoto[]> {
  const metaList = await listJson<PhotoMeta>(`/projects/${encodeURIComponent(projectId)}/photos`);
  const photos: StoredPhoto[] = [];
  for (const meta of metaList) {
    const res = await apiFetch(`/photos/${encodeURIComponent(meta.id)}`);
    if (!res.ok) throw new Error(`GET /photos/${meta.id} failed: ${res.status}`);
    const blob = await res.blob();
    // FORGE-NOTE: server stores stepId as an opaque string in the photos table
    // (it never validates against CalibrationId); cast trusts the same data the
    // app itself wrote via putPhotoHttp below.
    photos.push({ ...meta, stepId: meta.stepId as CalibrationId, blob });
  }
  return photos;
}

/**
 * Phase 1's server has no "list every photo across every project" endpoint
 * (only per-project), and server/ is already-shipped, already-PR'd work —
 * adding a route there for this would mean reopening that PR for a single
 * export-time convenience call. Composing it from listProjects +
 * getPhotosForProject instead costs one extra round-trip per project, which
 * is fine for a single-user, modest-data-volume tool.
 */
async function fetchAllPhotos(): Promise<StoredPhoto[]> {
  const projects = await listJson<CalibrationProject>('/projects');
  const perProject = await Promise.all(projects.map((p) => fetchPhotosForProject(p.id)));
  return perProject.flat();
}

// --- public HTTP-backed implementations of the store.ts API -----------------

export const http = {
  listPrinters: (): Promise<PrinterProfile[]> => listJson<PrinterProfile>('/printers'),
  getPrinter: (id: string): Promise<PrinterProfile | undefined> =>
    getJson<PrinterProfile>(`/printers/${encodeURIComponent(id)}`),
  savePrinter: (p: PrinterProfile): Promise<void> => putJson(`/printers/${encodeURIComponent(p.id)}`, p),
  deletePrinter: (id: string): Promise<void> => del(`/printers/${encodeURIComponent(id)}`),

  listProjects: (): Promise<CalibrationProject[]> => listJson<CalibrationProject>('/projects'),
  getProject: (id: string): Promise<CalibrationProject | undefined> =>
    getJson<CalibrationProject>(`/projects/${encodeURIComponent(id)}`),
  saveProject: (p: CalibrationProject): Promise<void> => putJson(`/projects/${encodeURIComponent(p.id)}`, p),
  deleteProject: (id: string): Promise<void> => del(`/projects/${encodeURIComponent(id)}`),

  savePhoto: (photo: StoredPhoto): Promise<void> => putPhotoHttp(photo),
  getPhotosForProject: (projectId: string): Promise<StoredPhoto[]> => fetchPhotosForProject(projectId),
  listAllPhotos: (): Promise<StoredPhoto[]> => fetchAllPhotos(),
  deletePhoto: (id: string): Promise<void> => del(`/photos/${encodeURIComponent(id)}`),

  getSettings: (): Promise<AppSettings | null> => apiFetch('/settings').then(async (res) => {
    if (!res.ok) throw new Error(`GET /settings failed: ${res.status}`);
    return (await res.json()) as AppSettings | null;
  }),
  putSettings: (s: AppSettings): Promise<void> => putJson('/settings', s),

  /** Not wired into store.ts yet — the "erase all local data" UI is phase 3's job. */
  bulkErase: (): Promise<void> => del('/data')
};
