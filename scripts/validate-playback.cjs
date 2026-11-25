/* Optional real-browser soak test. Install Playwright outside the app, then set
 * YOUTV_PLAYWRIGHT_MODULE to its package path if it is not on Node's module path.
 * Runs the actual built app; no fixture streams or substituted media responses.
 */
const fs = require('node:fs');
const playwright = require(process.env.YOUTV_PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.YOUTV_TEST_ENGINE || 'chromium';
const base = process.env.YOUTV_TEST_URL || 'http://localhost:5175';
const seconds = Number(process.env.YOUTV_TEST_SECONDS || 200);
const cases = (process.env.YOUTV_TEST_CASES || 'direct,proxy').split(',');
const main = async () => {
  const browser = await playwright[engine].launch(engine === 'chromium' ? { executablePath: process.env.YOUTV_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] } : { headless: true });
  const results = await Promise.all(cases.map(async scenario => {
    const context = await browser.newContext({ viewport: /mobile|iphone/.test(scenario) ? {width:390,height:844} : {width:1280,height:900}, ...(scenario.includes('iphone') ? {isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'} : {}) });
    const page = await context.newPage();
    const result = {scenario, samples:[], events:[], errors:[], requests:{segments:0,playlists:0,duplicates:0,peak:0},duplicatePaths:[], passed:false};
    const seen = new Set(), active = new Set();
    page.on('request', r => {
      if(!['xhr','fetch','media'].includes(r.resourceType()))return;
      const u = r.url(); if (!/\.ts(?:[?&]|$)|\.m3u8(?:[?&]|$)/i.test(u) && !/%2Ets|%2Em3u8/i.test(u) && !/stream-\d+\.ts/.test(u)) return;
      if (/m3u8/i.test(u)) result.requests.playlists++;
      else { result.requests.segments++; const key=u+'\n'+(r.headers()['range']||''); if(seen.has(key)){result.requests.duplicates++;const outer=new URL(u);const target=outer.searchParams.get('url');result.duplicatePaths.push({path:new URL(target||u).pathname,wall:Date.now()});} seen.add(key); }
      active.add(r);result.requests.peak=Math.max(result.requests.peak,active.size);
    });
    const done = r=>active.delete(r);
    page.on('requestfinished',done);page.on('requestfailed',done);
    page.on('pageerror',e=>result.errors.push(e.message.replace(/https?:\/\/\S+/g,'[URL]')));
    try {
      if(scenario.startsWith('auto-proxy')) await page.route('https://4kuhls.persiana.live/**',route=>route.abort('failed'));
      if(process.env.YOUTV_TEST_WORKER){
        // Seed only this isolated profile through the real preferences journal.
        const {defaultState}=require('../packages/shared/src/index.ts');
        const preferences={revision:Date.now(),settings:{...defaultState.settings,defaultWorkerId:'validation-worker',proxyMode:'proxy'},workers:[{id:'validation-worker',name:'Validation Worker',baseUrl:process.env.YOUTV_TEST_WORKER,token:'',enabled:true}]};
        await page.addInitScript(record=>{if(!localStorage.getItem('youtv:v1:preferences:v1'))localStorage.setItem('youtv:v1:preferences:v1',JSON.stringify(record));},preferences);
      }
      await page.goto(base,{waitUntil:'domcontentloaded'});
      let cdp;
      if (scenario.includes('slow') || scenario.includes('interruption')) {
        cdp=await context.newCDPSession(page);
        await cdp.send('Network.enable');
        if (scenario.includes('slow')) await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:350000,uploadThroughput:100000,connectionType:'cellular3g'});
      }
      await page.getByRole('button',{name:'4Kurd',exact:true}).first().click({timeout:30000});
      await page.locator('video').waitFor();
      const mode=scenario.startsWith('auto')?0:scenario.includes('direct')?1:2;
      const route=page.locator('.connection-toggle button').nth(mode);
      if(await route.getAttribute('aria-pressed')!=='true') await route.click();
      await page.locator('video').evaluate(v=>{
        v.muted=true;window.__soakEvents=[];
        for(const event of ['waiting','stalled','playing','pause','error'])v.addEventListener(event,()=>window.__soakEvents.push({event,time:v.currentTime,wall:Date.now()}));
      });
      await page.locator('button[title="Play"]').click();
      await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.readyState>=3&&v.currentTime>0;},null,{timeout:45000});
      const snapshot=()=>page.locator('video').evaluate(v=>({wall:Date.now(),time:v.currentTime,paused:v.paused,ready:v.readyState,frames:v.getVideoPlaybackQuality?.().totalVideoFrames??null,ranges:Array.from({length:v.buffered.length},(_,i)=>[v.buffered.start(i),v.buffered.end(i)])}));
      const first=await snapshot();result.samples.push(first);
      result.initialBufferAhead=first.ranges.reduce((ahead,[start,end])=>first.time>=start-.15&&first.time<=end+.15?Math.max(ahead,end-first.time):ahead,0);
      result.startupPrepared=result.initialBufferAhead >= (scenario.includes('iphone')?4.4:9);
      console.log(JSON.stringify({scenario,first}));
      for(let elapsed=0;elapsed<seconds;elapsed+=5){
        await new Promise(resolve=>setTimeout(resolve,5000));
        const sample=await snapshot();result.samples.push(sample);
        console.log(JSON.stringify({scenario,sample}));
        if(scenario.includes('interruption') && (elapsed===60 || elapsed===70)) {
          const offline=elapsed===60;
          await cdp.send('Network.emulateNetworkConditions',{offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});
          (result.interruptions??=[]).push({offline,wall:Date.now()});
        }
        if(elapsed===30){if(scenario.includes('iphone'))await page.evaluate(()=>Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false}));await page.locator('.pro-player').hover();await page.locator('.media-fullscreen').click();result.fullscreenEntered=await page.evaluate(()=>!!document.fullscreenElement||document.querySelector('.pro-player')?.dataset.youtvFullscreen==='true');}
        if(elapsed===35){await page.locator('.pro-player').hover();await page.locator('.media-fullscreen').click();result.fullscreenExited=await page.evaluate(()=>!document.fullscreenElement&&document.querySelector('.pro-player')?.dataset.youtvFullscreen!=='true');}
      }
      result.events=await page.evaluate(()=>window.__soakEvents);
      const last=result.samples.at(-1);
      const wall=(last.wall-first.wall)/1000;
      const stalls=result.events.filter(e=>['waiting','pause','error','stalled'].includes(e.event)&&e.wall>first.wall);
      result.passed=result.startupPrepared&&wall>=180&&last.time-first.time>=wall-1.5&&stalls.length===0&&result.samples.every(s=>!s.paused&&s.ready>=3);
      result.elapsed=wall;result.progress=last.time-first.time;result.stalls=stalls.length;
    } catch(error) {
      result.error=error.message.replace(/https?:\/\/\S+/g,'[URL]');
      result.events=await page.evaluate(()=>window.__soakEvents||[]).catch(()=>[]);
      await page.locator('button[title="Diagnostics"]').click().catch(()=>{});
      result.diagnostics=await page.locator('.player-diagnostics').innerText().catch(()=>null);
      result.final=await page.locator('video').evaluate(v=>({time:v.currentTime,ready:v.readyState,paused:v.paused,frames:v.getVideoPlaybackQuality?.().totalVideoFrames})).catch(()=>null);
    }
    await context.close();return result;
  }));
  await browser.close();
  const output=process.env.YOUTV_TEST_OUTPUT||'/tmp/youtv-playback-results.json';
  fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString(),engine,base,seconds,results},null,2)+'\n');
  console.log(JSON.stringify({output,results:results.map(({samples,events,...result})=>result)}));
  if(results.some(r=>!r.passed))process.exitCode=1;
};
main().catch(error=>{console.error(error);process.exitCode=1;});
