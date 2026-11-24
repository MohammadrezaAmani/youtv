/** Small, synchronous recovery copy. Never serialize the channel catalog here. */
export type Preferences = { settings: unknown; workers: unknown };
export type PreferencesRecord = Preferences & { revision: number };
export type PreferencesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const preferencesKey = (key: string) => `${key}:preferences:v1`;

export function readPreferences(storage: PreferencesStorage, key: string): PreferencesRecord | null {
  const raw = storage.getItem(preferencesKey(key));
  if (raw === null) return null;
  const record = JSON.parse(raw) as Partial<PreferencesRecord> | null;
  if (!record || !Number.isSafeInteger(record.revision) || (record.revision ?? 0) < 1 ||
      !record.settings || typeof record.settings !== "object" || Array.isArray(record.settings) || !Array.isArray(record.workers)) {
    throw new Error("Invalid preferences recovery copy");
  }
  return record as PreferencesRecord;
}

export function writePreferences(storage: PreferencesStorage, key: string, record: PreferencesRecord): void {
  storage.setItem(preferencesKey(key), JSON.stringify(record));
}

export function newestPreferences(database: PreferencesRecord | null, local: PreferencesRecord | null): PreferencesRecord | null {
  return local && (!database || local.revision >= database.revision) ? local : database;
}

export function nextPreferences(previous: PreferencesRecord | null, value: Preferences, now = Date.now()): PreferencesRecord {
  if (previous && JSON.stringify(previous.settings) === JSON.stringify(value.settings) &&
      JSON.stringify(previous.workers) === JSON.stringify(value.workers)) return previous;
  return { settings: value.settings, workers: value.workers, revision: Math.max(now, (previous?.revision ?? 0) + 1) };
}
