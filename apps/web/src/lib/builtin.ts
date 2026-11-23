import { BUILTIN_PLAYLIST_ID, type Channel, type Settings } from '@youtv/shared';
import { parseM3u } from './playlist';
import {readCatalogAsset} from './catalogCache';

export const DEFAULT_PLAYLIST_URL = `${import.meta.env.BASE_URL}default.m3u8`;
export const FOLDER_SOURCE_PREFIX = 'youtv:folder:';
export function isVisibleChannel(channel: Channel, settings: Pick<Settings,'defaultPlaylistEnabled'|'folderSourceEnabled'>): boolean {
  if(channel.sourceId===BUILTIN_PLAYLIST_ID)return settings.defaultPlaylistEnabled;
  if(channel.sourceId.startsWith(FOLDER_SOURCE_PREFIX)){
    const file = channel.sourceId.slice(FOLDER_SOURCE_PREFIX.length);
    if (import.meta.env.VITE_YOUTV_CURATED === '1' && !file.startsWith('_verified/')) return false;
    return settings.folderSourceEnabled[file]===true;
  }
  return true;
}
export async function readBundledPlaylist(signal?: AbortSignal,force=false) {
  const content=await readCatalogAsset('default.m3u8',{force});
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return parseM3u(content);
}
