import { BUILTIN_PLAYLIST_ID, DEFAULT_COUNTRY_SOURCE, createChannel, type Channel, type Settings } from "@youtv/shared";
import { parseM3u } from "./playlist";
import { sourceDisplayName } from "./sourceNames";

export const FOLDER_SOURCE_PREFIX = "youtv:folder:";
export const DEFAULT_COUNTRY_ID = FOLDER_SOURCE_PREFIX + DEFAULT_COUNTRY_SOURCE;
export function isLegacySource(path: string): boolean {
  return path.split("/").includes("_verified");
}
export function isIndexSource(path: string): boolean {
  return path.startsWith("world-iptv/indexes/");
}
export function isFolderSourceEnabled(path: string, settings: Pick<Settings, "folderSourceEnabled">): boolean {
  if (isLegacySource(path) || isIndexSource(path)) return false;
  return settings.folderSourceEnabled[path] ?? path === DEFAULT_COUNTRY_SOURCE;
}
export function isVisibleChannel(channel: Channel, settings: Pick<Settings, "folderSourceEnabled">): boolean {
  // Keep legacy data in storage for backups, but never show the obsolete aggregate.
  if (channel.sourceId === BUILTIN_PLAYLIST_ID) return false;
  if (channel.sourceId.startsWith(FOLDER_SOURCE_PREFIX)) {
    return isFolderSourceEnabled(channel.sourceId.slice(FOLDER_SOURCE_PREFIX.length), settings);
  }
  return true;
}
export const folderSourceUrl = (path: string) =>
  `${import.meta.env.BASE_URL}sources/${path.split("/").map(encodeURIComponent).join("/")}`;

export async function readFolderPlaylist(path: string, kind: "playlist" | "hls", signal?: AbortSignal) {
  const url = new URL(folderSourceUrl(path), window.location.origin).href;
  const response = await fetch(url, { credentials: "omit", cache: "no-cache", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (kind === "hls") {
    await response.body?.cancel().catch(() => undefined);
    return { channels: [createChannel({ name: sourceDisplayName(path, "en").replace(/\.m3u8?$/i, ""), url, format: "hls", group: path.slice(0, path.lastIndexOf("/")) })], warnings: [] };
  }
  const result = parseM3u(await response.text(), response.url || url);
  if (!result.channels.length) throw new Error("No readable channels in source");
  return result;
}
