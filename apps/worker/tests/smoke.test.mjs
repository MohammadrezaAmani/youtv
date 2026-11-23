/** Zero-dependency functional smoke tests (Bun native test runner). */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import {rewriteHls} from '../src/hls.ts';
import {assertAllowedUrl} from '../src/security.ts';
const key='0123456789abcdefghijklmnopqrstuvwxyz';
const env={ALLOWED_HOSTS:'media.example.com,*.cdn.example.com',ALLOWED_ORIGINS:'https://mohammadrezaamani.github.io,http://localhost:5173',PROXY_TOKEN:key,UPSTREAM_REFERER:''};
const endpoint='https://youtv.workers.dev/proxy';
const input='https://media.example.com/tv/index.m3u8?sig=abc';
function req(source=input, origin='https://mohammadrezaamani.github.io'){
  const u=new URL(endpoint);u.searchParams.set('url',source);u.searchParams.set('key',key);
  return new Request(u.toString(),{headers: {Origin:origin}});
}
test('HLS rewrites nested playlists, segments, key and map URIs',()=>{
  const manifest='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:URI="../key",METHOD=AES-128\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nsub/720p.m3u8\n#EXTINF:5,\nsegment.ts\n';
  const rewritten=rewriteHls(manifest,new URL(input),new URL(endpoint),key);
  const lines=rewritten.split('\n');
  for(const i of [1,2,4,6])assert.match(lines[i],/youtv\.workers\.dev\/proxy\?/);
  assert.ok(rewritten.includes('init.mp4'));assert.ok(rewritten.includes('720p.m3u8'));
});
test('SSRF guard requires allowlist and rejects IP literals',()=>{
  assert.equal(assertAllowedUrl(input,env).hostname,'media.example.com');
  for(const url of ['http://127.0.0.1/','https://evil.com/','http://[::1]/'])assert.throws(()=>assertAllowedUrl(url,env));
});
test('worker manifest response honors CORS and rewrite',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async (_url,_opts)=>new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  t.after(()=>{globalThis.fetch=old;});
  const result=await worker.fetch(req(),env);
  assert.equal(result.status,200);assert.equal(result.headers.get('Access-Control-Allow-Origin'),'https://mohammadrezaamani.github.io');
  const s=await result.text();assert.ok(s.includes('seg0.ts'));assert.ok(s.includes('youtv.workers.dev/proxy?'));
});
test('binary data and HTTP 206 are passed through without modification',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async () =>new Response(new Uint8Array([4,1,9]),{status:206,headers:{'Content-Range':'bytes 0-2/100','Content-Type':'video/mp2t'}});
  t.after(()=>{globalThis.fetch=old;});
  const response=await worker.fetch(req('https://media.example.com/a.ts'),env);
  assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-2/100');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[4,1,9]);
});
test('worker rejects bad origin and bad credentials',async()=>{
  const noOrigin=await worker.fetch(req(input,'https://attacker.example'),env);
  assert.equal(noOrigin.status,403);
  const url=new URL(req().url);url.searchParams.set('key','wrong');
  const noAuth=await worker.fetch(new Request(url,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),env);
  assert.equal(noAuth.status,401);
});
test('worker enforces redirect allowlist',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.example/private'}});
  t.after(()=>{globalThis.fetch=old;});
  const result=await worker.fetch(req(),env);
  assert.equal(result.status,403);
});

test('extensionless HLS URLs are rewritable with explicit hls hint',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nchunk-a.ts\n',{headers:{'Content-Type':'application/octet-stream'}});
  t.after(()=>{globalThis.fetch=old;});
  const url=new URL(req('https://media.example.com/stream?id=123').url);
  url.searchParams.set('hls','1');
  const result=await worker.fetch(new Request(url,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),env);
  assert.equal(result.status,200);
  assert.match(await result.text(),/youtv\.workers\.dev\/proxy\?/);
});
test('Teletext/plain-text endpoint uses allowlist, auth and CORS without script execution',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response('TELETEXT PAGE 100\nNEWS',{headers:{'Content-Type':'text/plain'}});
  t.after(()=>{globalThis.fetch=old;});
  const u=new URL('https://youtv.workers.dev/text');u.searchParams.set('url','https://media.example.com/teletext/100.txt');u.searchParams.set('key',key);
  const response=await worker.fetch(new Request(u,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),env);
  assert.equal(response.status,200);assert.equal(await response.text(),'TELETEXT PAGE 100\nNEWS');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://mohammadrezaamani.github.io');
});
test('Teletext plaintext endpoint rejects unapproved destination',async()=>{
  const u=new URL('https://youtv.workers.dev/text');u.searchParams.set('url','https://unapproved.example/101.txt');u.searchParams.set('key',key);
  const response=await worker.fetch(new Request(u,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),env);
  assert.equal(response.status,403);
});

