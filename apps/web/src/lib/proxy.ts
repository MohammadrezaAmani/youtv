import { normalizeStreamUrl, type Channel, type Settings, type WorkerProfile } from '@youtv/shared';
export type ProxyResult = {url:string;mode:'direct'|'proxy';worker?:WorkerProfile};
/** 'default' means respect the saved global setting, unless this channel was
 * explicitly configured to use another route. It must never mean 'auto'. */
export type ConnectionOverride = 'default'|'direct'|'proxy'|'auto';
export type ConnectionMode = 'direct'|'proxy'|'auto';
/** On the HTTPS deployment, HTTP sources must be fetched server-side through an
 * HTTPS Worker. This is a browser mixed-content constraint, not a bad URL. */
export function needsHttpsRelay(sourceUrl:string,appProtocol=typeof window==='undefined'?'https:':window.location.protocol):boolean {
  return appProtocol==='https:' && /^http:\/\//i.test(sourceUrl);
}
const HTTP_WORKER_REQUIRED='This HTTP source needs an active HTTPS Worker (Proxy settings). Keep the original http:// URL; do not change it to https://.';
function requireHttpsWorker(worker:WorkerProfile,appProtocol:string):void {
  if(appProtocol==='https:' && !/^https:\/\//i.test(worker.baseUrl))
    throw new Error('The Worker endpoint must use HTTPS when YouTV is opened on GitHub Pages. The source may still use HTTP.');
}

export function effectiveConnectionMode(
  channel:Pick<Channel,'proxyMode'>,settings:Pick<Settings,'proxyMode'>,override:ConnectionOverride='default'
):ConnectionMode {
  return override==='default' ? (channel.proxyMode==='inherit'?settings.proxyMode:channel.proxyMode) : override;
}

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
export function resolveStream(channel:Channel,settings:Settings,workers:WorkerProfile[],forceProxy=false,appProtocol=typeof window==='undefined'?'https:':window.location.protocol):ProxyResult {
  const mode=effectiveConnectionMode(channel,settings);
  const needsRelay=needsHttpsRelay(channel.url,appProtocol);
  if (!forceProxy && !needsRelay && mode==='direct') return {url:channel.url,mode:'direct'};
  const worker=activeWorker(channel,settings,workers);
  if (!worker) {
    if (needsRelay) throw new Error(HTTP_WORKER_REQUIRED);
    if (mode==='proxy') throw new Error('Proxy is enabled but no active Worker is configured');
    return {url:channel.url,mode:'direct'};
  }
  if (!needsRelay && mode==='auto' && !forceProxy) return {url:channel.url,mode:'direct'};
  requireHttpsWorker(worker,appProtocol);
  return {url:proxyUrl(channel.url,worker,'proxy',(channel.format==='hls'||(channel.format==='auto'&&/\.m3u8?(?:[?#]|$)/i.test(channel.url))),{userAgent:channel.iptv.userAgent,referer:channel.iptv.referer}),mode:'proxy',worker};
}

/** Shared routing for URL-based IPTV playlists and Teletext. The saved URL
 * remains HTTP when necessary; only the browser's request goes to HTTPS. */
export function resolveTextSource(source:string,settings:Pick<Settings,'defaultWorkerId'>,workers:WorkerProfile[],requestedWorkerId='',useWorker=false,appProtocol=typeof window==='undefined'?'https:':window.location.protocol):{url:string;workerId:string} {
  const needsRelay=needsHttpsRelay(source,appProtocol);
  if(!needsRelay&&!useWorker)return {url:source,workerId:''};
  const worker=workers.find(w=>w.id===(requestedWorkerId||settings.defaultWorkerId)&&w.enabled)
    || (needsRelay?workers.find(w=>w.id===settings.defaultWorkerId&&w.enabled):undefined);
  if(!worker)throw new Error(needsRelay?HTTP_WORKER_REQUIRED:'Selected Worker is unavailable');
  requireHttpsWorker(worker,appProtocol);
  return {url:proxyUrl(source,worker,'text'),workerId:worker.id};
}
