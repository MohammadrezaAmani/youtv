import { normalizeStreamUrl, type Channel, type Settings, type WorkerProfile } from '@youtv/shared';
export type ProxyResult = {url:string;mode:'direct'|'proxy';worker?:WorkerProfile};
export function activeWorker(channel:Channel,settings:Settings,workers:WorkerProfile[]):WorkerProfile|undefined {
  const id=channel.workerId || settings.defaultWorkerId;
  return workers.find(w=>w.id===id&&w.enabled);
}
export function proxyUrl(url:string,worker:WorkerProfile,route:'proxy'|'text'|'probe'='proxy',hls=false):string {
  const base=normalizeStreamUrl(worker.baseUrl);
  const path=new URL(route,base.endsWith('/')?base:base+'/');
  path.searchParams.set('url',normalizeStreamUrl(url));
  path.searchParams.set('key',worker.token);
  if(route==='proxy'&&hls)path.searchParams.set('hls','1');
  return path.toString();
}
export function resolveStream(channel:Channel,settings:Settings,workers:WorkerProfile[],forceProxy=false):ProxyResult {
  const mode=channel.proxyMode==='inherit'?settings.proxyMode:channel.proxyMode;
  if (!forceProxy && mode==='direct') return {url:channel.url,mode:'direct'};
  const worker=activeWorker(channel,settings,workers);
  if (!worker) {
    if (mode==='proxy') throw new Error('Proxy is enabled but no active Worker is configured');
    return {url:channel.url,mode:'direct'};
  }
  if (mode==='auto' && !forceProxy) return {url:channel.url,mode:'direct'};
  if (!worker.token) throw new Error('Worker access token is missing');
  return {url:proxyUrl(channel.url,worker,'proxy',channel.format==='hls'),mode:'proxy',worker};
}
