import { BUILTIN_PLAYLIST_ID, type Channel, type Settings } from '@youtv/shared';
import { parseM3u } from './playlist';

export const DEFAULT_PLAYLIST_URL = `${import.meta.env.BASE_URL}default.m3u8`;
export function isVisibleChannel(channel: Channel, settings: Pick<Settings,'defaultPlaylistEnabled'>): boolean {
  return settings.defaultPlaylistEnabled || channel.sourceId !== BUILTIN_PLAYLIST_ID;
}
export async function readBundledPlaylist(signal?: AbortSignal) {
  const response = await fetch(DEFAULT_PLAYLIST_URL, {signal, credentials:'omit', cache:'no-cache'});
  if (!response.ok) throw new Error(`Bundled playlist HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 15_000_000) throw new Error('Bundled playlist exceeds 15MB');
  return parseM3u(content);
}
