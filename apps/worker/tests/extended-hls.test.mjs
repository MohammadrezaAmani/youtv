import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import {rewriteHls, parseHlsVariables} from '../src/hls.ts';

const upstream = new URL('https://media.example.com/live/master.m3u8?sig=abc');
const endpoint = new URL('https://youtv.workers.dev/proxy');
const env = {ALLOWED_HOSTS:'*', ALLOWED_ORIGINS:'https://mohammadrezaamani.github.io', PROXY_TOKEN:''};
const req = (url, extra = {}) => new Request(url, {headers:{Origin:'https://mohammadrezaamani.github.io'}, ...extra});
const extract = (line) => new URL(line);

test('multivariant playlist with malformed Telewebion version stays standards-compliant', () => {
  const playlist = '#EXTM3U\nEXT-X-VERSION:6\n#EXT-X-STREAM-INF:BANDWIDTH=2756600,RESOLUTION=1920x1080\n1080p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=655600,RESOLUTION=426x240\n240p/index.m3u8';
  const rewritten = rewriteHls(playlist, upstream, endpoint, '');
  assert.match(rewritten, /#EXT-X-VERSION:6/);
  assert.doesNotMatch(rewritten, /ext-x-version%3A/i);
  for(const quality of ['1080p','240p']) {
    const line = rewritten.split('\n').find(line=>line.startsWith('https://') && line.includes(quality));
    assert.equal(extract(line).searchParams.get('url'),`https://media.example.com/live/${quality}/index.m3u8`);
    assert.equal(extract(line).searchParams.get('hls'),'1');
  }
});

test('rewrites master, audio, caption playlist, I-frame, image and Content Steering URIs', () => {
 const playlist = [
 '#EXTM3U',
 '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key.bin"',
 '#EXT-X-SESSION-DATA:DATA-ID="title",URI="data:text/plain,Hello"',
 '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/live.m3u8"',
 '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub",NAME="English",URI="captions/en.vtt"',
 '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframe.m3u8"',
 '#EXT-X-IMAGE-STREAM-INF:BANDWIDTH=1200,URI="images.m3u8"',
 '#EXT-X-CONTENT-STEERING:SERVER-URI="steering.json",PATHWAY-ID="p0"',
 '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"','live/720p.m3u8'
 ].join('\n');
 const result = rewriteHls(playlist,upstream,endpoint,'');
 assert.match(result, /URI="data:text\/plain,Hello"/);
 assert.match(result, /#EXT-X-CONTENT-STEERING:SERVER-URI="https:\/\/youtv\.workers\.dev\/proxy\?/);
 for (const value of ['key.bin','live/720p.m3u8','audio/live.m3u8','captions/en.vtt','iframe.m3u8','images.m3u8','steering.json']) {
  assert.ok(decodeURIComponent(result).includes(value),`missing ${value}`);
 }
 const steering = result.match(/SERVER-URI="([^"]+)"/)?.[1];
 assert.equal(extract(steering).searchParams.get('url'),'https://media.example.com/live/steering.json');
});

test('handles EXT-X-DEFINE NAME/VALUE, QUERYPARAM, IMPORT, and bounded propagation', () => {
 const parent = '#EXTM3U\n#EXT-X-DEFINE:NAME="folder",VALUE="part"\n#EXT-X-DEFINE:QUERYPARAM="sig"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n{$folder}/chunk.m3u8?sig={$sig}';
 const output = rewriteHls(parent, upstream, endpoint, '');
 assert.match(output, /#EXT-X-DEFINE:NAME="sig",VALUE="abc"/);
 const uri = output.split('\n').at(-1);
 const proxyLink = new URL(uri);
 assert.equal(proxyLink.searchParams.get('url'),'https://media.example.com/live/part/chunk.m3u8?sig=abc');
 const inherited = parseHlsVariables(proxyLink.searchParams.get('vars'));
 assert.deepEqual({...inherited},{folder:'part',sig:'abc'});
 const child = '#EXTM3U\n#EXT-X-DEFINE:IMPORT="folder"\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\n{$folder}/segment.ts';
 const inner = rewriteHls(child,new URL(proxyLink.searchParams.get('url')),endpoint,'',{},inherited);
 assert.equal(new URL(inner.split('\n').at(-1)).searchParams.get('url'),'https://media.example.com/live/part/part/segment.ts');
});

test('handles LL-HLS parts, hints, reports, key, map, daterange and prefetch segments', () => {
 const playlist = [
 '#EXTM3U','#EXT-X-MEDIA-SEQUENCE:42','#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,CAN-SKIP-UNTIL=15',
 '#EXT-X-KEY:METHOD=AES-128,URI="keys/main"',
 '#EXT-X-MAP:URI="init.mp4"',
 '#EXT-X-DATERANGE:ID="ad",X-ASSET-URI="ad.m3u8",X-ASSET-LIST="assets.json"',
 '#EXT-X-PART:DURATION=0.3,URI="seg.part",INDEPENDENT=YES',
 '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="upcoming.part",BYTERANGE-START=20',
 '#EXT-X-RENDITION-REPORT:URI="other.m3u8",LAST-MSN=45',
 '#EXT-X-PREFETCH:soon.ts',
 '#EXTINF:6,','seg.ts',
 '#EXT-X-ENDLIST'
 ].join('\n');
 const result=rewriteHls(playlist,upstream,endpoint,'');
 assert.match(result,/CAN-BLOCK-RELOAD=YES/);
 assert.match(result,/#EXT-X-PREFETCH:https:\/\/youtv\.workers\.dev\/proxy\?/);
 for(const resource of ['keys/main','init.mp4','ad.m3u8','assets.json','seg.part','upcoming.part','other.m3u8','soon.ts','seg.ts'])
  assert.ok(decodeURIComponent(result).includes(resource),resource);
});

test('passes only non-network DRM identifiers and inline data on recognized tags',()=>{
 const source = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset"\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="urn:uuid:abcd"\n#EXT-X-SESSION-DATA:DATA-ID="x",URI="data:text/plain,abc"\n#EXTINF:1,\nseg.ts';
 const result = rewriteHls(source,upstream,endpoint,'');
 assert.match(result,/skd:\/\/asset/);assert.match(result,/urn:uuid:abcd/);assert.match(result,/data:text\/plain,abc/);
 for(const protocol of ['javascript:alert(1)','file:///etc/passwd','ftp://evil.com/data']){
  assert.throws(()=>rewriteHls(`#EXTM3U\n#EXTINF:1,\n${protocol}`,upstream,endpoint,''),/Unsupported HLS URI scheme/);
 }
});

test('forwarding LL-HLS delivery directives retains existing query and rejects bad inputs',async t=>{
 const original = globalThis.fetch;
 const seen=[];
 globalThis.fetch=async (url)=>{
  seen.push(new URL(url));
  return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nx.ts',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 };
 t.after(()=>{globalThis.fetch=original;});
 const p=new URL(endpoint);p.searchParams.set('url',upstream.href);p.searchParams.set('hls','1');
 p.searchParams.set('_HLS_msn','42');p.searchParams.set('_HLS_part','1');p.searchParams.set('_HLS_skip','v2');
 const response = await worker.fetch(req(p),env);
 assert.equal(response.status,200);
 assert.equal(seen[0].searchParams.get('sig'),'abc');
 assert.equal(seen[0].searchParams.get('_HLS_msn'),'42');
 assert.equal(seen[0].searchParams.get('_HLS_part'),'1');
 assert.equal(seen[0].searchParams.get('_HLS_skip'),'v2');
 const bad=new URL(p);bad.searchParams.set('_HLS_msn','bad');
 const reject=await worker.fetch(req(bad),env);
 assert.equal(reject.status,400);
 assert.equal((await reject.json()).code,'invalid_hls_directive');
});

test('nested playlist import works through actual HTTP Worker endpoint',async t=>{
 const original=globalThis.fetch;
 const requests=[];
 globalThis.fetch=async url=>{
  const real=new URL(url);requests.push(real.href);
  return new Response(real.pathname.endsWith('master.m3u8')
    ? '#EXTM3U\n#EXT-X-DEFINE:NAME="folder",VALUE="sub"\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlevel.m3u8'
    : '#EXTM3U\n#EXT-X-DEFINE:IMPORT="folder"\n#EXTINF:6,\n{$folder}/part.ts',
    {headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 };
 t.after(()=>{globalThis.fetch=original;});
 const root=new URL(endpoint);root.searchParams.set('url',upstream.href);root.searchParams.set('hls','1');
 const r1=await worker.fetch(req(root),env);
 assert.equal(r1.status,200);
 const nested=(await r1.text()).split('\n').at(-1);
 const r2=await worker.fetch(req(nested),env);
 assert.equal(r2.status,200);
 const segment = (await r2.text()).split('\n').at(-1);
 assert.equal(new URL(segment).searchParams.get('url'),'https://media.example.com/live/sub/part.ts');
 assert.equal(requests.length,2);
});

test('Content Steering keeps all pathway clones on the Worker origin while changing upstream CDN', async t=>{
  const original=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async url=>{
    seen.push(new URL(url));
    return new Response(JSON.stringify({
      VERSION:1, TTL:30,
      'PATHWAY-PRIORITY':['backup','base'],
      'PATHWAY-CLONES':[{'BASE-ID':'base',ID:'backup','URI-REPLACEMENT':{HOST:'cdn.example.com','PATH-PREFIX':'/alternate',PARAMS:{session:'42'}}}],
      'RELOAD-URI':'steering-new.json'
    }),{headers:{'Content-Type':'application/vnd.apple.steering-list'}});
  };
  t.after(()=>{globalThis.fetch=original;});
  const route=new URL(endpoint);
  route.searchParams.set('url','https://media.example.com/live/steering.json');
  route.searchParams.set('steer','1');
  const response=await worker.fetch(req(route),env);
  assert.equal(response.status,200);
  const value=await response.json();
  assert.ok(value['RELOAD-URI'].startsWith(endpoint.origin));
  assert.equal(new URL(value['RELOAD-URI']).searchParams.get('url'),'https://media.example.com/live/steering-new.json');
  const replacement=value['PATHWAY-CLONES'][0]['URI-REPLACEMENT'];
  assert.equal(replacement.HOST,undefined);
  assert.equal(replacement['PATH-PREFIX'],undefined);
  const target=new URL(endpoint);
  target.searchParams.set('url','https://media.example.com/live/chunk.ts');
  target.searchParams.set('_youtv_steer',replacement.PARAMS._youtv_steer);
  const media=await worker.fetch(req(target),env);
  assert.equal(media.status,200);
  assert.equal(seen[1].hostname,'cdn.example.com');
  assert.equal(seen[1].pathname,'/alternate/live/chunk.ts');
  assert.equal(seen[1].searchParams.get('session'),'42');
});

test('invalid Content Steering replacement and unsafe CDN host never reach upstream',async t=>{
  const original=globalThis.fetch;
  let called=false;
  globalThis.fetch=async()=>{called=true;return new Response('ok')};
  t.after(()=>{globalThis.fetch=original;});
  const target=new URL(endpoint);target.searchParams.set('url',upstream.href);
  target.searchParams.set('_youtv_steer',JSON.stringify({host:'127.0.0.1'}));
  const denied=await worker.fetch(req(target),env);
  assert.equal(denied.status,403);
  assert.equal(called,false);
  target.searchParams.set('_youtv_steer','{nope');
  const invalid=await worker.fetch(req(target),env);
  assert.equal(invalid.status,400);
  assert.equal(called,false);
});

test('HLS URI rewriting never permits javascript, local file or a malicious variable map',()=>{
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd']) {
    assert.throws(()=>rewriteHls(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${bad}"`,upstream,endpoint,''),/Unsupported HLS URI scheme/);
  }
  assert.throws(()=>parseHlsVariables(JSON.stringify({['a'.repeat(65)]:'x'})), /Invalid/);
});

test('Interstitial asset-list JSON routes every nested video playlist through Worker',async t=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async ()=>new Response(JSON.stringify({ASSETS:[{URI:'preroll.m3u8',DURATION:8},{URI:'https://other.example.com/postroll.m3u8',DURATION:5}]}),{headers:{'Content-Type':'application/json'}});
 t.after(()=>{globalThis.fetch=previous;});
 const rewritten=rewriteHls('#EXTM3U\n#EXT-X-DATERANGE:ID="interstitial",X-ASSET-LIST="assets.json"',upstream,endpoint,'');
 const assetLink=rewritten.match(/X-ASSET-LIST="([^"]+)"/)?.[1];
 assert.ok(assetLink);
 assert.equal(new URL(assetLink).searchParams.get('asset'),'1');
 const response=await worker.fetch(req(assetLink),env);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.ASSETS.length,2);
 assert.equal(new URL(result.ASSETS[0].URI).searchParams.get('url'),'https://media.example.com/live/preroll.m3u8');
 assert.equal(new URL(result.ASSETS[1].URI).searchParams.get('url'),'https://other.example.com/postroll.m3u8');
 assert.ok(result.ASSETS.every(v=>new URL(v.URI).origin==='https://youtv.workers.dev'));
});
