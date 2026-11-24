import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * IndexedDB persistence for arbitrarily large channel catalogs.
 *
 * Unlike localStorage, IndexedDB is not subject to the small synchronous
 * Web Storage quota. Writes are coalesced to avoid cloning huge catalogs
 * after each scan result or playlist update. Storage remains subject to the
 * browser's real available-disk quota; failures are surfaced to the user.
 */
const DATABASE = "youtv-library";
const OBJECT_STORE = "snapshots";
const OLD_KEY = "youtv:v1";
const WRITE_DELAY_MS = 550;

type ErrorListener = () => void;
const listeners = new Set<ErrorListener>();
let lastError = "";

export function getPersistenceError(): string {
  return lastError;
}
export function subscribePersistenceError(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function setError(error: unknown): void {
  const value = error instanceof Error ? error.message : String(error);
  const message = /quota|disk full|no space/i.test(value)
    ? "فضای ذخیره‌سازی مرورگر برای داده‌های فعلی کافی نیست. قبل از پاک‌کردن داده‌های سایت، از بخش تنظیمات خروجی پشتیبان بگیر."
    : "ذخیره خودکار اطلاعات مرورگر ناموفق بود. از اطلاعات خود نسخه پشتیبان بگیر و دسترسی IndexedDB مرورگر را بررسی کن.";
  if (lastError !== message) {
    lastError = message;
    for (const listener of listeners) listener();
  }
  console.error("[YouTV persistence]", error);
}
function clearError(): void {
  if (lastError) {
    lastError = "";
    for (const listener of listeners) listener();
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE))
        request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error || new Error("Cannot open IndexedDB"));
    request.onblocked = () =>
      setError(new Error("IndexedDB upgrade is blocked by another tab"));
  });
  // Retry after a transient failure instead of locking the app into a failed promise.
  databasePromise.catch(() => {
    databasePromise = null;
  });
  return databasePromise;
}

async function readSnapshot<S>(key: string): Promise<StorageValue<S> | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE, "readonly");
    const request = transaction.objectStore(OBJECT_STORE).get(key);
    request.onsuccess = () =>
      resolve((request.result ?? null) as StorageValue<S> | null);
    request.onerror = () =>
      reject(request.error || new Error("IndexedDB read failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB read aborted"));
  });
}

async function writeSnapshots(values: Map<string, unknown>): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB write failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB transaction aborted"));
    const store = transaction.objectStore(OBJECT_STORE);
    for (const [key, value] of values) store.put(value, key);
  });
}

async function deleteSnapshot(key: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(OBJECT_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("IndexedDB delete failed"));
    transaction.onabort = () =>
      reject(transaction.error || new Error("IndexedDB delete aborted"));
    transaction.objectStore(OBJECT_STORE).delete(key);
  });
}

/**
 * Separate static-catalog records from the persisted application state.
 * They share the same disk-backed IndexedDB object store, but never pass through
 * Zustand's state schema, so a cache miss cannot reset the channel library.
 */
export type StaticCacheRecord = {
  text: string;
  storedAt: number;
  nextCheckAt: number;
};
export async function readStaticCacheRecord(
  key: string,
): Promise<StaticCacheRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OBJECT_STORE, "readonly");
    const request = tx.objectStore(OBJECT_STORE).get(key);
    request.onsuccess = () => {
      const record = request.result as Partial<StaticCacheRecord> | undefined;
      resolve(
        record &&
          typeof record.text === "string" &&
          Number.isFinite(record.storedAt) &&
          Number.isFinite(record.nextCheckAt)
          ? (record as StaticCacheRecord)
          : null,
      );
    };
    request.onerror = () =>
      reject(request.error || new Error("Static catalog cache read failed"));
    tx.onabort = () =>
      reject(tx.error || new Error("Static catalog cache read aborted"));
  });
}
export function writeStaticCacheRecord(
  key: string,
  value: StaticCacheRecord,
): Promise<void> {
  return writeSnapshots(new Map([[key, value]]));
}

/** A single last-write-wins snapshot per key, not a queue of giant copies. */
const pending = new Map<string, unknown>();
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();

export function flushPendingPersistence(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending.size) return chain;
  const values = new Map(pending);
  pending.clear();
  chain = chain
    .then(() => writeSnapshots(values))
    .then(() => {
      for (const key of values.keys())
        if (key === OLD_KEY) {
          try {
            localStorage.removeItem(key);
          } catch {
            /* Data is already durable in IndexedDB. */
          }
        }
      clearError();
    })
    .catch((error) => {
      setError(error);
      // Keep the latest unsaved state available for another attempt.
      for (const [key, value] of values)
        if (!pending.has(key)) pending.set(key, value);
    });
  return chain;
}
function queueSnapshot(key: string, value: unknown): void {
  pending.set(key, value);
  if (timer === null)
    timer = setTimeout(() => {
      void flushPendingPersistence();
    }, WRITE_DELAY_MS);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPendingPersistence();
  });
  window.addEventListener("pagehide", () => {
    void flushPendingPersistence();
  });
}

/**
 * Zustand PersistStorage stores structured-cloneable objects directly. This
 * avoids JSON.stringify of the entire channel library on every state update.
 */
export function createIndexedDbStorage<S>(): PersistStorage<S> {
  return {
    getItem: async (key) => {
      try {
        const inDatabase = await readSnapshot<S>(key);
        if (inDatabase !== null) return inDatabase;
      } catch (error) {
        setError(error);
      }
      // One-time automatic migration from the v0.16 localStorage JSON snapshot.
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch (error) {
        setError(error);
      }
      if (raw === null) return null;
      try {
        const oldValue = JSON.parse(raw) as StorageValue<S>;
        try {
          await writeSnapshots(new Map([[key, oldValue]]));
          // Never delete the old snapshot until the new transaction commits.
          try {
            localStorage.removeItem(key);
          } catch {
            /* Migration is already durable. */
          }
          clearError();
        } catch (error) {
          setError(error);
        }
        return oldValue;
      } catch (error) {
        setError(error);
        return null;
      }
    },
    setItem: (key, value) => queueSnapshot(key, value),
    removeItem: (key) => {
      pending.delete(key);
      chain = chain
        .then(() => deleteSnapshot(key))
        .then(() => {
          if (key === OLD_KEY) {
            try {
              localStorage.removeItem(key);
            } catch {
              /* Browser storage may be unavailable. */
            }
          }
        })
        .catch(setError);
      return chain;
    },
  };
}

// Kept for compatibility when another entry point still expects this key.
export const LEGACY_STORAGE_KEY = OLD_KEY;
