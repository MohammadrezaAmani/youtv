import { describe, expect, it } from "vitest";
import { newestPreferences, nextPreferences, preferencesKey, readPreferences, writePreferences } from "@/lib/preferencesJournal";
import { defaultState, stateSchema } from "@youtv/shared";

const config = () => ({ settings: { ...defaultState.settings, mediaRouteMode: "direct" as const, mediaWorkerId: "a", mediaWorkerFallback: false, mediaDirectFallback: true }, workers: [{ id: "a", name: "My Worker", baseUrl: "https://worker.example.org/", token: "proxy-test-token", enabled: true }] });
describe("durable local preferences journal", () => {
  it("keeps Worker and media fallback choices synchronously, before an IndexedDB flush", () => {
    const key = "test:preferences:reload";
    try {
      const value = config();
      const record = nextPreferences(null, value, 100);
      writePreferences(localStorage, key, record);
      expect(readPreferences(localStorage, key)).toEqual(record);
      expect(JSON.parse(localStorage.getItem(preferencesKey(key))!)).not.toHaveProperty("channels");
    } finally { localStorage.removeItem(preferencesKey(key)); }
  });
  it("uses the newer copy and never lets a stale IndexedDB snapshot undo a Worker deletion", () => {
    const first = nextPreferences(null, config(), 100);
    const deleted = nextPreferences(first, { ...config(), workers: [] }, 101);
    expect(newestPreferences(first, deleted)).toEqual(deleted);
    expect(newestPreferences(deleted, first)).toEqual(deleted);
    expect(newestPreferences(null, deleted)).toEqual(deleted);
  });
  it("does not generate revisions for unchanged preferences or regress when clocks move backwards", () => {
    const first = nextPreferences(null, config(), 100);
    expect(nextPreferences(first, config(), 200)).toBe(first);
    const second = nextPreferences(first, { ...config(), workers: [] }, 50);
    expect(second.revision).toBe(101);
  });
  it("rejects malformed recovery data instead of treating it as an empty Worker list", () => {
    const key = "test:preferences:invalid";
    try {
      localStorage.setItem(preferencesKey(key), '{"revision":123,"settings":{},"workers":null}');
      expect(() => readPreferences(localStorage, key)).toThrow("Invalid preferences");
    } finally { localStorage.removeItem(preferencesKey(key)); }
  });
  it("migrates old backups without media route preferences and preserves new choices", () => {
    const state = structuredClone(defaultState);
    const old = { ...state.settings } as Partial<typeof state.settings>;
    delete old.mediaRouteMode; delete old.mediaWorkerId; delete old.mediaWorkerFallback; delete old.mediaDirectFallback; delete old.cloudflareManagerWorkerId;
    const parsed = stateSchema.parse({ ...state, settings: old });
    expect(parsed.settings.mediaRouteMode).toBe("proxy");
    expect(parsed.settings.mediaWorkerId).toBe("");
    expect(parsed.settings.mediaWorkerFallback).toBe(true);
    expect(parsed.settings.mediaDirectFallback).toBe(false);
    expect(stateSchema.parse({ ...state, ...config() }).settings.mediaWorkerId).toBe("a");
    expect(stateSchema.parse({ ...state, ...config() }).settings.mediaRouteMode).toBe("direct");
  });
});
