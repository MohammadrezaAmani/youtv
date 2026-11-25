export type PublicAssetCacheOptions = {
  maxEntries?: number;
  maxObjectBytes?: number;
  maxTotalBytes?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  concurrency?: number;
};

/** Shared by the production shell worker and the image-only development worker.
 * Public assets persist across releases; application code and media never enter
 * this runtime cache. Opaque responses remain on the browser's HTTP cache path.
 */
export function imageCacheRuntime(prefix: string, options: PublicAssetCacheOptions = {}): string {
  const bounds = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
    Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value!)) : fallback;
  return String.raw`
const IMAGE_CACHE=${JSON.stringify(prefix + "images-v1")};
const IMAGE_META=${JSON.stringify(prefix + "image-meta-v1")};
const IMAGE_MAX_ENTRIES=${bounds(options.maxEntries, 512, 1, 4096)};
const IMAGE_MAX_BYTES=${bounds(options.maxObjectBytes, 2*1024*1024, 1024, 16*1024*1024)};
const IMAGE_TOTAL_BYTES=${bounds(options.maxTotalBytes, 64*1024*1024, 1024, 256*1024*1024)};
const IMAGE_MAX_AGE=${bounds(options.maxAgeMs, 7*86400000, 1000, 30*86400000)};
const IMAGE_TIMEOUT=${bounds(options.timeoutMs, 30000, 1000, 300000)};
const IMAGE_CONCURRENCY=${bounds(options.concurrency, 3, 1, 6)};
const imagePending=new Map();
const imageCorsFailures=new Map();
let imageWrites=Promise.resolve(),imageActive=0;
const imageWaiters=[];
async function imageSlot(run,signal){
  if(signal?.aborted)return Response.error();
  if(imageActive<IMAGE_CONCURRENCY)imageActive++;
  else await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',expire);};
    const item={resolve:()=>{cleanup();resolve();}};
    const expire=()=>{const index=imageWaiters.indexOf(item);if(index>=0)imageWaiters.splice(index,1);cleanup();reject(new Error('Image no longer needed or admission timed out'));};
    timer=setTimeout(expire,IMAGE_TIMEOUT);
    signal?.addEventListener('abort',expire,{once:true});
    // A new navigation must not sit behind a previous page's thumbnail backlog.
    // Every queued item has a deadline; completed cache hits bypass this queue.
    imageWaiters.unshift(item);
  });
  try{return await run();}
  finally{const next=imageWaiters.shift();if(next)next.resolve();else imageActive--;}
}
function publicImageRequest(request,url){
  if(!['image','font','style'].includes(request.destination)||request.headers.has('range')||request.headers.has('authorization'))return false;
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)return false;
  if(request.destination==='style')return url.hostname==='fonts.googleapis.com'&&/^\/css2?$/.test(url.pathname)&&[...url.searchParams.keys()].every(k=>['family','display','subset'].includes(k));
  if(!url.search)return true;
  if(!/\/proxy$/.test(url.pathname)||[...url.searchParams.keys()].some(key=>key!=='url'))return false;
  try {
    const source=new URL(url.searchParams.get('url'));
    return /^https?:$/.test(source.protocol)&&!source.username&&!source.password&&!source.search;
  }catch{return false;}
}
function imageExpiry(response){
  if(response.status!==200||response.type==='opaque'||! /^(?:image\/[a-z0-9.+-]+|font\/[a-z0-9.+-]+|application\/(?:font-woff|x-font-ttf|vnd.ms-fontobject)|text\/css)(?:\s*;|$)/i.test(response.headers.get('content-type')||''))return 0;
  const policy=response.headers.get('cache-control')||'';
  if(/\b(?:no-store|no-cache|private)\b/i.test(policy)||/no-cache/i.test(response.headers.get('pragma')||'')||/\b(?:cookie|authorization)\b|\*/i.test(response.headers.get('vary')||''))return 0;
  const match=/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(policy);
  let ttl=match?Number(match[1])*1000:0;
  if(!match){
    const expires=Date.parse(response.headers.get('expires')||'');
    const date=Date.parse(response.headers.get('date')||'')||Date.now();
    const modified=Date.parse(response.headers.get('last-modified')||'');
    if(Number.isFinite(expires))ttl=expires-date;
    else if(!policy&&Number.isFinite(modified))ttl=Math.min(86400000,Math.max(0,(date-modified)*.1));
  }
  const age=Number(response.headers.get('age')||0);
  if(!Number.isFinite(age))return 0;
  ttl=Math.min(IMAGE_MAX_AGE,Math.max(0,ttl-age*1000));
  return ttl>0?Date.now()+ttl:0;
}
async function imageMetadata(stamp){
  if(!stamp)return null;
  try{
    const value=JSON.parse(await stamp.text());
    // Read the previous release's freshness stamps without deleting good images.
    return typeof value==='number'?{expires:value,used:0,bytes:IMAGE_MAX_BYTES}:value;
  }catch{return null;}
}
async function smallImage(response){
  const length=response.headers.get('content-length');
  if(length!==null&&Number(length)>IMAGE_MAX_BYTES)return 0;
  const reader=response.clone().body?.getReader();
  if(!reader)return 0;
  let bytes=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)return bytes;
      bytes+=next.value.byteLength;
      if(bytes>IMAGE_MAX_BYTES){void reader.cancel().catch(()=>{});return 0;}
    }
  }catch{return 0;}
  finally{reader.releaseLock();}
}
async function saveImage(cache,meta,key,response,expires,bytes){
  const write=imageWrites.catch(()=>{}).then(async()=>{
    await cache.put(key,response);
    try{await meta.put(key,new Response(JSON.stringify({expires,used:Date.now(),bytes}),{headers:{Vary:'Accept'}}));}
    catch(error){await cache.delete(key);throw error;}
    const records=await Promise.all((await cache.keys()).map(async request=>({request,stamp:await imageMetadata(await meta.match(request))})));
    records.sort((a,b)=>(a.stamp?.used||0)-(b.stamp?.used||0));
    let count=records.length,total=records.reduce((sum,r)=>sum+(r.stamp?.bytes||IMAGE_MAX_BYTES),0);
    for(const r of records){
      if(r.stamp?.expires>Date.now()&&count<=IMAGE_MAX_ENTRIES&&total<=IMAGE_TOTAL_BYTES)continue;
      await cache.delete(r.request);await meta.delete(r.request);
      count--;total-=r.stamp?.bytes||IMAGE_MAX_BYTES;
    }
  });
  imageWrites=write;
  await write;
}
function imageFetch(request,cache='default'){
  let signal;
  if(typeof AbortSignal.timeout==='function')signal=AbortSignal.timeout(IMAGE_TIMEOUT);
  else{const controller=new AbortController();setTimeout(()=>controller.abort(),IMAGE_TIMEOUT);signal=controller.signal;}
  return fetch(request,{cache,signal,priority:'low'});
}
async function loadPublicImage(request){
  const key=new Request(request.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:request.headers.get('accept')||'image/*'}});
  let cache,meta;
  try{
    cache=await caches.open(IMAGE_CACHE);meta=await caches.open(IMAGE_META);
    const [cached,stamp]=await Promise.all([cache.match(key),meta.match(key)]);
    const info=await imageMetadata(stamp);
    if(cached&&info?.expires>Date.now()&&info.bytes<=IMAGE_MAX_BYTES){
      try{await meta.put(key,new Response(JSON.stringify({...info,used:Date.now()}),{headers:{Vary:'Accept'}}));}catch{}
      return cached;
    }
    if(cached||stamp){await cache.delete(key);await meta.delete(key);}
  }catch{/* storage disabled or quota exhausted: normal networking remains available */}
  return imageSlot(async()=>{
    let response;
    const origin=new URL(request.url).origin;
    try{
      if((imageCorsFailures.get(origin)||0)>Date.now())return await imageFetch(request);
      response=await imageFetch(key,'default');
    }catch(error){
      const resource=new URL(request.url);
      if(error?.name==='TimeoutError'||error?.name==='AbortError'||request.mode!=='no-cors'||(resource.pathname.endsWith('/proxy')&&resource.searchParams.has('url')))return Response.error();
      imageCorsFailures.set(origin,Date.now()+300000);
      if(imageCorsFailures.size>128)imageCorsFailures.delete(imageCorsFailures.keys().next().value);
      try{return await imageFetch(request);}catch{return Response.error();}
    }
    // A readable HTML/JSON error is already known to be unusable. Do not issue
    // a second identical image request or store a response that triggers ORB.
    if(!response.ok)return response;
    const type=response.headers.get('content-type')||'';
    const valid=request.destination==='font'?/^(?:font\/|application\/(?:font-woff|x-font-ttf|vnd.ms-fontobject))/i.test(type):
      request.destination==='style'?/^text\/css/i.test(type):/^image\//i.test(type);
    if(!valid)return Response.error();
    const expires=imageExpiry(response);
    if(cache&&meta&&expires){
      try{const bytes=await smallImage(response);if(bytes)await saveImage(cache,meta,key,response.clone(),expires,bytes);}
      catch{/* cache failures never prevent image display */}
    }
    return response;
  },request.signal).catch(()=>Response.error());
}
function cachedPublicImage(request){
  const id=JSON.stringify([request.url,request.headers.get('accept')||'image/*',request.mode,request.credentials,request.referrer]);
  let pending=imagePending.get(id);
  if(!pending){
    if(imagePending.size>=256)return Promise.resolve(Response.error());
    pending=loadPublicImage(request);
    imagePending.set(id,pending);
    const clear=()=>{if(imagePending.get(id)===pending)imagePending.delete(id);};
    pending.then(clear,clear);
  }
  return pending.then(response=>response.clone());
}
`;
}
