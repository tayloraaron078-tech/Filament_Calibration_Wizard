// Settings get deliberately different treatment from the other stores: sync
// loadSettings/saveSettings stay synchronous, and hydrateSettingsFromServer
// pulls server state into localStorage before the app's first sync read.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestServer, type TestServerHandle } from '../server/testServer.ts';
import type { AppSettings } from '../../src/types';

const mem = new Map<string, string>();

function stubLocalStorage(): void {
  mem.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear()
  });
}

function stubRelativeFetch(baseUrl: string): void {
  const realFetch = fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input, `${baseUrl}/`).toString() : input;
    return realFetch(url as RequestInfo, init);
  });
}

async function freshStore() {
  vi.resetModules();
  return import('../../src/storage/store');
}

describe('sync loadSettings/saveSettings signatures are unchanged', () => {
  beforeEach(() => {
    stubLocalStorage();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no backend in this test')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loadSettings returns synchronously (not a Promise) and defaults are applied', async () => {
    const store = await freshStore();
    const result = store.loadSettings();
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.theme).toBe('auto');
  });

  it('saveSettings returns synchronously (not a Promise) and persists to localStorage immediately', async () => {
    const store = await freshStore();
    const result = store.saveSettings({ theme: 'dark', largeText: true, defaultMode: 'expert', mvsSafetyMargin: 0.8 });
    expect(result).toBeUndefined();
    expect(store.loadSettings().theme).toBe('dark');
  });

  it('saveSettings does not block on the network even though a rejecting fetch is stubbed', async () => {
    const store = await freshStore();
    const start = Date.now();
    store.saveSettings({ theme: 'light', largeText: false, defaultMode: 'coach', mvsSafetyMargin: 0.85 });
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('hydrateSettingsFromServer', () => {
  let server: TestServerHandle;

  beforeEach(async () => {
    server = await startTestServer();
    stubLocalStorage();
    stubRelativeFetch(server.baseUrl);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await server.close();
  });

  it('merges server settings into localStorage before a subsequent loadSettings() call', async () => {
    const serverSettings: AppSettings = { theme: 'dark', largeText: true, defaultMode: 'expert', mvsSafetyMargin: 0.75 };
    await fetch(`${server.baseUrl}/api/v1/settings`, { method: 'PUT', body: JSON.stringify(serverSettings) });

    const store = await freshStore();
    // Nothing local yet — loadSettings() would return defaults without hydration.
    expect(store.loadSettings().theme).toBe('auto');

    await store.hydrateSettingsFromServer();

    expect(store.loadSettings()).toEqual(serverSettings);
  });

  it('is a no-op when the server has no settings saved yet (200+null)', async () => {
    const store = await freshStore();
    const before = store.loadSettings();

    await store.hydrateSettingsFromServer();

    expect(store.loadSettings()).toEqual(before);
  });

  it('local settings saved before hydration are overridden by server settings on merge', async () => {
    const store = await freshStore();
    store.saveSettings({ theme: 'light', largeText: false, defaultMode: 'coach', mvsSafetyMargin: 0.85 });

    const serverSettings: AppSettings = { theme: 'dark', largeText: true, defaultMode: 'expert', mvsSafetyMargin: 0.6 };
    await fetch(`${server.baseUrl}/api/v1/settings`, { method: 'PUT', body: JSON.stringify(serverSettings) });

    await store.hydrateSettingsFromServer();

    expect(store.loadSettings()).toEqual(serverSettings);
  });

  it('saveSettings after hydration fires a best-effort background sync to the server', async () => {
    const store = await freshStore();
    await store.hydrateSettingsFromServer(); // establishes backendReady() cache as true (server has no settings yet)

    store.saveSettings({ theme: 'dark', largeText: true, defaultMode: 'expert', mvsSafetyMargin: 0.7 });
    // Background PUT is fire-and-forget; give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const res = await fetch(`${server.baseUrl}/api/v1/settings`);
    expect(await res.json()).toEqual({ theme: 'dark', largeText: true, defaultMode: 'expert', mvsSafetyMargin: 0.7 });
  });
});
