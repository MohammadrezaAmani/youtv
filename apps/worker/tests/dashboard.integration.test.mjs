import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dashboard-worker.mjs';
const origin='https://example.github.io';
const secret='p'.repeat(32),admin='a'.repeat(40),cloudflare='c'.repeat(42);
const env={ALLOWED_HOSTS:'stream.example.com',ALLOWED_ORIGINS:origin,PROXY_TOKEN:secret,ADMIN_TOKEN:admin,UPSTREAM_REFERER:''};
function request(path,init={}){return new Request('https://youtv.workers.dev'+path,{...init,headers:{Origin:origin,...init.headers}});}
function withFetch(handler,fn){const original=globalThis.fetch;globalThis.fetch=handler;return Promise.resolve().then(fn).finally(()=>{globalThis.fetch=original;});}
test('worker health and CORS preflight for Cloudflare admin',async()=>{
  const response=await worker.fetch(request('/health'),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
  const preflight=await worker.fetch(request('/admin/cloudflare',{method:'OPTIONS',headers:{'Access-Control-Request-Headers':'authorization,x-youtv-admin-token'}}),env);
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers')||'',/Authorization/);
});
test('probe requires token and allowlisted upstream',async()=>{
  const noToken=await worker.fetch(request('/probe?url=https%3A%2F%2Fstream.example.com%2Flive.m3u8'),env);
  assert.equal(noToken.status,401);
  const blocked=await worker.fetch(request(`/probe?url=${encodeURIComponent('https://evil.example.com/live.m3u8')}&key=${secret}`),env);
  assert.equal(blocked.status,403);
});
test('probe checks upstream without downloading video body',async()=>{
  let sawHead=false;
  await withFetch(async(req,init)=>{
    sawHead=init.method==='HEAD';assert.equal(req,'https://stream.example.com/channel.m3u8');
    return new Response(null,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  },async()=>{
    const response=await worker.fetch(request(`/probe?url=${encodeURIComponent('https://stream.example.com/channel.m3u8')}&key=${secret}`),env);
    assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,200);assert.equal(data.ok,true);assert.ok(sawHead);
  });
});
test('probe retries HEAD 405 with byte-range GET',async()=>{
  let count=0;
  await withFetch(async(_req,init)=>{count++;
    if(count===1){assert.equal(init.method,'HEAD');return new Response(null,{status:405});}
    assert.equal(init.method,'GET');assert.equal(init.headers.get('Range'),'bytes=0-0');
    return new Response(new Uint8Array([1]),{status:206,headers:{'Content-Range':'bytes 0-0/1000'}});
  },async()=>{
    const response=await worker.fetch(request(`/probe?url=${encodeURIComponent('https://stream.example.com/channel.ts')}&key=${secret}`),env);
    const data=await response.json();assert.equal(data.status,206);assert.equal(count,2);
  });
});
test('Cloudflare admin fails closed with bad admin token and wildcard origins',async()=>{
  const invalid=request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':'bad','Content-Type':'application/json'},body:JSON.stringify({operation:'verify'})});
  assert.equal((await worker.fetch(invalid,env)).status,401);
  const allowed={...env,ALLOWED_ORIGINS:'*'};
  const wildcard=request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},body:JSON.stringify({operation:'verify'})});
  assert.equal((await worker.fetch(wildcard,allowed)).status,403);
});
test('default GitHub Pages origin can manage a Worker with no ALLOWED_ORIGINS variable',async()=>{
  const defaultOrigin='https://mohammadrezaamani.github.io';
  const req=new Request('https://youtv.workers.dev/admin/cloudflare',{
    method:'POST',
    headers:{Origin:defaultOrigin,Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},
    body:JSON.stringify({operation:'verify'})
  });
  await withFetch(async(url)=>{
    assert.equal(url,'https://api.cloudflare.com/client/v4/user/tokens/verify');
    return new Response(JSON.stringify({success:true}),{status:200});
  },async()=>{
    const result=await worker.fetch(req,{ALLOWED_HOSTS:'*',PROXY_TOKEN:'',ADMIN_TOKEN:admin});
    assert.equal(result.status,200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'),defaultOrigin);
  });
});
test('default site origin rejects invalid admin credentials even without origin configuration',async()=>{
  const response=await worker.fetch(new Request('https://youtv.workers.dev/admin/cloudflare',{
    method:'POST',headers:{Origin:'https://mohammadrezaamani.github.io',Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':'bad'},body:'{}'
  }),{ALLOWED_HOSTS:'*',ADMIN_TOKEN:admin});
  assert.equal(response.status,401);
});
test('Cloudflare admin verifies API token against fixed Cloudflare host',async()=>{
  const data={success:true,result:{status:'active'}};
  await withFetch(async(url,init)=>{
    assert.equal(url,'https://api.cloudflare.com/client/v4/user/tokens/verify');
    assert.equal(init.headers.Authorization,`Bearer ${cloudflare}`);
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  },async()=>{
    const input=request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},body:JSON.stringify({operation:'verify'})});
    const response=await worker.fetch(input,env);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),data);
    assert.ok(!JSON.stringify(data).includes(cloudflare));
  });
});
test('Cloudflare admin cannot make arbitrary upstream requests',async()=>{
  const input=request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},body:JSON.stringify({operation:'fetch',url:'https://evil.com',method:'DELETE'})});
  const response=await worker.fetch(input,env);assert.equal(response.status,400);
});
test('Cloudflare admin writes only YouTV secret bindings to fixed Cloudflare route',async()=>{
  const newSecret='Z'.repeat(40);
  await withFetch(async(url,init)=>{
    assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/workers/scripts/youtv-personal/secrets');
    assert.equal(init.method,'PUT');
    const body=JSON.parse(init.body);
    assert.deepEqual(body,{name:'PROXY_TOKEN',type:'secret_text',text:newSecret});
    return new Response(JSON.stringify({success:true,result:{name:'PROXY_TOKEN',type:'secret_text',text:newSecret}}),{status:200});
  },async()=>{
    const input=request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},body:JSON.stringify({operation:'setSecret',accountId:'a'.repeat(32),scriptName:'youtv-personal',secretName:'PROXY_TOKEN',secretValue:newSecret})});
    const response=await worker.fetch(input,env);
    assert.equal(response.status,200);
    assert.doesNotMatch(await response.text(),new RegExp(newSecret));
  });
});
test('Cloudflare admin forbids arbitrary secrets and rejects oversized body without content-length',async()=>{
  const make=(secretName,secretValue)=>request('/admin/cloudflare',{method:'POST',headers:{Authorization:`Bearer ${cloudflare}`,'X-YouTV-Admin-Token':admin,'Content-Type':'application/json'},body:JSON.stringify({operation:'setSecret',accountId:'a'.repeat(32),scriptName:'youtv-personal',secretName,secretValue})});
  assert.equal((await worker.fetch(make('DATABASE_PASSWORD','x'.repeat(40)),env)).status,400);
  const oversized=make('PROXY_TOKEN','x'.repeat(5000));
  oversized.headers.delete('content-length');
  assert.equal((await worker.fetch(oversized,env)).status,413);
});
