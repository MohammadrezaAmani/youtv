/* Deterministic recovery layout test using a genuine 404 on the real source
 * host. This tests the error UI, not stream playback. Run against Vite dev. */
const {chromium}=require(process.env.YOUTV_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.YOUTV_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const results=[];
 for(const width of [320,390,844]){
  const context=await browser.newContext({viewport:{width,height:width===844?390:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(process.env.YOUTV_TEST_URL||'http://localhost:5173',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'4Kurd',exact:true}).first().click();
  await page.evaluate(async()=>{
   const{useYoutv}=await import('/src/stores/useYoutv.ts');const state=useYoutv.getState();
   state.updateSettings({autoReconnect:false});const channel=state.channels.find(c=>c.name==='4Kurd');
   state.updateChannel(channel.id,{url:'https://4kuhls.persiana.live/hls/missing-validation.m3u8',proxyMode:'direct'});
  });
  await page.locator('.pro-error').waitFor({timeout:20000});
  const button=page.locator('.pro-error-actions button').last();
  await button.scrollIntoViewIfNeeded();
  const reachable=await button.evaluate(el=>{const b=el.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===el;});
  if(!reachable)throw new Error(`Recovery action covered at ${width}px`);
  await button.tap();
  await page.waitForFunction(()=>!document.querySelector('.pro-error'),null,{timeout:5000});
  results.push({width,recoveryButtonReachable:reachable,tapDismissedError:true});
  await context.close();
 }
 await browser.close();console.log(JSON.stringify(results,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
