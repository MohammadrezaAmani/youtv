import { assertAllowedUrl, assertOrigin, assertToken, corsHeaders, ProxyError, type ProxyEnv } from './security.ts';
import { isHls, readTextStream, rewriteHls } from './hls.ts';
import {cloudflareAdmin} from './cloudflare.ts';

export interface Env extends ProxyEnv {}
const MAX_REDIRECTS = 4;
const VERSION = '0.25.0';

function json(request: Request, env: Env, value: object, status = 200): Response {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(value), { status, headers });
}

async function fetchSource(url: URL, request: Request, env: Env): Promise<{response: Response; finalUrl: URL}> {
  let current = url;
  for (let i=0; i<=MAX_REDIRECTS; i++) {
    current = assertAllowedUrl(current.toString(), env);
    const headers = new Headers();
    for (const key of ['Range','If-Range','Accept']) {
      const v = request.headers.get(key);
      if (v) headers.set(key, v);
    }
    // IPTV-specific HTTP hints are token-protected and restricted to approved
    // upstream hosts. Never accept arbitrary headers such as Cookie/Auth.
    const query=new URL(request.url).searchParams;
    const agent=query.get('ua')||'';
    const referer=query.get('ref')||env.UPSTREAM_REFERER||'';
    if(agent.length>512||/[\r\n\x00-\x1f]/.test(agent))throw new ProxyError(400,'invalid_user_agent','Invalid User-Agent hint');
    if(referer){
      if(referer.length>2048||/[\r\n\x00-\x1f]/.test(referer))throw new ProxyError(400,'invalid_referer','Invalid Referer hint');
      let ref:URL;
      try{ref=new URL(referer);}catch{throw new ProxyError(400,'invalid_referer','Invalid Referer URL');}
      if(!['http:','https:'].includes(ref.protocol)||ref.username||ref.password)throw new ProxyError(400,'invalid_referer','Referer must be HTTP(S)');
      headers.set('Referer',ref.toString());
    }
    if(agent)headers.set('User-Agent',agent);
    // Deliberately omit client cookies and authorization headers.
    const response = await fetch(current.toString(), { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'manual',signal:request.signal });
    if (![301,302,303,307,308].includes(response.status)) return {response,finalUrl:current};
    const location = response.headers.get('Location');
    if (!location) throw new ProxyError(502, 'bad_redirect', 'Upstream redirect lacks Location');
    current = assertAllowedUrl(new URL(location, current).toString(), env);
  }
  throw new ProxyError(502, 'redirect_limit', 'Too many upstream redirects');
}

async function proxy(request: Request, env: Env, reqUrl: URL): Promise<Response> {
  const key = reqUrl.searchParams.get('key');
  assertToken(key, env);
  const rawUrl = reqUrl.searchParams.get('url');
  if (!rawUrl) throw new ProxyError(400, 'missing_url', 'url query parameter is required');
  const upstream = assertAllowedUrl(rawUrl, env);
  const {response, finalUrl} = await fetchSource(upstream, request, env);
  const headers = corsHeaders(request, env);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-YouTV-Proxy', VERSION);
  for (const name of ['Content-Type','Content-Range','Accept-Ranges','ETag','Last-Modified']) {
    const v = response.headers.get(name);
    if (v) headers.set(name, v);
  }
  // Avoid stale Content-Length when fetch has decompressed or playlist was rewritten.
  if (request.method === 'HEAD' || !response.ok || response.status === 206 || !(reqUrl.searchParams.get('hls')==='1'||isHls(finalUrl, response.headers.get('Content-Type') || ''))) {
    return new Response(request.method === 'HEAD' ? null : response.body, {status: response.status, statusText: response.statusText, headers});
  }
  const source = await readTextStream(response.body);
  let rewritten: string;
  try {
    const proxyUrl = new URL('/proxy', request.url);
    rewritten = rewriteHls(source, finalUrl, proxyUrl, key || '', {userAgent:reqUrl.searchParams.get('ua')||'',referer:reqUrl.searchParams.get('ref')||''});
  } catch (error) {
    throw new ProxyError(502, 'invalid_manifest', error instanceof Error ? error.message : 'Invalid HLS manifest');
  }
  headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
  return new Response(rewritten, {status: 200, headers});
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      assertOrigin(request, env);
      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders(request, env)});
      if(url.pathname==='/admin/cloudflare'){
        if(request.method!=='POST')throw new ProxyError(405,'method_not_allowed','POST required');
        return await cloudflareAdmin(request,env);
      }
      if(url.pathname==='/probe'){
        if(request.method!=='GET')throw new ProxyError(405,'method_not_allowed','GET required');
        assertToken(url.searchParams.get('key'),env);
        const source=url.searchParams.get('url');
        if(!source)throw new ProxyError(400,'missing_url','Source URL required');
        const start=Date.now();
        let result=await fetchSource(assertAllowedUrl(source,env),new Request(request.url,{method:'HEAD',signal:AbortSignal.timeout(9000)}),env);
        if([405,501].includes(result.response.status)){
          result=await fetchSource(assertAllowedUrl(source,env),new Request(request.url,{headers:{Range:'bytes=0-0'},signal:AbortSignal.timeout(9000)}),env);
        }
        await result.response.body?.cancel().catch(()=>undefined);
        return json(request,env,{ok:result.response.status>=200&&result.response.status<400,status:result.response.status,elapsedMs:Math.max(0,Date.now()-start),contentType:result.response.headers.get('Content-Type')||''});
      }
      if (url.pathname === '/health'  && request.method === 'GET') return json(request, env, { name:'YouTV Proxy', version: VERSION, ok:true });
      if (url.pathname === '/capabilities' && request.method === 'GET')
        return json(request, env, {protocol:1, hls:true, range:true, playlistImport:true, authentication:env.PROXY_TOKEN?.trim()?'query-token':'none'});
      if (url.pathname === '/text') {
        if (request.method !== 'GET') throw new ProxyError(405,'method_not_allowed','GET only');
        const key=url.searchParams.get('key'); assertToken(key,env);
        const raw=url.searchParams.get('url');
        if (!raw) throw new ProxyError(400,'missing_url','url query parameter is required');
        const {response}=await fetchSource(assertAllowedUrl(raw,env), request,env);
        if (!response.ok) throw new ProxyError(502,'upstream_error',`Playlist source returned HTTP ${response.status}`);
        // Playlist/text responses do not need rewriting: stream them to the
        // browser instead of buffering the entire file or rejecting large lists.
        const headers=corsHeaders(request,env);
        headers.set('Content-Type','text/plain; charset=utf-8');headers.set('Cache-Control','no-store');
        return new Response(response.body,{status:200,headers});
      }
      if (url.pathname !== '/proxy') return json(request,env,{code:'not_found',error:'Not found'},404);
      if (!['GET','HEAD'].includes(request.method)) throw new ProxyError(405,'method_not_allowed','GET/HEAD only');
      return await proxy(request,env,url);
    } catch (error) {
      if (error instanceof ProxyError) return json(request,env,{code:error.code,error:error.message},error.status);
      // Never expose secret-bearing upstream URLs or request tokens in errors.
      return json(request,env,{code:'upstream_error',error:'Upstream request failed'},502);
    }
  }
} satisfies ExportedHandler<Env>;
