/* Actual app + real catalog channel. A click followed immediately by reload
 * must retain each channel's route without changing the global default. */
const {chromium}=require(process.env.YOUTV_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.YOUTV_TEST_URL||'http://localhost:5175';
async function main(){
 const browser=await chromium.launch({executablePath:process.env.YOUTV_CHROME||'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext(),page=await context.newPage();
  await page.addInitScript(()=>{
   const describe=value=>{const s=value?.state,id=sessionStorage.getItem('routeTarget');return {count:s?.channels?.length,found:s?.channels?.some(c=>c.id===id),mode:s?.channels?.find(c=>c.id===id)?.proxyMode,playlists:s?.playlists?.length};};
   const trace=(type,value)=>{const rows=JSON.parse(sessionStorage.getItem('routeTrace')||'[]');rows.push({type,...describe(value)});sessionStorage.setItem('routeTrace',JSON.stringify(rows.slice(-20)));};
   const read=IDBObjectStore.prototype.get,write=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.get=function(key){const r=read.call(this,key);if(key==='youtv:v1')r.addEventListener('success',()=>trace('get',r.result));return r;};
   IDBObjectStore.prototype.put=function(value,key){if(key==='youtv:v1')trace('put',value);return write.call(this,value,key);};
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'4Kurd',exact:true}).first().click();
  await page.locator('video').waitFor();
  await page.waitForURL('**/#/watch/**');
  const target=page.url(),results=[];
  await page.evaluate(id=>sessionStorage.setItem('routeTarget',id),new URL(target).hash.split('/').at(-1));
  // Match the user's existing library: finish the catalog's initial import
  // before testing an immediate reload of an individual route preference.
  await page.waitForFunction(id=>new Promise(resolve=>{
   const opening=indexedDB.open('youtv-library');
   opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('snapshots','readonly'),read=tx.objectStore('snapshots').get('youtv:v1');read.onsuccess=()=>resolve(read.result?.state?.channels?.some(channel=>channel.id===id)===true);tx.oncomplete=()=>db.close();};
   opening.onerror=()=>resolve(false);
  }),new URL(target).hash.split('/').at(-1));
  for(const [mode,index] of [['direct',1],['proxy',2],['auto',0]]){
   await page.locator('.connection-toggle button').nth(index).click();
   await page.reload({waitUntil:'domcontentloaded'});
   const selected=page.locator('.connection-toggle button').nth(index);
   await selected.waitFor({timeout:10000}).catch(async error=>{
    const stored=await page.evaluate(id=>new Promise(resolve=>{const req=indexedDB.open('youtv-library');req.onsuccess=()=>{const db=req.result,tx=db.transaction('snapshots','readonly'),read=tx.objectStore('snapshots').get('youtv:v1');read.onsuccess=()=>{const s=read.result?.state,c=s?.channels?.find(c=>c.id===id);resolve({count:s?.channels?.length,found:!!c,mode:c?.proxyMode,source:c?.sourceId,settings:s?.settings?.folderSourceEnabled});};tx.oncomplete=()=>db.close();};}),new URL(target).hash.split('/').at(-1));
    console.error(JSON.stringify({url:page.url(),stored,trace:await page.evaluate(()=>sessionStorage.getItem('routeTrace')),text:(await page.locator('body').innerText()).slice(-900)}));throw error;
   });
   const retained=await selected.getAttribute('aria-pressed')==='true';
   const preferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('youtv:v1:preferences:v1')||'{}').settings);
   results.push({mode,retained,globalMode:preferences?.proxyMode});
   if(!retained||preferences.proxyMode!=='auto')throw Error(JSON.stringify({failed:'channel route reset on reload or changed global preference',results}));
   const other=await context.newPage();await other.goto(target,{waitUntil:'domcontentloaded'});
   await other.locator('.connection-toggle button').nth(index).waitFor();
   if(await other.locator('.connection-toggle button').nth(index).getAttribute('aria-pressed')!=='true')throw Error('New tab did not retain '+mode);
   await other.close();
  }
  console.log(JSON.stringify({passed:true,results},null,2));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
