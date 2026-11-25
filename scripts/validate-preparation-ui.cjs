/* Real stream + rendered geometry; run against the built app. Optional external
 * Playwright path matches validate-playback.cjs. Screenshots go to the OS temp
 * directory unless YOUTV_TEST_SCREENSHOT_DIR is set. */
const { chromium } = require(process.env.YOUTV_PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const directory = process.env.YOUTV_TEST_SCREENSHOT_DIR || require('node:os').tmpdir();
async function main() {
  fs.mkdirSync(directory, {recursive:true});
  const browser = await chromium.launch({executablePath:process.env.YOUTV_CHROME || '/opt/google/chrome/chrome', headless:true, args:['--no-sandbox']});
  try {
    const results = [];
    for (const width of [320,390,1280]) {
      const context = await browser.newContext({viewport:{width,height:900}});
      const page = await context.newPage();
      await page.goto(process.env.YOUTV_TEST_URL || 'http://localhost:5175', {waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'4Kurd',exact:true}).first().click();
      const automatic=page.locator('.connection-toggle button').nth(0);
      if(await automatic.getAttribute('aria-pressed')!=='true')await automatic.click();
      const indicator = page.locator('.preparation-indicator');
      await indicator.waitFor();
      await page.waitForFunction(()=>document.querySelector('[role=progressbar][aria-valuenow="100"]'),null,{timeout:30000});
      const geometry = () => page.evaluate(()=>{
        const player=document.querySelector('.pro-player').getBoundingClientRect();
        const shell=document.querySelector('.player-shell').getBoundingClientRect();
        const next=document.querySelector('.player-channel-info').getBoundingClientRect();
        const controls=document.querySelector('.pro-controls');
        return {playerHeight:player.height,shellHeight:shell.height,infoTop:next.top,controlsOverflow:controls.scrollWidth>controls.clientWidth};
      });
      const closed=await geometry();
      if (await page.locator('[role=dialog]').count()) throw Error('Details open by default');
      if (closed.controlsOverflow) throw Error('Controls overflow the video');
      await page.screenshot({path:path.join(directory,`youtv-preparation-${width}-closed.png`),timeout:10000});
      await indicator.click();
      const popup=page.locator('.preparation-popover');await popup.waitFor();
      const open=await geometry(), rect=await popup.boundingBox();
      if (open.infoTop!==closed.infoTop || open.shellHeight!==closed.shellHeight) throw Error('Popover shifts layout');
      if (rect.x<0 || rect.x+rect.width>width || rect.y<0) throw Error('Popover outside viewport');
      await page.screenshot({path:path.join(directory,`youtv-preparation-${width}-open.png`),timeout:10000});
      await page.keyboard.press('Escape');
      if (await popup.count()) throw Error('Escape did not dismiss details');
      results.push({width,closed,open,popup:rect,layoutUnchanged:true,escapeDismissed:true});
      await context.close();
    }
    console.log(JSON.stringify(results,null,2));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
