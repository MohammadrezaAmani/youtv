import type { PersistStorage, StorageValue } from "zustand/middleware";
import { defaultState, type AppState } from "@youtv/shared";
import { newestPreferences, nextPreferences, preferencesKey, readPreferences, writePreferences, type PreferencesRecord } from "./preferencesJournal";

type Snapshot = StorageValue<AppState> & { preferencesRevision?: number };

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
let preferencesError = "";
let recoveryError = "";

export function getPersistenceError(): string {
  return [lastError, preferencesError, recoveryError].filter(Boolean).join(" ");
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
function setPreferencesError(error: unknown): void {
  preferencesError = error ? "ذخیره فوری تنظیمات مرورگر ناموفق بود؛ از تنظیمات پشتیبان بگیر. / Immediate settings storage failed; export a backup." : "";
  for (const listener of listeners) listener();
  if (error) console.error("[YouTV preferences]", error);
}
export function reportRecoveryIssue(): void {
  recoveryError = "بخشی از داده ذخیره‌شده معتبر نبود؛ داده‌های معتبر بازیابی شدند. / Some stored data was invalid; valid data was recovered.";
  for (const listener of listeners) listener();
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
      db.onversionchange = () => { db.close(); databasePromise = null; };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error || new Error("Cannot open IndexedDB"));
    request.onblocked = () => {
      const error = new Error("IndexedDB upgrade is blocked by another tab");
      setError(error);
      reject(error);
    };
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
const latest = new Map<string, unknown>();
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
      for (const [key, value] of values) if (latest.get(key) === value) latest.delete(key);
      clearError();
    })
    .catch((error) => {
      setError(error);
      // Keep the latest unsaved state available for another attempt.
      for (const [key, value] of values)
        if (latest.get(key) === value && !pending.has(key)) pending.set(key, value);
    });
  return chain;
}
function queueSnapshot(key: string, value: unknown): void {
  latest.set(key, value);
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
export function createIndexedDbStorage(): PersistStorage<AppState> {
  let preferences: PreferencesRecord | null = null;
  let lastSettings: AppState["settings"] | undefined;
  let lastWorkers: AppState["workers"] | undefined;
  let readFailed = false;
  return {
    getItem: async (key) => {
      let snapshot: Snapshot | null = null;
      let migratedLegacy = false;
      let local: PreferencesRecord | null = null;
      readFailed = false;
      try {
        snapshot = await readSnapshot<AppState>(key) as Snapshot | null;
      } catch (error) {
        readFailed = true;
        setError(error);
        recoveryError = "کتابخانه اصلی بارگذاری نشد؛ برای جلوگیری از بازنویسی داده‌های قبلی، ذخیره کاتالوگ تا بارگذاری مجدد متوقف است. / Library read failed; catalog writes are paused until reload.";
        for (const listener of listeners) listener();
      }
      try {
        local = readPreferences(localStorage, key);
      } catch (error) {
        setPreferencesError(error);
      }
      try {
        if (!snapshot) {
          const raw = localStorage.getItem(key);
          if (raw !== null) {
            snapshot = JSON.parse(raw) as Snapshot;
            migratedLegacy = true;
          }
        }
      } catch (error) {
        setPreferencesError(error);
      }
      const state = snapshot?.state;
      const databasePreferences = state && state.settings && Array.isArray(state.workers)
        ? { settings: state.settings, workers: state.workers, revision: snapshot?.preferencesRevision ?? 0 }
        : null;
      preferences = newestPreferences(databasePreferences, local);
      if (preferences) {
        // Migrate old snapshots and repair a stale local copy after a successful DB read.
        if (!preferences.revision) preferences = { ...preferences, revision: Date.now() };
        try {
          if (preferences !== local) writePreferences(localStorage, key, preferences);
          setPreferencesError(null);
        } catch (error) { setPreferencesError(error); }
      }
      if (!snapshot && !preferences) return null;
      const restored = { ...structuredClone(defaultState), ...state,
        ...(preferences ? { settings: preferences.settings, workers: preferences.workers } : {}) } as AppState;
      const result = { state: restored, version: snapshot?.version ?? 1 };
      if (migratedLegacy && !readFailed) {
        try {
          await writeSnapshots(new Map([[key, { ...result, preferencesRevision: preferences?.revision ?? 0 }]]));
          localStorage.removeItem(key);
        } catch (error) { setError(error); }
      }
      return result;
    },
    setItem: (key, value) => {
      const { settings, workers } = value.state;
      if (settings !== lastSettings || workers !== lastWorkers || preferencesError) {
        const next = nextPreferences(preferences, { settings, workers });
        if (next !== preferences || preferencesError) {
          try {
            writePreferences(localStorage, key, next);
            setPreferencesError(null);
          } catch (error) { setPreferencesError(error); }
        }
        preferences = next;
        lastSettings = settings;
        lastWorkers = workers;
      }
      // A transient read failure must not overwrite an unseen catalog with defaults.
      // Preferences remain writable; reload after IndexedDB becomes available.
      if (!readFailed) queueSnapshot(key, { ...value, preferencesRevision: preferences?.revision ?? 0 });
    },
    removeItem: (key) => {
      pending.delete(key);
      latest.delete(key);
      preferences = null;
      lastSettings = undefined;
      lastWorkers = undefined;
      try {
        localStorage.removeItem(preferencesKey(key));
        localStorage.removeItem(key);
        setPreferencesError(null);
      } catch (error) { setPreferencesError(error); }
      chain = chain.then(() => deleteSnapshot(key)).catch(setError);
      return chain;
    },
  };
}

// Kept for compatibility when another entry point still expects this key.
export const LEGACY_STORAGE_KEY = OLD_KEY;
