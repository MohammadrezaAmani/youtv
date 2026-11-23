import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';

// Keep fake disk state across module reloads so the tests exercise a real
// browser reload scenario (fresh JS module, persistent IndexedDB snapshot).
const disk=vi.hoisted(()=>new Map<string,{text:string;storedAt:number;nextCheckAt:number}>());
vi.mock('@/lib/indexedDbStorage',()=>({
  readStaticCacheRecord:vi.fn(async(key:string)=>disk.get(key)??null),
  writeStaticCacheRecord:vi.fn(async(key:string,value:{text:string;storedAt:number;nextCheckAt:number})=>{
    disk.set(key,value);
  })
}));

const SUMMARY='sources/_verified/summary.json' as const;
const DNS='sources/_verified/dns-status.json' as const;
const body=(digest:string)=>JSON.stringify({digest});
const response=(content:string,status=200)=>({ok:status===200,status,text:async()=>content});

beforeEach(()=>{
  disk.clear();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T00:00:00Z'));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('persistent static catalog caching',()=>{
  it('reads from IndexedDB after a page reload without any network request',async()=>{
    const fetcher=vi.fn(async(_input?:RequestInfo|URL)=>response(body('one')));
    vi.stubGlobal('fetch',fetcher);
    const first=await import('@/lib/catalogCache');
    expect(await first.readCatalogAsset(SUMMARY)).toBe(body('one'));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/sources/_verified/summary.json');
    vi.resetModules();
    const reloaded=await import('@/lib/catalogCache');
    expect(await reloaded.readCatalogAsset(SUMMARY)).toBe(body('one'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns stale data immediately then updates it in the background',async()=>{
    const fetcher=vi.fn(async(_input?:RequestInfo|URL)=>response(body('two')));
    vi.stubGlobal('fetch',fetcher);
    const first=await import('@/lib/catalogCache');
    await first.readCatalogAsset(SUMMARY);
    vi.advanceTimersByTime(first.CATALOG_REFRESH_MS+1);
    fetcher.mockImplementation(async()=>response(body('three')));
    const onUpdated=vi.fn();
    expect(await first.readCatalogAsset(SUMMARY,{onUpdated})).toBe(body('two'));
    // Promise microtasks from IndexedDB writes, fetch and callbacks.
    await vi.waitFor(()=>expect(onUpdated).toHaveBeenCalledWith(body('three')));
    expect(await first.readCatalogAsset(SUMMARY)).toBe(body('three'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps stale DNS data after a failed network refresh and backs off',async()=>{
    const fetcher=vi.fn(async(_input?:RequestInfo|URL)=>response('{"generatedAt":"2026-11-24","nxdomain":[],"noAddress":[]}'));
    vi.stubGlobal('fetch',fetcher);
    const cache=await import('@/lib/catalogCache');
    const old=await cache.readCatalogAsset(DNS);
    vi.advanceTimersByTime(cache.CATALOG_REFRESH_MS+1);
    fetcher.mockRejectedValue(new Error('offline'));
    expect(await cache.readCatalogAsset(DNS)).toBe(old);
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
    expect(await cache.readCatalogAsset(DNS)).toBe(old);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('manual refresh bypasses a fresh snapshot',async()=>{
    const fetcher=vi.fn(async(_input?:RequestInfo|URL)=>response(body('old')));
    vi.stubGlobal('fetch',fetcher);
    const cache=await import('@/lib/catalogCache');
    await cache.readCatalogAsset(SUMMARY);
    fetcher.mockImplementation(async()=>response(body('new')));
    expect(await cache.readCatalogAsset(SUMMARY,{force:true})).toBe(body('new'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid JSON rather than caching it',async()=>{
    const fetcher=vi.fn(async(_input?:RequestInfo|URL)=>response('<html>upstream error</html>'));
    vi.stubGlobal('fetch',fetcher);
    const cache=await import('@/lib/catalogCache');
    await expect(cache.readCatalogAsset(SUMMARY)).rejects.toThrow();
    expect(disk.size).toBe(0);
  });
});
