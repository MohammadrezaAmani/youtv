// @vitest-environment node
import Hls, { type HlsConfig, type LoaderConfiguration, type LoaderContext, type LoaderCallbacks } from 'hls.js';
import { afterEach, expect, test, vi } from 'vitest';
import { builtinWorker } from '@youtv/shared';
import { HlsFragmentPrefetcher, hlsFragmentCacheKey } from '../features/player/hlsPrefetch';
import { hlsRelayLoader } from '../features/player/hlsRelayLoader';
import { hlsRequestRoute } from '../features/player/hlsRelayRoutes';
import type { StartupResponse, StartupTransfer } from '../features/player/hlsAutoRoute';

const basePrototype = Hls.DefaultConfig.loader.prototype as InstanceType<typeof Hls.DefaultConfig.loader>;
const frag = {url:'https://example.org/1.ts',sn:1,start:6,duration:6,type:'main',level:0,cc:0};
const config: LoaderConfiguration = {loadPolicy:{maxTimeToFirstByteMs:300000,maxLoadTimeMs:300000,timeoutRetry:null,errorRetry:null}, timeout:300000,maxRetry:0,retryDelay:0,maxRetryDelay:0};
const context = {url:frag.url,type:'media-fragment',responseType:'arraybuffer',frag,rangeStart:0,rangeEnd:0} as LoaderContext;
vi.stubGlobal('self', globalThis);
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

test('distinct authorization parameters never share fragment bytes',()=>{
 expect(hlsFragmentCacheKey(frag.url+'?token=A',0,0,frag)).not.toBe(hlsFragmentCacheKey(frag.url+'?token=B',0,0,frag));
});

test('cache claims expose context and settle exactly once even if aborted by progress callback',async()=>{
 const worker={...builtinWorker,baseUrl:'https://example.org'};
 const p = new HlsFragmentPrefetcher(u=>hlsRequestRoute(u,worker,frag.url),{waitForStartup:false,fetcher:async()=>new Response(new Uint8Array([1,2,3]))});
 p.schedule([frag],0);
 await new Promise(r=>setTimeout(r,5));
 const Loader=hlsRelayLoader(worker,frag.url,p);
 const loader=new Loader({} as HlsConfig);
 const success=vi.fn(),abort=vi.fn();
 const callbacks:LoaderCallbacks<LoaderContext>={onSuccess:success,onError:vi.fn(),onTimeout:vi.fn(),onAbort:abort,onProgress:()=>loader.abort()};
 loader.load(context,config,callbacks);
 expect(loader.context?.url).toContain('/proxy?');
 await new Promise(r=>setTimeout(r,10));
 expect(abort).toHaveBeenCalledTimes(1);expect(success).not.toHaveBeenCalled();
 loader.abort();expect(abort).toHaveBeenCalledTimes(1);
 loader.destroy();p.dispose();
});

test('key loads never claim the media fragment cache',()=>{
 const p=new HlsFragmentPrefetcher(u=>u);
 const claim=vi.spyOn(p,'claim');
 const load=vi.spyOn(basePrototype,'load').mockImplementation(()=>{});
 const Loader=hlsRelayLoader(builtinWorker,frag.url,p);
 const loader=new Loader({} as HlsConfig);
 loader.load({...context,type:'key'} as LoaderContext,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:vi.fn()});
 expect(claim).not.toHaveBeenCalled();expect(load).toHaveBeenCalledTimes(1);
 loader.destroy();p.dispose();
});

test('failed prefetch returns to the installed loader with clean stats',async()=>{
 const p=new HlsFragmentPrefetcher(u=>u);
 vi.spyOn(p,'loadRequired').mockResolvedValue(null);
 const load=vi.spyOn(basePrototype,'load').mockImplementation(()=>{});
 const Loader=hlsRelayLoader(builtinWorker,frag.url,p);
 const loader=new Loader({} as HlsConfig);
 loader.load(context,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:vi.fn()});
 await Promise.resolve();
 expect(load).toHaveBeenCalledTimes(1);
 expect(loader.stats.loading.start).toBe(0);expect(loader.stats.loaded).toBe(0);
 expect(load.mock.calls[0]![0].url).toContain('/proxy?');
 loader.destroy();p.dispose();
});

