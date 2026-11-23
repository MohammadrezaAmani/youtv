import { normalizeStreamUrl, type Channel, type Settings, type WorkerProfile } from '@youtv/shared';
export type ProxyResult = {url:string;mode:'direct'|'proxy';worker?:WorkerProfile};
export function activeWorker(channel:Channel,settings:Settings,workers:WorkerProfile[]):WorkerProfile|undefined {
  const id=channel.workerId || settings.defaultWorkerId;
  return workers.find(w=>w.id===id&&w.enabled);
}
export function proxyUrl(url:string,worker:WorkerProfile,route:'proxy'|'text'|'probe'='proxy',hls=false,hints?:{userAgent?:string;referer?:string}):string {
  const base=normalizeStreamUrl(worker.baseUrl);
  const path=new URL(route,base.endsWith('/')?base:base+'/');
  path.searchParams.set('url',normalizeStreamUrl(url));
  if(worker.token)path.searchParams.set('key',worker.token);
  if(route==='proxy'&&hls)path.searchParams.set('hls','1');
  if(hints?.userAgent)path.searchParams.set('ua',hints.userAgent);
  if(hints?.referer)path.searchParams.set('ref',hints.referer);
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
  return {url:proxyUrl(channel.url,worker,'proxy',(channel.format==='hls'||(channel.format==='auto'&&/\.m3u8?(?:[?#]|$)/i.test(channel.url))),{userAgent:channel.iptv.userAgent,referer:channel.iptv.referer}),mode:'proxy',worker};
}
