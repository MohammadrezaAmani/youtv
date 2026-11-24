import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createIndexedDbStorage, reportRecoveryIssue } from "@/lib/indexedDbStorage";
import { parseExtinf, parseM3u, displayNameFromUrl } from "@/lib/playlist";
import {
  defaultState,
  stateSchema,
  settingsSchema,
  workerSchema,
  channelSchema,
  playlistSchema,
  healthResultSchema,
  createChannel,
  type Channel,
  type Playlist,
  type WorkerProfile,
  type Settings,
  type AppState,
  type HealthResult,
  BUILTIN_PLAYLIST_ID,
} from "@youtv/shared";

type Store = AppState & {
  addChannel: (value: Pick<Channel, "name" | "url"> & Partial<Channel>) => void;
  upsertChannels: (
    values: Channel[],
    sourceId?: string,
    replaceSource?: boolean,
  ) => void;
  updateChannel: (id: string, values: Partial<Channel>) => void;
  deleteChannel: (id: string) => void;
  bulkDelete: (ids: string[]) => void;
  bulkUpdate: (ids: string[], changes: Partial<Channel>) => void;
  bulkAddTags: (ids: string[], tags: string[]) => void;
  bulkRemoveTags: (ids: string[], tags: string[]) => void;
  togglePinned: (id: string) => void;
  toggleFavorite: (id: string) => void;
  playChannel: (id: string) => void;
  saveProgress: (id: string, seconds: number) => void;
  savePlaylist: (playlist: Playlist) => void;
  setHealth: (batch: Record<string, HealthResult>) => void;
  clearHealth: () => void;
  removePlaylist: (id: string, removeChannels: boolean) => void;
  saveWorker: (worker: WorkerProfile) => void;
  removeWorker: (id: string) => void;
  updateSettings: (changes: Partial<Settings>) => void;
  importState: (state: AppState) => void;
  reset: () => void;
};

const empty = structuredClone(defaultState);
const parseState = (unknown: unknown): AppState => stateSchema.parse(unknown);
/** Repair a legacy import that saved EXTINF attributes as a channel title. */
export function repairLegacyMetadata(channel: Channel): Channel {
  const title = channel.name.trim();
  if (/^(?:#?(?:EXTVLCOPT|KODIPROP|EXTHTTP|WEBPROP)\s*:)/i.test(title)) {
    try {
      const recovered = parseM3u(`#EXTM3U\n#EXTINF:-1,${title}\n${channel.url}`)
        .channels[0];
      if (recovered)
        return {
          ...channel,
          name: displayNameFromUrl(channel.url),
          iptv: {
            ...channel.iptv,
            userAgent: channel.iptv.userAgent || recovered.iptv.userAgent,
            referer: channel.iptv.referer || recovered.iptv.referer,
            vlcOptions: {
              ...channel.iptv.vlcOptions,
              ...recovered.iptv.vlcOptions,
            },
            kodiProps: {
              ...channel.iptv.kodiProps,
              ...recovered.iptv.kodiProps,
            },
          },
        };
    } catch {
      return { ...channel, name: displayNameFromUrl(channel.url) };
    }
  }
  if (!/^(?:tvg-id|tvg-logo|tvg-name|group-title)\s*=/i.test(title))
    return channel;
  const { name, attrs } = parseExtinf(`#EXTINF:-1, ${title}`);
  if (!name || name === channel.name) return channel;
  return {
    ...channel,
    name,
    group: channel.group || attrs["group-title"] || "",
    logo: channel.logo || attrs["tvg-logo"] || "",
    tvgId: channel.tvgId || attrs["tvg-id"] || "",
  };
}

/** One malformed record must not erase unrelated preferences or library rows. */
export function recoverStoredState(value: unknown): AppState {
  reportRecoveryIssue();
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings as Record<string, unknown> : {};
  const settings = { ...defaultState.settings };
  for (const key of Object.keys(settingsSchema.shape) as (keyof Settings)[]) {
    const result = settingsSchema.shape[key].safeParse(rawSettings[key]);
    if (result.success) Object.assign(settings, { [key]: result.data });
  }
  const validRows = <T,>(rows: unknown, schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } }): T[] =>
    Array.isArray(rows) ? rows.flatMap(row => { const parsed = schema.safeParse(row); return parsed.success ? [parsed.data] : []; }) : [];
  const resume = raw.resume && typeof raw.resume === "object" ? Object.fromEntries(Object.entries(raw.resume).filter(([, v]) => typeof v === "number" && Number.isFinite(v) && v >= 0)) : {};
  const health = raw.health && typeof raw.health === "object" ? Object.fromEntries(Object.entries(raw.health).flatMap(([key, value]) => { const result = healthResultSchema.safeParse(value); return result.success ? [[key, result.data]] : []; })) : {};
  return stateSchema.parse({ ...defaultState, settings,
    workers: validRows(raw.workers, workerSchema),
    channels: validRows(raw.channels, channelSchema).map(repairLegacyMetadata),
    playlists: validRows(raw.playlists, playlistSchema),
    recent: Array.isArray(raw.recent) ? raw.recent.filter((v): v is string => typeof v === "string") : [],
    resume, health });
}