test('inactivity times out once, while genuine progress keeps a slow request alive',async()=>{
 vi.useFakeTimers({toFake:['performance','setInterval','clearInterval','setTimeout','clearTimeout']});
 let wrapped!:LoaderCallbacks<LoaderContext>;
 vi.spyOn(basePrototype,'load').mockImplementation((_c,_config,callbacks)=>{wrapped=callbacks;});
 const abortBase=vi.spyOn(basePrototype,'abort').mockImplementation(()=>wrapped.onAbort?.(loader.stats,context,null));
 const Loader=hlsRelayLoader(undefined,frag.url);
 const loader=new Loader({} as HlsConfig);
 const timeout=vi.fn(),abort=vi.fn();
 loader.load(context,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:timeout,onAbort:abort});
 await vi.advanceTimersByTimeAsync(29000);
 loader.stats.loaded=123;
 await vi.advanceTimersByTimeAsync(29000);
 expect(timeout).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(2000);
 expect(timeout).toHaveBeenCalledTimes(1);expect(abort).not.toHaveBeenCalled();
 expect(abortBase).toHaveBeenCalledTimes(1);
 loader.abort();await vi.advanceTimersByTimeAsync(300000);
 expect(timeout).toHaveBeenCalledTimes(1);
 loader.destroy();
});

test('a pending playlist refresh must not block the first required fragment', async()=>{
 const calls:string[]=[];
 const p=new HlsFragmentPrefetcher(u=>u,{fetcher:async url=>{calls.push(String(url));return new Response(new Uint8Array([1,2,3]));}});
 vi.spyOn(basePrototype,'load').mockImplementation(()=>{});
 const Loader=hlsRelayLoader(undefined,frag.url,p);
 const playlistLoader=new Loader({} as HlsConfig),fragmentLoader=new Loader({} as HlsConfig);
 playlistLoader.load({...context,type:'level',responseType:'text',url:'https://example.org/live.m3u8'} as LoaderContext,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:vi.fn()});
 fragmentLoader.load(context,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:vi.fn()});
 expect(calls).toEqual([frag.url]);
 playlistLoader.destroy();fragmentLoader.destroy();p.dispose();
});

test('unknown streaming response length stays unknown until completion',async()=>{
 let stream!:ReadableStreamDefaultController<Uint8Array>;
 const p=new HlsFragmentPrefetcher(u=>u,{fetcher:async()=>new Response(new ReadableStream<Uint8Array>({start(c){stream=c;}}))});
 const Loader=hlsRelayLoader(undefined,frag.url,p);
 const loader=new Loader({} as HlsConfig);
 loader.load(context,config,{onSuccess:vi.fn(),onError:vi.fn(),onTimeout:vi.fn()});
 stream.enqueue(new Uint8Array([1,2,3]));
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(loader.stats.loaded).toBe(3);expect(loader.stats.total).toBe(0);
 loader.abort();stream.close();loader.destroy();p.dispose();
});

test('route selection hands a pending fragment directly to the real HLS loader',async()=>{
 let finish!:(value:StartupResponse)=>void;
 const warm:StartupTransfer={completion:new Promise(resolve=>{finish=resolve;}),start:performance.now(),first:performance.now(),loaded:2,total:0,lastProgress:performance.now(),abort:vi.fn()};
 const startup=new Map([[frag.url,warm]]);
 const network=vi.spyOn(basePrototype,'load').mockImplementation(()=>{});
 const Loader=hlsRelayLoader(undefined,frag.url,undefined,startup),loader=new Loader({} as HlsConfig);
 const success=vi.fn();
 loader.load(context,config,{onSuccess:success,onError:vi.fn(),onTimeout:vi.fn()});
 expect(loader.stats.loaded).toBe(2);expect(startup.size).toBe(0);
 finish({url:frag.url,data:new Blob([new Uint8Array([71,1,2,3])]),elapsedMs:40,firstByteMs:10});
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(success).toHaveBeenCalledTimes(1);
 expect(success.mock.calls[0]![0].data).toEqual(new Uint8Array([71,1,2,3]).buffer);
 expect(network).not.toHaveBeenCalled();
 loader.destroy();
});

test('destroying a loader cancels its pending startup transfer without delivering bytes',async()=>{
 let finish!:(value:StartupResponse)=>void;
 const abort=vi.fn(),success=vi.fn();
 const warm:StartupTransfer={completion:new Promise(resolve=>{finish=resolve;}),start:performance.now(),first:0,loaded:0,total:0,lastProgress:performance.now(),abort};
 const Loader=hlsRelayLoader(undefined,frag.url,undefined,new Map([[frag.url,warm]])),loader=new Loader({} as HlsConfig);
 loader.load(context,config,{onSuccess:success,onError:vi.fn(),onTimeout:vi.fn()});
 loader.destroy();
 finish({url:frag.url,data:new Blob([new Uint8Array([71])]),elapsedMs:10,firstByteMs:5});
 await Promise.resolve();
 expect(abort).toHaveBeenCalledTimes(1);expect(success).not.toHaveBeenCalled();
});
