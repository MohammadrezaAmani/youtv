import { z } from "zod";

export const subtitleSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  language: z.string().trim().max(35).default(""),
  url: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v)),
  format: z.enum(["vtt", "srt"]).default("vtt"),
});
export type SubtitleSource = z.infer<typeof subtitleSourceSchema>;

/** Preserve IPTV M3U metadata without confusing player-specific directives with names.
 * Unknown attributes/properties are kept for round-tripping; only supported HTTP
 * hints are ever sent to a Worker (no cookies, auth, or arbitrary headers).
 */
export const iptvMetadataSchema = z.object({
  duration: z.number().nullable().default(null),
  tvgName: z.string().default(""),
  channelNumber: z.string().default(""),
  radio: z.boolean().default(false),
  tvgShift: z.string().default(""),
  catchup: z.string().default(""),
  catchupDays: z.string().default(""),
  catchupSource: z.string().default(""),
  epgUrls: z.array(z.string()).default([]),
  userAgent: z.string().default(""),
  referer: z.string().default(""),
  vlcOptions: z.record(z.string(), z.string()).default({}),
  kodiProps: z.record(z.string(), z.string()).default({}),
  webProps: z.record(z.string(), z.string()).default({}),
  attributes: z.record(z.string(), z.string()).default({}),
});
export type IptvMetadata = z.infer<typeof iptvMetadataSchema>;

export const channelSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  url: z.url().refine((url) => /^https?:\/\//i.test(url), "Use an HTTP(S) URL"),
  logo: z.string().default(""),
  format: z.enum(["auto", "hls", "video"]).default("auto"),
  group: z.string().default(""),
  language: z.string().default(""),
  country: z.string().default(""),
  tvgId: z.string().default(""),
  iptv: iptvMetadataSchema.default(() => iptvMetadataSchema.parse({})),
  favorite: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(48)).default([]),
  description: z.string().max(1000).default(""),
  pinned: z.boolean().default(false),
  subtitles: z.array(subtitleSourceSchema).default([]),
  teletextUrl: z.string().max(2048).default(""),
  alternateUrls: z.array(z.string().url()).default([]),
  proxyMode: z.enum(["inherit", "direct", "proxy", "auto"]).default("inherit"),
  workerId: z.string().default(""),
  createdAt: z.number(),
  updatedAt: z.number(),
  sourceId: z.string().default(""),
});
export type Channel = z.infer<typeof channelSchema>;

export const playlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().default(""),
  importedAt: z.number(),
  refreshedAt: z.number().nullable().default(null),
  count: z.number().int().nonnegative().default(0),
  refreshWorkerId: z.string().default(""),
});
export type Playlist = z.infer<typeof playlistSchema>;

export const workerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.url().refine((url) => /^https?:\/\//i.test(url)),
  token: z.string().default(""),
  enabled: z.boolean().default(true),
});
export type WorkerProfile = z.infer<typeof workerSchema>;

export const healthResultSchema = z.object({
  status: z.enum(["online", "offline", "unknown"]),
  mode: z.enum(["direct", "proxy"]),
  elapsedMs: z.number().int().nonnegative(),
  httpStatus: z.number().int().optional(),
  checkedAt: z.number(),
  detail: z.string().max(240).default(""),
});
export type HealthResult = z.infer<typeof healthResultSchema>;
export const BUILTIN_PLAYLIST_ID = "youtv:builtin:default"; // legacy backup compatibility
export const DEFAULT_COUNTRY_SOURCE = "world-iptv/countries/ir.m3u";
export const BUILTIN_WORKER_ID = "youtv:builtin:worker";
export const builtinWorker: WorkerProfile = {
  id: BUILTIN_WORKER_ID,
  name: "YouTV",
  baseUrl: "https://meow.arushop.ir/",
  token: "",
  enabled: true,
};

