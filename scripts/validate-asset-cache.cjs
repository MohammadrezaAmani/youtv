/* Genuine public logo decode + persistent-cache test with HTTP cache disabled.
 * No mocked network responses. Uses fresh isolated browser profiles. */
const {chromium}=require(process.env.YOUTV_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.YOUTV_TEST_URL||'http://localhost:5173';
const source=process.env.YOUTV_TEST_ASSET_URL||'https://i.imgur.com/t5AUthL.png';
const url=process.env.YOUTV_TEST_ASSET_URL?source:(process.env.YOUTV_TEST_WORKER||'https://meow.arushop.ir')+'/proxy?url='+encodeURIComponent(source);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.YOUTV_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();let transfers=0;
 context.on('request',r=>{if(r.url()===url&&r.serviceWorker())transfers++;});
 const setup=async()=>{const p=await context.newPage();await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!navigator.serviceWorker.controller);const cdp=await context.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});return p;};
 const load=p=>p.evaluate(url=>new Promise(resolve=>{const image=new Image();image.referrerPolicy='no-referrer';image.onload=()=>resolve({decoded:true,width:image.naturalWidth});image.onerror=()=>resolve({decoded:false});image.src=url;}),url);
 const first=await setup();
 await first.evaluate(async url=>{for(const name of await caches.keys())if(/images-v1|image-meta-v1/.test(name))await(await caches.open(name)).delete(url,{ignoreVary:true});},url);
 const original=await load(first),initialTransfers=transfers;
 const repeated=await load(first),repeatTransfers=transfers;
 const second=await setup();const otherTab=await load(second),tabTransfers=transfers;
 await first.reload({waitUntil:'domcontentloaded'});const reloaded=await load(first),reloadTransfers=transfers;
 const result={source,original,repeated,otherTab,reloaded,initialTransfers,repeatTransfers,tabTransfers,reloadTransfers,passed:original.decoded&&repeated.decoded&&otherTab.decoded&&reloaded.decoded&&initialTransfers>=1&&repeatTransfers===initialTransfers&&tabTransfers===initialTransfers&&reloadTransfers===initialTransfers};
 console.log(JSON.stringify(result,null,2));await browser.close();if(!result.passed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
