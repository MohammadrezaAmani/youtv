import { stateSchema, type AppState, type Channel } from '@youtv/shared';
import {downloadText} from './playlist';

export type RestoreMode='merge'|'replace';
export type BackupFile={format:'youtv-backup';formatVersion:2;exportedAt:string;includesWorkerTokens:boolean;data:AppState};
function stripActions(value:AppState):AppState {
  return stateSchema.parse({version:1,channels:value.channels,playlists:value.playlists,workers:value.workers,recent:value.recent,resume:value.resume,health:value.health,settings:value.settings});
}
export function createBackup(state:AppState,includeWorkerTokens=false):BackupFile {
  const data=stripActions(state);
  if(!includeWorkerTokens)data.workers=data.workers.map(w=>({...w,token:''}));
  return {format:'youtv-backup',formatVersion:2,exportedAt:new Date().toISOString(),includesWorkerTokens:includeWorkerTokens,data};
}
export function downloadBackup(state:AppState,includeWorkerTokens=false):void {
  const backup=createBackup(state,includeWorkerTokens);
  downloadText(JSON.stringify(backup,null,2),`youtv-full-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json');
}
export function parseBackupText(text:string):BackupFile {
  let raw:unknown;
  try{raw=JSON.parse(text);}catch{throw Error('Invalid JSON file');}
  if(!raw||typeof raw!=='object')throw Error('Invalid backup structure');
  const value=raw as Record<string,unknown>;
  if(value.format==='youtv-backup' && value.formatVersion===2){
    const data=stateSchema.parse(value.data);
    return {format:'youtv-backup',formatVersion:2,exportedAt:String(value.exportedAt||''),includesWorkerTokens:value.includesWorkerTokens===true,data};
  }
  if(value.version===1){ // backward compatibility with v0.3 exported raw-state format
    return {format:'youtv-backup',formatVersion:2,exportedAt:'',includesWorkerTokens:false,data:stateSchema.parse(value)};
  }
  throw Error('Unsupported YouTV backup format');
}
export function mergeBackup(current:AppState,incoming:AppState):AppState{
  const existing=stripActions(current),next=stripActions(incoming);
  const channelMap=new Map<string,Channel>(existing.channels.map(c=>[c.id,c]));
  for(const item of next.channels){
    const old=channelMap.get(item.id);
    channelMap.set(item.id, old?{...old,...item,tags:[...new Set([...old.tags,...item.tags])],favorite:old.favorite||item.favorite,pinned:old.pinned||item.pinned}:item);
  }
  const playlistMap=new Map(existing.playlists.map(p=>[p.id,p]));for(const p of next.playlists)playlistMap.set(p.id,p);
  const workers=new Map(existing.workers.map(w=>[w.id,w]));for(const w of next.workers){const old=workers.get(w.id);workers.set(w.id,{...w,token:w.token||old?.token||''});}
  return stateSchema.parse({version:1,channels:[...channelMap.values()],playlists:[...playlistMap.values()],workers:[...workers.values()],
    recent:[...new Set([...next.recent,...existing.recent])],resume:{...existing.resume,...next.resume},health:{...existing.health,...next.health},settings:{...existing.settings,...next.settings,folderSourceEnabled:{...existing.settings.folderSourceEnabled,...next.settings.folderSourceEnabled}}});
}
export function importBackupText(text:string,current:AppState,mode:RestoreMode='replace'):AppState{
  const incoming=parseBackupText(text).data;
  return mode==='replace'?incoming:mergeBackup(current,incoming);
}
