import {afterEach, expect, test, vi} from 'vitest';
import worker from '../src/index';
const source='https://4kuhls.persiana.live/hls/stream.m3u8';
const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:555921\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nstream-555921.ts\n';
const request=()=>new Request('https://relay.example/proxy?url='+encodeURIComponent(source)+'&hls=1',{headers:{Origin:'http://localhost:5173',Range:'bytes=0-','If-Range':'"old-playlist"'}});
afterEach(()=>vi.unstubAllGlobals());

test('native HLS Range requests receive a whole rewritten playlist instead of relative Worker-root URLs',async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{
   const ranged=new Headers(init?.headers).has('Range');
   return new Response(text,{status:ranged?206:200,headers:{'Content-Type':'application/vnd.apple.mpegurl',...(ranged?{'Content-Range':`bytes 0-${text.length-1}/${text.length}`}:{})}});
 });
 vi.stubGlobal('fetch',fetcher);
 const response=await worker.fetch(request(),{});
 expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('range')).toBe(false);
 expect(new Headers(fetcher.mock.calls[0]![1]?.headers).has('if-range')).toBe(false);
 expect(response.status).toBe(200);expect(response.headers.has('content-range')).toBe(false);
 const body=await response.text();
 const uri=body.split('\n').find(line=>line.startsWith('https://'))!;
 expect(new URL(uri).pathname).toBe('/proxy');
 expect(new URL(uri).searchParams.get('url')).toBe('https://4kuhls.persiana.live/hls/stream-555921.ts');
 expect(response.headers.get('cache-control')).toBe('no-store');
});

test('a complete unsolicited 206 playlist is rewritten; incomplete manifests fail closed',async()=>{
 for(const complete of [true,false]){
   vi.stubGlobal('fetch',vi.fn(async()=>new Response(text,{status:206,headers:{'Content-Type':'application/vnd.apple.mpegurl','Content-Range':`bytes 0-${text.length-1}/${complete?text.length:text.length+100}`}})));
   const response=await worker.fetch(request(),{});
   expect(response.status).toBe(complete?200:502);
   const body=await response.text();
   if(complete)expect(body).toContain('/proxy?url=');
   else expect(body).toContain('partial_manifest');
 }
});
