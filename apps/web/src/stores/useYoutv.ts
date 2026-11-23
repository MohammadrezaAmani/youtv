import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  defaultState, stateSchema, createChannel,
  type Channel, type Playlist, type WorkerProfile, type Settings, type AppState, type HealthResult, BUILTIN_PLAYLIST_ID
} from '@youtv/shared';

type Store = AppState & {
  addChannel: (value: Pick<Channel,'name'|'url'> & Partial<Channel>) => void;
  upsertChannels: (values: Channel[], sourceId?: string, replaceSource?: boolean) => void;
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
export const useYoutv = create<Store>()(persist((set) => ({
  ...empty,
  addChannel: (value) => set(s => ({channels: [createChannel(value), ...s.channels]})),
  upsertChannels: (values, sourceId, replaceSource = false) => set(s => {
    // Each local folder file owns its own channel collection. Two sources may
    // contain the same stream URL, but disabling one must never hide the other.
    if(sourceId?.startsWith('youtv:folder:')){
      const previous=new Map(s.channels.filter(c=>c.sourceId===sourceId).map(c=>[c.url,c]));
      const others=s.channels.filter(c=>c.sourceId!==sourceId);
      const owned=new Map<string,Channel>();
      for(const value of values){
        const old=previous.get(value.url);
        owned.set(value.url,old?{...value,id:old.id,sourceId,favorite:old.favorite,pinned:old.pinned,
          tags:[...new Set([...old.tags,...value.tags])],createdAt:old.createdAt,updatedAt:Date.now()}:{...value,sourceId});
      }
      return {channels:[...others,...owned.values()]};
    }
    const existing = replaceSource && sourceId ? s.channels.filter(c => c.sourceId !== sourceId) : [...s.channels];
    const keyed = new Map(existing.map(c=>[c.id,c]));
    const oldByUrl = new Map(s.channels.map(c=>[c.url,c]));
    const currentByUrl = new Map(existing.map(c=>[c.url,c]));
    for (const value of values) {
      const same = currentByUrl.get(value.url) ?? oldByUrl.get(value.url);
      // A bundled item must not take ownership of a matching personal channel.
      if(sourceId===BUILTIN_PLAYLIST_ID&&same&&same.sourceId!==BUILTIN_PLAYLIST_ID)continue;
      if (same) {
        const merged = {...same, ...value, id:same.id, favorite:same.favorite, pinned:same.pinned, tags: [...new Set([...same.tags,...value.tags])],
          createdAt:same.createdAt, sourceId:sourceId ?? value.sourceId};
        keyed.set(same.id, merged);
        currentByUrl.set(value.url, merged);
      } else {
        const merged={...value,sourceId:sourceId ?? value.sourceId};
        keyed.set(value.id, merged);
        currentByUrl.set(value.url, merged);
      }
    }
    return {channels: [...keyed.values()]};
  }),
  updateChannel: (id, values) => set(s=>({channels:s.channels.map(c => c.id === id ? {...c,...values,id,updatedAt:Date.now()} : c)})),
  deleteChannel: (id) => set(s=>({channels:s.channels.filter(c=>c.id!==id),recent:s.recent.filter(i=>i!==id),resume:Object.fromEntries(Object.entries(s.resume).filter(([key])=>key!==id))})),
  toggleFavorite: (id) => set(s=>({channels:s.channels.map(c=>c.id===id?{...c,favorite:!c.favorite,updatedAt:Date.now()}:c)})),
  togglePinned: (id) => set(s=>({channels:s.channels.map(c=>c.id===id?{...c,pinned:!c.pinned,updatedAt:Date.now()}:c)})),
  bulkDelete: (ids) => set(s=>{const chosen=new Set(ids);return {channels:s.channels.filter(c=>!chosen.has(c.id)),recent:s.recent.filter(id=>!chosen.has(id)),resume:Object.fromEntries(Object.entries(s.resume).filter(([key])=>!chosen.has(key)))};}),
  bulkUpdate: (ids,changes) => set(s=>{const chosen=new Set(ids);return {channels:s.channels.map(c=>chosen.has(c.id)?{...c,...changes,id:c.id,updatedAt:Date.now()}:c)};}),
  bulkAddTags: (ids,tags) => set(s=>{const chosen=new Set(ids);return {channels:s.channels.map(c=>chosen.has(c.id)?{...c,tags:[...new Set([...c.tags,...tags])].slice(0,30),updatedAt:Date.now()}:c)};}),
  bulkRemoveTags: (ids,tags) => set(s=>{const chosen=new Set(ids),removed=new Set(tags);return {channels:s.channels.map(c=>chosen.has(c.id)?{...c,tags:c.tags.filter(tag=>!removed.has(tag)),updatedAt:Date.now()}:c)};}),
  playChannel: (id) => set(s=>({recent: [id, ...s.recent.filter(i=>i!==id)].slice(0,40)})),
  saveProgress: (id, seconds) => set(s=>({resume:{...s.resume,[id]:Math.max(0,seconds)}})),
  savePlaylist: (p) => set(s=>({playlists:[p,...s.playlists.filter(x=>x.id!==p.id)]})),
  setHealth: (batch) => set(s=>({health:{...s.health,...batch}})),
  clearHealth: () => set({health:{}}),
  removePlaylist: (id, removeChannels) => set(s=>({
    playlists:s.playlists.filter(p=>p.id!==id),
    channels:removeChannels?s.channels.filter(c=>c.sourceId!==id):s.channels
  })),
  saveWorker: (w) => set(s=>({workers:[w,...s.workers.filter(x=>x.id!==w.id)]})),
  removeWorker: (id) => set(s=>({workers:s.workers.filter(w=>w.id!==id),settings:{...s.settings,
    defaultWorkerId:s.settings.defaultWorkerId===id?'':s.settings.defaultWorkerId}})),
  updateSettings: (changes) => set(s=>({settings:{...s.settings,...changes}})),
  importState: (state) => set(()=>parseState(state)),
  reset: () => set(()=>structuredClone(defaultState))
}),{
  name:'youtv:v1',
  version:1,
  storage:createJSONStorage(()=>localStorage),
  partialize:s => ({version:s.version, channels:s.channels,playlists:s.playlists, workers:s.workers,recent:s.recent,resume:s.resume,health:s.health,settings:s.settings}),
  merge:(persisted,current) => {
    const parsed=stateSchema.safeParse(persisted);
    return parsed.success?{...current,...parsed.data}:current;
  }
}));

// Compatibility functions are retained for older imports. Full backup management is in lib/backup.ts.
import { downloadBackup, importBackupText } from '../lib/backup';
export function exportBackup(): void { downloadBackup(useYoutv.getState()); }
export function restoreBackup(text: string): void { useYoutv.getState().importState(importBackupText(text, useYoutv.getState(), 'replace')); }
