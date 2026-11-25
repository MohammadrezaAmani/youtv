/** Generated Service Worker code. Only public image subresources are admitted.
 * The original response is stored (no opaque/error responses or token URLs).
 * Metadata is separate so the original CORS response and headers are preserved.
 */
export function imageCacheRuntime(prefix: string): string {
  return `
const IMAGE_CACHE=${JSON.stringify(prefix + "images-v1")};
const IMAGE_META=${JSON.stringify(prefix + "image-meta-v1")};
const IMAGE_MAX_ENTRIES=512;
const IMAGE_MAX_BYTES=512*1024;
const IMAGE_MAX_AGE=24*60*60*1000;
const imagePending=new Map();
let imageWrites=Promise.resolve();
function publicImageRequest(request,url){
  if(request.destination!=='image'||request.headers.has('range')||request.headers.has('authorization'))return false;
  if(!/^https?:$/.test(url.protocol)||url.username||url.password)return false;
  // Cross-origin no-CORS direct images keep their normal HTTP cache; do not
  // make a failed CORS probe on every render. Relay images are CORS-readable.
  if(!url.search)return url.origin===self.location.origin||request.mode==='cors';
  // Exact relay URL only; never persist keys, signed URLs or playback hints.
  if(!/\\/proxy$/.test(url.pathname)||[...url.searchParams.keys()].some(key=>key!=='url'))return false;
  try {
    const source=new URL(url.searchParams.get('url'));
    return /^https?:$/.test(source.protocol)&&!source.username&&!source.password&&!source.search;
  }catch{return false;}
}
function imageExpiry(response){
  if(response.status!==200||response.type==='opaque'||!/^image\\/[a-z0-9.+-]+(?:\\s*;|$)/i.test(response.headers.get('content-type')||''))return 0;
  const policy=response.headers.get('cache-control')||'';
  if(/\\b(?:no-store|no-cache|private)\\b/i.test(policy)||/no-cache/i.test(response.headers.get('pragma')||'')||/\\b(?:cookie|authorization)\\b|\\*/i.test(response.headers.get('vary')||''))return 0;
  const match=/(?:^|,)\\s*max-age\\s*=\\s*"?(\\d+)"?/i.exec(policy);
  // Do not invent freshness for third-party responses.
  if(!match)return 0;
  const age=Number(response.headers.get('age')||0);
  if(!Number.isFinite(age))return 0;
  const ttl=Math.min(IMAGE_MAX_AGE,Math.max(0,(Number(match[1])-age)*1000));
  return ttl>0?Date.now()+ttl:0;
}
async function smallImage(response){
  const length=response.headers.get('content-length');
  if(length!==null&&Number(length)>IMAGE_MAX_BYTES)return false;
  const reader=response.clone().body?.getReader();
  if(!reader)return false;
  let bytes=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)return bytes>0;
      bytes+=next.value.byteLength;
      if(bytes>IMAGE_MAX_BYTES){void reader.cancel().catch(()=>{});return false;}
    }
  }catch{return false;}
  finally{reader.releaseLock();}
}
async function saveImage(cache,meta,key,response,expires){
  // Serialise eviction so simultaneous logo loads cannot exceed the entry cap.
  const write=imageWrites.catch(()=>{}).then(async()=>{
    await cache.put(key,response);
    try{await meta.put(key,new Response(String(expires),{headers:{Vary:'Accept'}}));}
    catch(error){await cache.delete(key);throw error;}
    const keys=await cache.keys();
    for(const old of keys.slice(0,Math.max(0,keys.length-IMAGE_MAX_ENTRIES))){
      await cache.delete(old);await meta.delete(old);
    }
  });
  imageWrites=write;
  await write;
}
async function loadPublicImage(request){
  // An anonymous CORS request is necessary to validate status and image MIME.
  // If an origin disallows CORS, use its normal browser image request instead.
  const key=new Request(request.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:request.headers.get('accept')||'image/*'}});
  let cache,meta;
  try{
    cache=await caches.open(IMAGE_CACHE);meta=await caches.open(IMAGE_META);
    const [cached,stamp]=await Promise.all([cache.match(key),meta.match(key)]);
    if(cached&&stamp&&Number(await stamp.text())>Date.now())return cached;
    if(cached||stamp){await cache.delete(key);await meta.delete(key);}
  }catch{/* storage disabled, quota exhausted, or private browsing */}
  let response;
  try{response=await fetch(key,{cache:'no-store'});}
  catch{return fetch(request);}
  // Keep normal browser behaviour if the anonymous request was rejected.
  if(!response.ok||!/^image\\//i.test(response.headers.get('content-type')||''))return fetch(request);
  const expires=imageExpiry(response);
  if(cache&&meta&&expires){
    try{if(await smallImage(response))await saveImage(cache,meta,key,response.clone(),expires);}
    catch{/* a cache failure must never break the image */}
  }
  return response;
}
function cachedPublicImage(request){
  // Keep Accept variants separate and never discard query parameters.
  const id=JSON.stringify([request.url,request.headers.get('accept')||'image/*',request.mode,request.credentials,request.referrer]);
  let pending=imagePending.get(id);
  if(!pending){
    pending=loadPublicImage(request);
    imagePending.set(id,pending);
    const clear=()=>{if(imagePending.get(id)===pending)imagePending.delete(id);};
    pending.then(clear,clear);
  }
  return pending.then(response=>response.clone());
}
`;
}
