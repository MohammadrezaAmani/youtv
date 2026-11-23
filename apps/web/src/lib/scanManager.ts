import type {Channel,HealthResult,Settings,WorkerProfile} from '@youtv/shared';
import {scanChannels,type ScanProgress} from './connectivity';

export type ScanSnapshot={running:boolean;progress:ScanProgress;error:string};
const emptyProgress:ScanProgress={completed:0,total:0,online:0,offline:0,unknown:0};
let snapshot:ScanSnapshot={running:false,progress:emptyProgress,error:''};
let controller:AbortController|null=null;
const listeners=new Set<(value:ScanSnapshot)=>void>();
export function getScanSnapshot():ScanSnapshot{return snapshot;}
export function subscribeScan(listener:(value:ScanSnapshot)=>void):()=>void{
  listeners.add(listener);listener(snapshot);return ()=>{listeners.delete(listener);};
}
function update(next:ScanSnapshot){snapshot=next;for(const fn of listeners)fn(next);}
/** One global scan prevents duplicate traffic across the app and diagnostics page. */
export function startScan(channels:Channel[],settings:Settings,workers:WorkerProfile[],save:(data:Record<string,HealthResult>)=>void):boolean{
  if(controller||channels.length===0)return false;
  const run=new AbortController();controller=run;
  update({running:true,progress:{...emptyProgress,total:channels.length},error:''});
  void scanChannels(channels,settings,workers,run.signal,(batch,progress)=>{
    save(batch);update({running:true,progress,error:''});
  }).catch(error=>{
    update({...snapshot,error:error instanceof Error?error.message:String(error)});
  }).finally(()=>{
    if(controller===run){controller=null;update({...snapshot,running:false});}
  });
  return true;
}
export function stopScan(){controller?.abort();}
