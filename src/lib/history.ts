// IndexedDB-backed local history with one-time migration from localStorage.
// Stays client-only; the API never touches this.

import type { GenerateResponse, NanoBananaParams, ReferenceImageMetadata } from "./nanoBanana";

const DB_NAME = "nano-banana-2-db";
const STORE = "history";
const DB_VERSION = 1;
const MAX_ENTRIES = 40;
const LEGACY_KEY = "nano-banana-2-history";
const LEGACY_MIGRATED_FLAG = "nano-banana-2-history-migrated";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  durationMs: number;
  providerUsed: "google" | "fal";
  endpointId: string;
  requestId: string;
  paramsUsed: NanoBananaParams;
  referenceImages: ReferenceImageMetadata[];
  cost: GenerateResponse["cost"];
  images: GenerateResponse["images"];
  originalImages?: GenerateResponse["originalImages"];
}

function dbAvailable(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    Promise.resolve(fn(store))
      .then((value) => {
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch((err) => reject(err));
  });
}

export async function migrateLegacyIfNeeded(): Promise<void> {
  if (!dbAvailable()) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(LEGACY_MIGRATED_FLAG)) return;
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) {
    localStorage.setItem(LEGACY_MIGRATED_FLAG, "1");
    return;
  }
  try {
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        await saveHistory(entry);
      }
    }
  } catch {
    // legacy data is malformed; just skip it
  }
  localStorage.removeItem(LEGACY_KEY);
  localStorage.setItem(LEGACY_MIGRATED_FLAG, "1");
}

export async function saveHistory(entry: HistoryEntry): Promise<void> {
  if (!dbAvailable()) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const putReq = store.put(entry);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });
  });
  await trimHistory();
}

export async function listHistory(): Promise<HistoryEntry[]> {
  if (!dbAvailable()) return [];
  return withStore("readonly", (store) => {
    return new Promise<HistoryEntry[]>((resolve, reject) => {
      const req = store.index("createdAt").openCursor(null, "prev");
      const out: HistoryEntry[] = [];
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        out.push(cursor.value as HistoryEntry);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function deleteHistory(id: string): Promise<void> {
  if (!dbAvailable()) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

export async function clearHistory(): Promise<void> {
  if (!dbAvailable()) return;
  await withStore("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

async function trimHistory(): Promise<void> {
  const all = await listHistory();
  if (all.length <= MAX_ENTRIES) return;
  const overflow = all.slice(MAX_ENTRIES);
  for (const entry of overflow) await deleteHistory(entry.id);
}

export function newHistoryId(): string {
  return `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