test('playlist import streams responses larger than the former 15 MB limit',async(t)=>{
  const original=globalThis.fetch;
  const body='#EXTM3U\n'+('#EXTINF:-1,TV\nhttps://example.org/live.m3u8\n'.repeat(350_000));
  assert.ok(body.length>15_000_000);
  globalThis.fetch=async()=>new Response(body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(body.length)}});
  t.after(()=>{globalThis.fetch=original;});
  const url=new URL('https://youtv.workers.dev/text');
  url.searchParams.set('url','https://media.example.com/iptv.m3u');
  url.searchParams.set('key',key);
  const response=await worker.fetch(new Request(url,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),env);
  assert.equal(response.status,200);
  assert.equal((await response.text()).length,body.length);
});


test('wildcard worker serves public stream with no configured secret',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response('#EXTM3U\n#EXTINF:4,\nseg.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  t.after(()=>{globalThis.fetch=old;});
  const withoutSecret={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''};
  const url=new URL('https://youtv.workers.dev/proxy');
  url.searchParams.set('url','https://live.presstv.co.uk/hls/ifilmfa.m3u8');
  const response=await worker.fetch(new Request(url,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),withoutSecret);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://mohammadrezaamani.github.io');
  const body=await response.text();
  assert.match(body,/seg.ts/);
  const segment=body.split('\n').find(line=>line.startsWith('https://'));
  assert.ok(segment);assert.equal(new URL(segment).searchParams.has('key'),false);
});

test('wildcard worker denies IP and local host even with no token',async()=>{
  const open={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''};
  for(const target of ['http://127.0.0.1/admin','http://[::1]/','http://metadata.google.internal/']){
    const url=new URL('https://youtv.workers.dev/proxy');url.searchParams.set('url',target);
    const response=await worker.fetch(new Request(url),open);
    assert.equal(response.status,403);assert.equal((await response.json()).code,'blocked_host');
  }
});

test('configured secret requires the correct key, including /probe and /text',async()=>{
  const settings={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:'',PROXY_TOKEN:'a-secret'};
  for(const route of ['proxy','probe','text']){
    const url=new URL('https://youtv.workers.dev/'+route);url.searchParams.set('url',input);
    const without=await worker.fetch(new Request(url),settings);
    assert.equal(without.status,401);assert.equal((await without.json()).code,'unauthorized');
  }
});

test('redirects to private addresses remain blocked when ALLOWED_HOSTS=*',async(t)=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'http://169.254.169.254/latest/meta-data/'}});
  t.after(()=>{globalThis.fetch=old;});
  const url=new URL('https://youtv.workers.dev/proxy');url.searchParams.set('url',input);
  const response=await worker.fetch(new Request(url),{ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''});
  assert.equal(response.status,403);assert.equal((await response.json()).code,'blocked_host');
});

test('capabilities states whether worker access is passwordless or token-protected',async()=>{
  const url='https://youtv.workers.dev/capabilities';
  const open=await worker.fetch(new Request(url),{ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''});
  assert.equal((await open.json()).authentication,'none');
  const secured=await worker.fetch(new Request(url),{ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:'',PROXY_TOKEN:key});
  assert.equal((await secured.json()).authentication,'query-token');
});

test('passwordless /probe, /text and CORS preflight work with localhost defaults',async(t)=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>options?.method==='HEAD'
    ? new Response(null,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}})
    : new Response('#EXTM3U\n#EXTINF:-1,Channel\nhttps://live.presstv.co.uk/hls/ifilmfa.m3u8\n');
  t.after(()=>{globalThis.fetch=previous;});
  const open={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''};
  const origin='http://localhost:32001';
  const path=(route)=>{const url=new URL('https://youtv.workers.dev/'+route);url.searchParams.set('url',input);return url;};
  const options=await worker.fetch(new Request(path('proxy'),{method:'OPTIONS',headers:{Origin:origin}}),open);
  assert.equal(options.status,204);assert.equal(options.headers.get('Access-Control-Allow-Origin'),origin);
  const probe=await worker.fetch(new Request(path('probe'),{headers:{Origin:origin}}),open);
  assert.equal(probe.status,200);assert.equal((await probe.json()).status,200);
  const textResponse=await worker.fetch(new Request(path('text'),{headers:{Origin:origin}}),open);
  assert.equal(textResponse.status,200);assert.match(await textResponse.text(),/#EXTM3U/);
  assert.equal(textResponse.headers.get('Access-Control-Allow-Origin'),origin);
  const health=await worker.fetch(new Request('https://youtv.workers.dev/health'),open);
  assert.equal((await health.json()).version,'0.25.0');
});
