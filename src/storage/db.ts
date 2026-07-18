/**
 * Minimal IndexedDB wrapper. Stores: projects, printers, photos.
 * Settings live in localStorage (small, synchronous needs).
 */

const DB_NAME = 'perfectfit-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('printers')) db.createObjectStore('printers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('byProject', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB error on ${store}`));
  }));
}

export const idb = {
  get: <T>(store: string, key: string) => tx<T | undefined>(store, 'readonly', s => s.get(key)),
  getAll: <T>(store: string) => tx<T[]>(store, 'readonly', s => s.getAll()),
  put: <T extends object>(store: string, value: T) => tx<IDBValidKey>(store, 'readwrite', s => s.put(value)),
  delete: (store: string, key: string) => tx<undefined>(store, 'readwrite', s => s.delete(key)),
  clear: (store: string) => tx<undefined>(store, 'readwrite', s => s.clear()),
  getAllByIndex: <T>(store: string, index: string, key: string) =>
    openDb().then(db => new Promise<T[]>((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).index(index).getAll(key);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB index error'));
    }))
};
