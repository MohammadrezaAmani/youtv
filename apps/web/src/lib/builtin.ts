import { BUILTIN_PLAYLIST_ID, type Channel, type Settings } from '@youtv/shared';
import { parseM3u } from './playlist';

export const DEFAULT_PLAYLIST_URL = `${import.meta.env.BASE_URL}default.m3u8`;
export const FOLDER_SOURCE_PREFIX = 'youtv:folder:';
export function isVisibleChannel(channel: Channel, settings: Pick<Settings,'defaultPlaylistEnabled'|'folderSourceEnabled'>): boolean {
  if(channel.sourceId===BUILTIN_PLAYLIST_ID)return settings.defaultPlaylistEnabled;
  if(channel.sourceId.startsWith(FOLDER_SOURCE_PREFIX))return settings.folderSourceEnabled[channel.sourceId.slice(FOLDER_SOURCE_PREFIX.length)]===true;
  return true;
}
export async function readBundledPlaylist(signal?: AbortSignal) {
  const response = await fetch(DEFAULT_PLAYLIST_URL, {signal, credentials:'omit', cache:'no-cache'});
  if (!response.ok) throw new Error(`Bundled playlist HTTP ${response.status}`);
  const content = await response.text();
  if (content.length > 15_000_000) throw new Error('Bundled playlist exceeds 15MB');
  return parseM3u(content);
}
