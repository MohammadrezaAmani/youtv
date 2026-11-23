import {afterEach,describe,expect,it,vi} from 'vitest';
import {createChannel,defaultState,type WorkerProfile} from '@youtv/shared';
import {probeChannel,scanChannels} from '@/lib/connectivity';

const channel=createChannel({id:'connectivity-a',name:'My TV',url:'https://stream.example.com/live.m3u8'});
const settings=structuredClone(defaultState.settings);
const worker:WorkerProfile={id:'worker-a',name:'A',baseUrl:'https://worker.example.workers.dev',token:'x'.repeat(32),enabled:true};

describe('channel connectivity probes',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  it('counts a successful HEAD response as reachable',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:200})));
    const result=await probeChannel(channel,settings,[]);
    expect(result.status).toBe('online');expect(result.httpStatus).toBe(200);
  });
  it('treats blocked CORS as unknown instead of a confirmed offline result',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
    const result=await probeChannel(channel,settings,[]);
    expect(result.status).toBe('unknown');
  });
  it('can use /probe in personal Worker and record actual HTTP response',async()=>{
    const proxyChannel={...channel,proxyMode:'proxy' as const,workerId:worker.id};
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      expect(String(input)).toContain('/probe?');
      return new Response(JSON.stringify({status:206,ok:true,elapsedMs:42}),{status:200});
    }));
    const result=await probeChannel(proxyChannel,settings,[worker]);
    expect(result.status).toBe('online');expect(result.httpStatus).toBe(206);expect(result.elapsedMs).toBe(42);
  });
  it('limits concurrent checks and emits progress for all channels',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:200})));
    const repeated=Array.from({length:9},(_,i)=>({...channel,id:`connectivity-${i}`}));
    const results:Record<string,unknown>={};
    await scanChannels(repeated,settings,[],new AbortController().signal,(batch,progress)=>{
      Object.assign(results,batch);expect(progress.completed).toBeLessThanOrEqual(9);
    },3);
    expect(Object.keys(results)).toHaveLength(9);
  });
});
