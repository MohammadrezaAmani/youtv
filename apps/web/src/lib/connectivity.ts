import { type Channel, type HealthResult, type Settings, type WorkerProfile } from '@youtv/shared';
import { activeWorker, proxyUrl } from './proxy';

type ProbeAnswer = { ok?: boolean; status?: number; elapsedMs?: number; contentType?: string; error?: string };
const TIMEOUT_MS = 8000;
function elapsed(start:number){return Math.max(0,Math.round(performance.now()-start));}
function validStatus(status:number){return status>=200 && status<400;}
function isValidHttpUrl(value:string){try {const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:';}catch{return false;}}

/** Browser health checks are HTTP probes, NOT ICMP. CORS failures are unknown, not "offline". */
export async function probeChannel(channel:Channel, settings:Settings, workers:WorkerProfile[], signal?:AbortSignal):Promise<HealthResult>{
  const started=performance.now();
  const worker=activeWorker(channel,settings,workers);
  const useProxy=channel.proxyMode==='proxy'||(channel.proxyMode==='inherit'&&settings.proxyMode==='proxy');
  if (!isValidHttpUrl(channel.url))return {status:'offline',mode:'direct',elapsedMs:elapsed(started),checkedAt:Date.now(),detail:'Invalid stream URL'};
  const viaProxy=async():Promise<HealthResult>=>{
    if(!worker?.token) return {status:'unknown',mode:'proxy',elapsedMs:elapsed(started),checkedAt:Date.now(),detail:'Worker/token unavailable'};
    try{
      const endpoint=proxyUrl(channel.url,worker,'probe');
      const response=await fetch(endpoint,{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(TIMEOUT_MS)]),credentials:'omit',cache:'no-store'});
      const value=await response.json() as ProbeAnswer;
      if(!response.ok||typeof value.status!=='number'){
        return {status:'unknown',mode:'proxy',elapsedMs:elapsed(started),checkedAt:Date.now(),detail:value.error||`Proxy probe HTTP ${response.status}`};
      }
      return {status:validStatus(value.status)?'online':'offline',mode:'proxy',httpStatus:value.status,elapsedMs:value.elapsedMs??elapsed(started),checkedAt:Date.now(),detail:value.contentType||''};
    }catch(error){
      return {status:'unknown',mode:'proxy',elapsedMs:elapsed(started),checkedAt:Date.now(),detail:signal?.aborted?'Cancelled':error instanceof Error?error.message:'Proxy unreachable'};
    }
  };
  if(useProxy)return viaProxy();
  try{
    const response=await fetch(channel.url,{method:'HEAD',mode:'cors',credentials:'omit',redirect:'follow',cache:'no-store',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(TIMEOUT_MS)])});
    if(response.status===405||response.status===501){
      const fallback=await fetch(channel.url,{method:'GET',headers:{Range:'bytes=0-0'},credentials:'omit',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(TIMEOUT_MS)])});
      await fallback.body?.cancel().catch(()=>undefined);
      return {status:validStatus(fallback.status)?'online':'offline',mode:'direct',httpStatus:fallback.status,elapsedMs:elapsed(started),checkedAt:Date.now(),detail:'HTTP probe completed'};
    }
    return {status:validStatus(response.status)?'online':'offline',mode:'direct',httpStatus:response.status,elapsedMs:elapsed(started),checkedAt:Date.now(),detail:'HTTP probe completed'};
  }catch(error){
    if(worker?.token&&!signal?.aborted){const result=await viaProxy();return {...result,detail:result.detail||'Direct probe inconclusive; checked through Worker'};}
    return {status:'unknown',mode:'direct',elapsedMs:elapsed(started),checkedAt:Date.now(),detail:signal?.aborted?'Cancelled':error instanceof Error?error.message:'CORS or network restriction'};
  }
}

export type ScanProgress={completed:number;total:number;online:number;offline:number;unknown:number};
/** Concurrency-limited, cancellable scan. flush happens in batches to avoid thousands of storage writes. */
export async function scanChannels(channels:Channel[], settings:Settings, workers:WorkerProfile[], signal:AbortSignal,
  onBatch:(results:Record<string,HealthResult>,progress:ScanProgress)=>void, concurrency=8):Promise<void>{
  const progress:ScanProgress={completed:0,total:channels.length,online:0,offline:0,unknown:0};
  let cursor=0;
  let pending:Record<string,HealthResult>={};
  const flush=()=>{if(Object.keys(pending).length){onBatch(pending,{...progress});pending={};}};
  const worker=async()=>{
    while(!signal.aborted){
      const index=cursor++;if(index>=channels.length)break;
      const channel=channels[index]!;
      const result=await probeChannel(channel,settings,workers,signal);
      if(signal.aborted)break;
      pending[channel.id]=result;
      progress.completed++;
      progress[result.status]++;
      if(progress.completed%48===0)flush();
    }
  };
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),12,channels.length)},worker));
  flush();
}