export const useYoutv = create<Store>()(
  persist(
    (set) => ({
      ...empty,
      addChannel: (value) =>
        set((s) => ({ channels: [createChannel(value), ...s.channels] })),
      upsertChannels: (values, sourceId, replaceSource = false) =>
        set((s) => {
          // Each local folder file owns its own channel collection. Two sources may
          // contain the same stream URL, but disabling one must never hide the other.
          if (sourceId && sourceId !== BUILTIN_PLAYLIST_ID) {
            const previous = new Map(
              s.channels
                .filter((c) => c.sourceId === sourceId)
                .map((c) => [c.url, c]),
            );
            const others = s.channels.filter((c) => c.sourceId !== sourceId);
            const owned = new Map<string, Channel>();
            for (const value of values) {
              const old = previous.get(value.url);
              owned.set(
                value.url,
                old
                  ? {
                      ...value,
                      id: old.id,
                      sourceId,
                      favorite: old.favorite,
                      pinned: old.pinned,
                      tags: [...new Set([...old.tags, ...value.tags])],
                      proxyMode: old.proxyMode,
                      workerId: old.workerId,
                      createdAt: old.createdAt,
                      updatedAt: Date.now(),
                    }
                  : { ...value, sourceId },
              );
            }
            return { channels: [...others, ...owned.values()] };
          }
          const existing =
            replaceSource && sourceId
              ? s.channels.filter((c) => c.sourceId !== sourceId)
              : [...s.channels];
          const keyed = new Map(existing.map((c) => [c.id, c]));
          const oldByUrl = new Map(s.channels.map((c) => [c.url, c]));
          const currentByUrl = new Map(existing.map((c) => [c.url, c]));
          for (const value of values) {
            const same = currentByUrl.get(value.url) ?? oldByUrl.get(value.url);
            // A bundled item must not take ownership of a matching personal channel.
            if (
              sourceId === BUILTIN_PLAYLIST_ID &&
              same &&
              same.sourceId !== BUILTIN_PLAYLIST_ID
            )
              continue;
            if (same) {
              const merged = {
                ...same,
                ...value,
                id: same.id,
                favorite: same.favorite,
                pinned: same.pinned,
                tags: [...new Set([...same.tags, ...value.tags])],
                createdAt: same.createdAt,
                proxyMode: same.proxyMode,
                workerId: same.workerId,
                sourceId: sourceId ?? value.sourceId,
              };
              keyed.set(same.id, merged);
              currentByUrl.set(value.url, merged);
            } else {
              const merged = { ...value, sourceId: sourceId ?? value.sourceId };
              keyed.set(value.id, merged);
              currentByUrl.set(value.url, merged);
            }
          }
          return { channels: [...keyed.values()] };
        }),
      updateChannel: (id, values) =>
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === id ? { ...c, ...values, id, updatedAt: Date.now() } : c,
          ),
        })),
      deleteChannel: (id) =>
        set((s) => ({
          channels: s.channels.filter((c) => c.id !== id),
          recent: s.recent.filter((i) => i !== id),
          resume: Object.fromEntries(
            Object.entries(s.resume).filter(([key]) => key !== id),
          ),
        })),
      toggleFavorite: (id) =>
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === id
              ? { ...c, favorite: !c.favorite, updatedAt: Date.now() }
              : c,
          ),
        })),
      togglePinned: (id) =>
        set((s) => ({
          channels: s.channels.map((c) =>
            c.id === id
              ? { ...c, pinned: !c.pinned, updatedAt: Date.now() }
              : c,
          ),
        })),
      bulkDelete: (ids) =>
        set((s) => {
          const chosen = new Set(ids);
          return {
            channels: s.channels.filter((c) => !chosen.has(c.id)),
            recent: s.recent.filter((id) => !chosen.has(id)),
            resume: Object.fromEntries(
              Object.entries(s.resume).filter(([key]) => !chosen.has(key)),
            ),
          };
        }),
      bulkUpdate: (ids, changes) =>
        set((s) => {
          const chosen = new Set(ids);
          return {
            channels: s.channels.map((c) =>
              chosen.has(c.id)
                ? { ...c, ...changes, id: c.id, updatedAt: Date.now() }
                : c,
            ),
          };
        }),
      bulkAddTags: (ids, tags) =>
        set((s) => {
          const chosen = new Set(ids);
          return {
            channels: s.channels.map((c) =>
              chosen.has(c.id)
                ? {
                    ...c,
                    tags: [...new Set([...c.tags, ...tags])],
                    updatedAt: Date.now(),
                  }
                : c,
            ),
          };
        }),
      bulkRemoveTags: (ids, tags) =>
        set((s) => {
          const chosen = new Set(ids),
            removed = new Set(tags);
          return {
            channels: s.channels.map((c) =>
              chosen.has(c.id)
                ? {
                    ...c,
                    tags: c.tags.filter((tag) => !removed.has(tag)),
                    updatedAt: Date.now(),
                  }
                : c,
            ),
          };
        }),
      playChannel: (id) =>
        set((s) => ({ recent: [id, ...s.recent.filter((i) => i !== id)] })),
      saveProgress: (id, seconds) =>
        set((s) => ({ resume: { ...s.resume, [id]: Math.max(0, seconds) } })),
      savePlaylist: (p) =>
        set((s) => ({
          playlists: [p, ...s.playlists.filter((x) => x.id !== p.id)],
        })),
      setHealth: (batch) => set((s) => ({ health: { ...s.health, ...batch } })),
      clearHealth: () => set({ health: {} }),
      removePlaylist: (id, removeChannels) =>
        set((s) => ({
          playlists: s.playlists.filter((p) => p.id !== id),
          channels: removeChannels
            ? s.channels.filter((c) => c.sourceId !== id)
            : s.channels,
        })),
      saveWorker: (w) =>
        set((s) => ({
          workers: s.workers.some((item) => item.id === w.id)
            ? s.workers.map((item) => item.id === w.id ? w : item)
            : [...s.workers, w],
          settings: { ...s.settings, defaultWorkerId: s.settings.defaultWorkerId === w.id && !w.enabled
            ? s.workers.find(item => item.id !== w.id && item.enabled)?.id ?? ""
            : (!s.settings.defaultWorkerId && w.enabled ? w.id : s.settings.defaultWorkerId) },
        })),
      removeWorker: (id) =>
        set((s) => ({
          workers: s.workers.filter((w) => w.id !== id),
          settings: {
            ...s.settings,
            mediaWorkerId: s.settings.mediaWorkerId === id ? "" : s.settings.mediaWorkerId,
            cloudflareManagerWorkerId: s.settings.cloudflareManagerWorkerId === id ? "" : s.settings.cloudflareManagerWorkerId,
            defaultWorkerId:
              s.settings.defaultWorkerId === id
                ? s.workers.find((w) => w.id !== id && w.enabled)?.id ?? ""
                : s.settings.defaultWorkerId,
          },
        })),
      updateSettings: (changes) =>
        set((s) => ({ settings: { ...s.settings, ...changes } })),
      importState: (state) => set(() => parseState(state)),
      reset: () => set(() => structuredClone(defaultState)),
    }),
    {
      name: "youtv:v1",
      version: 1,
      storage: createIndexedDbStorage(),
      partialize: (s) => ({
        version: s.version,
        channels: s.channels,
        playlists: s.playlists,
        workers: s.workers,
        recent: s.recent,
        resume: s.resume,
        health: s.health,
        settings: s.settings,
      }),
      merge: (persisted, current) => {
        if (persisted == null) return current;
        const parsed = stateSchema.safeParse(persisted);
        return parsed.success
          ? {
              ...current,
              ...parsed.data,
              channels: parsed.data.channels.map(repairLegacyMetadata),
            }
          : { ...current, ...recoverStoredState(persisted) };
      },
    },
  ),
);

// Compatibility functions are retained for older imports. Full backup management is in lib/backup.ts.
import { downloadBackup, importBackupText } from "../lib/backup";
export function exportBackup(): void {
  downloadBackup(useYoutv.getState());
}
export function restoreBackup(text: string): void {
  useYoutv
    .getState()
    .importState(importBackupText(text, useYoutv.getState(), "replace"));
}
