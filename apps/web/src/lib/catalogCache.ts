import {readStaticCacheRecord,writeStaticCacheRecord,type StaticCacheRecord} from './indexedDbStorage';

/** Only immutable-ish application metadata is cached; never cache streaming media or Worker responses. */
export type CatalogAsset='sources/_verified/summary.json'|'sources/_verified/dns-status.json'|
  'sources/index.json'|'default.m3u8';

const CACHE_NAMESPACE='youtv:static-catalog:v1:';
export const CATALOG_REFRESH_MS=6*60*60*1000;
export const CATALOG_RETRY_MS=15*60*1000;
const memory=new Map<CatalogAsset,StaticCacheRecord>();
const reads=new Map<CatalogAsset,Promise<StaticCacheRecord|null>>();
const downloads=new Map<CatalogAsset,Promise<string>>();
const revalidations=new Map<CatalogAsset,Promise<string>>();

function keyFor(path:CatalogAsset):string{
  // Include BASE_URL so a local / build and a /youtv/ deployment cannot collide.
  return `${CACHE_NAMESPACE}${import.meta.env.BASE_URL}${path}`;
}

async function diskRead(path:CatalogAsset):Promise<StaticCacheRecord|null>{
  const inMemory=memory.get(path);
  if(inMemory)return inMemory;
  const already=reads.get(path);
  if(already)return already;
  const pending=readStaticCacheRecord(keyFor(path)).catch(()=>null).then(record=>{
    if(record)memory.set(path,record);
    return record;
  }).finally(()=>reads.delete(path));
  reads.set(path,pending);
  return pending;
}

async function diskWrite(path:CatalogAsset,record:StaticCacheRecord):Promise<void>{
  memory.set(path,record);
  // A storage failure must never make a functional network response unusable.
  try{await writeStaticCacheRecord(keyFor(path),record);}catch{/* Private mode / full disk: memory-only fallback. */}
}

async function download(path:CatalogAsset):Promise<string>{
  const current=downloads.get(path);
  if(current)return current;
  const pending=(async()=>{
    const response=await fetch(`${import.meta.env.BASE_URL}${path}`,{credentials:'omit',cache:'no-cache'});
    if(!response.ok)throw new Error(`Catalog ${path}: HTTP ${response.status}`);
    const text=await response.text();
    // Do not poison disk cache with an HTML error page or invalid JSON.
    if(!text.trim())throw new Error(`Empty catalog asset: ${path}`);
    if(path.endsWith('.json')){
      const data:unknown=JSON.parse(text);
      if(!data||typeof data!=='object')throw new Error(`Invalid catalog JSON: ${path}`);
      const record=data as Record<string,unknown>;
      if(path.endsWith('/summary.json') && (typeof record.digest!=='string'||!record.digest))
        throw new Error('Invalid verified catalog digest');
      if(path.endsWith('/dns-status.json') && (!Array.isArray(record.nxdomain)||!Array.isArray(record.noAddress)))
        throw new Error('Invalid DNS status report');
      if(path.endsWith('/index.json') && !Array.isArray(record.sources))
        throw new Error('Invalid sources index');
    }
    const now=Date.now();
    await diskWrite(path,{text,storedAt:now,nextCheckAt:now+CATALOG_REFRESH_MS});
    return text;
  })().finally(()=>downloads.delete(path));
  downloads.set(path,pending);
  return pending;
}

/**
 * Read from disk first. Fresh snapshots generate ZERO network requests across
 * browser reloads. Stale snapshots return instantly while one background
 * revalidation checks for a changed deployment. Only explicit Refresh blocks
 * on the network. Failed background attempts back off for 15 minutes.
 */
export async function readCatalogAsset(path:CatalogAsset,options:{
  force?:boolean;
  onUpdated?:(text:string)=>void;
}={}):Promise<string>{
  const cached=await diskRead(path);
  if(options.force)return download(path);
  if(cached){
    if(Date.now()>=cached.nextCheckAt){
      // Back off before starting the request so a reload during failure doesn't
      // repeatedly hit GitHub Pages. Do not reset storedAt for stale data.
      const delayed={...cached,nextCheckAt:Date.now()+CATALOG_RETRY_MS};
      let revalidating=revalidations.get(path);
      if(!revalidating){
        revalidating=(async()=>{
          await diskWrite(path,delayed);
          return download(path);
        })().finally(()=>revalidations.delete(path));
        revalidations.set(path,revalidating);
      }
      void revalidating.then(fresh=>{
        if(fresh!==cached.text)options.onUpdated?.(fresh);
      }).catch(()=>{/* Offline: keep the verified last-good snapshot. */});
    }
    return cached.text;
  }
  return download(path);
}