export const settingsSchema = z.object({
  defaultPlaylistEnabled: z.boolean().default(true),
  folderSourceEnabled: z.record(z.string(), z.boolean()).default({ [DEFAULT_COUNTRY_SOURCE]: true }),
  cloudflareAccountId: z.string().max(32).default(""),
  cloudflareScriptName: z.string().max(64).default(""),
  healthCheckOnStartup: z.boolean().default(false),
  autoReconnect: z.boolean().default(true),
  reconnectMaxAttempts: z.number().int().min(1).max(12).default(8),
  preferredQuality: z
    .union([z.literal("auto"), z.number().int().min(144).max(4320)])
    .default("auto"),
  hlsLatencyMode: z.enum(["stable", "low"]).default("stable"),
  language: z.enum(["fa", "en", "ar", "tr", "ru"]).default("fa"),
  theme: z
    .enum(["dark", "light", "mint", "oled", "ocean", "emerald", "violet"])
    .default("dark"),
  proxyMode: z.enum(["direct", "proxy", "auto"]).default("auto"),
  defaultWorkerId: z.string().default(""),
  mediaRouteMode: z.enum(["direct", "proxy", "auto"]).default("auto"),
  mediaWorkerId: z.string().default(""),
  mediaWorkerFallback: z.boolean().default(true),
  mediaDirectFallback: z.boolean().default(false),
  /** One-time migration marker for the default connection route. */
  routingDefaultsVersion: z.number().int().nonnegative().default(0),
  cloudflareManagerWorkerId: z.string().default(""),
  miniPlayer: z.boolean().default(true),
  libraryLayout: z.enum(["grid", "list", "compact"]).default("grid"),
  librarySort: z
    .enum(["name", "name-desc", "newest", "oldest", "last-played", "group"])
    .default("name"),
  preferredAudio: z.string().default(""),
  preferredSubtitle: z.string().default(""),
  captionsEnabled: z.boolean().default(false),
  captionSize: z.enum(["small", "medium", "large"]).default("medium"),
  captionBackground: z.enum(["none", "shadow", "box"]).default("shadow"),
  defaultVolume: z.number().min(0).max(1).default(0.8),
  autoplay: z.boolean().default(false),
  defaultPlaybackRate: z.number().min(0.25).max(3).default(1),
  recordingBitrate: z
    .number()
    .int()
    .min(1_000_000)
    .max(12_000_000)
    .default(4_000_000),
});
export type Settings = z.infer<typeof settingsSchema>;

export const stateSchema = z.object({
  version: z.literal(1),
  channels: z.array(channelSchema),
  playlists: z.array(playlistSchema),
  workers: z.array(workerSchema),
  recent: z.array(z.string()),
  resume: z.record(z.string(), z.number().nonnegative()).default({}),
  health: z.record(z.string(), healthResultSchema).default({}),
  settings: settingsSchema,
});
export type AppState = z.infer<typeof stateSchema>;

export const defaultState: AppState = {
  version: 1,
  channels: [],
  playlists: [],
  workers: [{ ...builtinWorker }],
  recent: [],
  resume: {},
  health: {},
  settings: {
    cloudflareAccountId: "",
    cloudflareScriptName: "",
    defaultPlaylistEnabled: true,
    folderSourceEnabled: { [DEFAULT_COUNTRY_SOURCE]: true },
    healthCheckOnStartup: false,
    autoReconnect: true,
    reconnectMaxAttempts: 8,
    preferredQuality: "auto",
    hlsLatencyMode: "stable",
    language: "fa",
    theme: "dark",
    proxyMode: "auto",
    defaultWorkerId: BUILTIN_WORKER_ID,
    mediaRouteMode: "auto",
    mediaWorkerId: "",
    mediaWorkerFallback: true,
    mediaDirectFallback: false,
    routingDefaultsVersion: 1,
    cloudflareManagerWorkerId: "",
    miniPlayer: true,
    libraryLayout: "grid",
    librarySort: "name",
    preferredAudio: "",
    preferredSubtitle: "",
    captionsEnabled: false,
    captionSize: "medium",
    captionBackground: "shadow",
    defaultVolume: 0.8,
    autoplay: false,
    defaultPlaybackRate: 1,
    recordingBitrate: 4_000_000,
  },
};
/** Seed only empty profiles. Preserve user-configured (including disabled) Workers.
 * Never turn a saved Auto route into Proxy-only during legacy initialization. */
export function ensureDefaultWorker<T extends Pick<AppState, "workers" | "settings">>(state: T, migrateLegacyDefaults = false): T {
  const needsWorker = state.workers.length === 0;
  const needsRoutingMigration = migrateLegacyDefaults && state.settings.routingDefaultsVersion < 1;
  if (!needsWorker && !needsRoutingMigration) return state;

  return {
    ...state,
    workers: needsWorker ? [{ ...builtinWorker }] : state.workers,
    settings: {
      ...state.settings,
      ...(needsWorker ? { defaultWorkerId: BUILTIN_WORKER_ID, mediaWorkerId: "" } : {}),
      ...(needsRoutingMigration ? {
        routingDefaultsVersion: 1,
      } : {}),
    },
  };
}
export const WORKER_PROTOCOL_VERSION = 1;

export function createChannel(
  input: Pick<Channel, "name" | "url"> & Partial<Channel>,
): Channel {
  const now = Date.now();
  return channelSchema.parse({
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  });
}
export function normalizeStreamUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new Error("Stream URL must be HTTP(S)");
  if (u.username || u.password)
    throw new Error("Credentials embedded in URLs are not supported");
  return u.toString();
}
