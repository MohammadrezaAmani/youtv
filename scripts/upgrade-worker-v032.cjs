/**
 * YouTV Worker v0.32.0 corrective upgrade.
 * Apply the one-file patch, then run: node scripts/upgrade-worker-v032.cjs
 *
 * Designed for installations where v0.31 migration already wrote source files
 * but its dashboard build failed with Cannot find module 'typescript'.
 * Does not modify user playlists, playback preferences, or app state.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const VERSION = "0.32.0";
const changes = new Map();

function read(relative) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename))
    throw new Error(`Missing expected project file: ${relative}`);
  return fs.readFileSync(filename, "utf8");
}
function stage(relative, next) {
  if (next !== read(relative)) changes.set(relative, next);
}
function requireMatch(value, matcher, name) {
  if (!matcher.test(value))
    throw new Error(`Unsupported source layout: ${name}; nothing was modified`);
}

// Repair known HLS directives missing their '#' prefix. For example, the
// Telewebion upstream publishes "EXT-X-VERSION:6" as a bare line. It is not a
// stream URI; interpreting it as an URL creates the bogus ext-x-version: scheme.
const hlsFile = "apps/worker/src/hls.ts";
let hls = read(hlsFile);
const oldParser = `    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return replace(trimmed);
    // e.g. #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
    // URI attributes can appear at any position, and may contain escaped quotes.
    if (!/^#EXT-X-[\\w-]+:/i.test(trimmed)) return line;
    return line.replace(`;
const newParser = `    if (!trimmed) return line;
    // Some IPTV origins omit '#' on HLS tags. Normalize only recognized HLS
    // directive shapes, never arbitrary strings or URL schemes.
    const bareTag = /^(?:EXTM3U$|EXTINF:|EXT-X-[A-Z0-9-]+(?::|$))/i.test(trimmed);
    const normalized = bareTag ? line.replace(trimmed, \`#\${trimmed}\`) : line;
    if (!trimmed.startsWith('#') && !bareTag) return replace(trimmed);
    // e.g. #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
    // URI attributes can appear at any position, and may contain escaped quotes.
    if (!/^#EXT-X-[\\w-]+:/i.test(normalized.trim())) return normalized;
    return normalized.replace(`;
if (hls.includes(oldParser)) hls = hls.replace(oldParser, newParser);
else if (!hls.includes("const bareTag = /^(?:EXTM3U$|EXTINF:|EXT-X-"))
  throw new Error("Unknown HLS parser; refusing to overwrite custom code");
stage(hlsFile, hls);

// Keep the runtime and the in-app Worker installer on the same release.
const runtimeFile = "apps/worker/src/index.ts";
let runtime = read(runtimeFile);
requireMatch(
  runtime,
  /const VERSION\s*=\s*['"]\d+\.\d+\.\d+['"];/,
  runtimeFile,
);
runtime = runtime.replace(
  /const VERSION\s*=\s*['"]\d+\.\d+\.\d+['"];/,
  `const VERSION = '${VERSION}';`,
);
stage(runtimeFile, runtime);

const guideFile = "apps/web/src/features/proxy/CloudflareGuide.tsx";
let guide = read(guideFile);
requireMatch(
  guide,
  /const WORKER_RELEASE\s*=\s*['"]\d+\.\d+\.\d+['"];/,
  guideFile,
);
guide = guide.replace(
  /const WORKER_RELEASE\s*=\s*['"]\d+\.\d+\.\d+['"];/,
  `const WORKER_RELEASE='${VERSION}';`,
);
// The bundle is built by Bun. Its emission style may be `var VERSION = ...`
// or `const VERSION = ...`, so verify our explicit version header instead.
const oldCheck = "!code.includes(`const VERSION = '${WORKER_RELEASE}';`)";
const newCheck =
  "!code.startsWith(`// YouTV Worker bundle version: v${WORKER_RELEASE}\\n`)";
if (guide.includes(oldCheck)) guide = guide.replace(oldCheck, newCheck);
else if (!guide.includes(newCheck))
  throw new Error("Unknown Worker download validation");
// Bun may emit `export { index_default as default }` instead of the literal
// `export default`, and both are valid ES-module Worker entrypoints.
const previousExportCheck = "!code.includes('export default')";
const flexibleExportCheck =
  "!/(?:\\bexport\\s+default\\b|\\bas\\s+default\\b)/.test(code)";
if (guide.includes(previousExportCheck))
  guide = guide.replace(previousExportCheck, flexibleExportCheck);
else if (!guide.includes(flexibleExportCheck))
  throw new Error("Unknown Worker ESM validation");
if (!guide.includes("dashboard-worker.mjs?v=${WORKER_RELEASE}"))
  throw new Error("Worker download URL must be versioned");
if (!guide.includes("download={`YouTV-Worker-v${WORKER_RELEASE}.mjs`}"))
  throw new Error("Worker download filename must be versioned");
stage(guideFile, guide);

// Stop depending on Node resolving a TypeScript devDependency from scripts/.
// Bun is already the project's package manager and bundles Worker TS directly.
const buildFile = "scripts/build-dashboard.cjs";
const builder = `/** Generate the exact Worker code served by YouTV's Copy/Download actions. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/worker/src/index.ts'), 'utf8');
const match = source.match(/const VERSION\\s*=\\s*['\"](\\d+\\.\\d+\\.\\d+)['\"]/);
if (!match) throw new Error('Worker VERSION not found in apps/worker/src/index.ts');
const version = match[1];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'youtv-worker-'));
try {
  const output = path.join(temporary, 'worker.mjs');
  const result = spawnSync('bun', [
    'build', 'apps/worker/src/index.ts', '--target=browser', '--format=esm',
    '--outfile', output
  ], {cwd:root, stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('bun build Worker failed with exit ' + result.status);
  const compiled = fs.readFileSync(output, 'utf8');
  if (!/(?:\\bexport\\s+default\\b|\\bas\\s+default\\b)/.test(compiled))
    throw new Error('Worker bundle has no default export');
  const payload = '// YouTV Worker bundle version: v' + version + '\\n' + compiled;
  for (const relative of [
    'apps/worker/dashboard-worker.mjs',
    'apps/web/public/dashboard-worker.mjs'
  ]) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), {recursive:true});
    fs.writeFileSync(destination, payload, 'utf8');
    console.log('Published ' + relative + ' (v' + version + ')');
  }
} finally {
  fs.rmSync(temporary, {recursive:true, force:true});
}
`;
stage(buildFile, builder);

// Add a regression test using the *exact* malformed Telewebion master playlist
// provided by the user; verify all four rendition targets and the repaired tag.
const testsFile = "apps/worker/tests/hls.test.ts";
let tests = read(testsFile);
if (
  !tests.includes("it('repairs missing hash in Telewebion master playlist'")
) {
  const test = `  it('repairs missing hash in Telewebion master playlist',()=>{
    const telewebion = new URL('https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8');
    const input = '#EXTM3U\\nEXT-X-VERSION:6\\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=2756600,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2",NAME="وضوح بالا (Full HD)"\\n1080p/index.m3u8\\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1861200,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",NAME="وضوح متوسط (HD)"\\n720p/index.m3u8\\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1240800,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2",NAME="اقتصادی (480p)"\\n480p/index.m3u8\\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=655600,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",NAME="وضوح کم (240p)"\\n240p/index.m3u8';
    const output = rewriteHls(input, telewebion, proxy, '');
    const lines = output.split('\\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXT-X-VERSION:6');
    for (const quality of ['1080p','720p','480p','240p']){
      const uri = lines.find(line=>line.startsWith('https://') && new URL(line).searchParams.get('url')?.includes('/'+quality+'/'));
      expect(uri,quality).toBeDefined();
      expect(new URL(uri!).searchParams.get('url')).toBe('https://ncdn.telewebion.ir/hdtest/live/'+quality+'/index.m3u8');
      expect(new URL(uri!).searchParams.has('key')).toBe(false);
    }
    expect(output).not.toContain('ext-x-version:');
  });
  it('normalizes bare HLS directives without proxying them as URLs',()=>{
    const input='#EXTM3U\\nEXT-X-TARGETDURATION:6\\nEXT-X-MEDIA-SEQUENCE:123\\nEXTINF:6,\\nsegment.ts\\nEXT-X-ENDLIST';
    const output=rewriteHls(input,source,proxy,'');
    expect(output).toContain('#EXT-X-TARGETDURATION:6');
    expect(output).toContain('#EXT-X-MEDIA-SEQUENCE:123');
    expect(output).toContain('#EXTINF:6,');
    expect(output).toContain('#EXT-X-ENDLIST');
    expect(output).toContain('https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Fsegment.ts');
  });
`;
  const marker = "  it('rejects not-HLS input'";
  if (!tests.includes(marker))
    throw new Error("HLS tests layout not recognized");
  tests = tests.replace(marker, test + marker);
}
stage(testsFile, tests);

// Update the smoke test to verify the published Worker, not a hard-coded TS
// emit format. The runtime and browser-download file must remain byte-identical.
const smokeFile = "apps/worker/tests/smoke.test.mjs";
let smoke = read(smokeFile);
smoke = smoke.replace(
  /assert\.equal\(\(await health\.json\(\)\)\.version,'\d+\.\d+\.\d+'\);/g,
  `assert.equal((await health.json()).version,'${VERSION}');`,
);
smoke = smoke.replace(
  /test\('dashboard installer uses the same v\d+\.\d+\.\d+ Worker as the runtime'/,
  `test('dashboard installer uses the same v${VERSION} Worker as the runtime'`,
);
smoke = smoke.replace(
  /assert\.match\(published,\/const VERSION = '[^']+';\/\);/g,
  `assert.match(published,/^\\/\\/ YouTV Worker bundle version: v${VERSION.replace(/\./g, "\\.")}\\n/);`,
);
smoke = smoke.replace(
  /assert\.match\(guide,\/WORKER_RELEASE='[^']+'\/\);/g,
  `assert.match(guide,/WORKER_RELEASE='${VERSION.replace(/\./g, "\\.")}'/);`,
);
if (
  !smoke.includes("test('Telewebion malformed HLS master is served by /proxy'")
) {
  smoke += `
// Reproduces the exact server-side "ext-x-version:" rejection from Telewebion.
test('Telewebion malformed HLS master is served by /proxy',async(t)=>{
  const manifest = '#EXTM3U\\nEXT-X-VERSION:6\\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=2756600,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2",NAME="وضوح بالا (Full HD)"\\n1080p/index.m3u8\\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1861200,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",NAME="وضوح متوسط (HD)"\\n720p/index.m3u8\\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1240800,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2",NAME="اقتصادی (480p)"\\n480p/index.m3u8\\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=655600,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",NAME="وضوح کم (240p)"\\n240p/index.m3u8';
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response(manifest,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  t.after(()=>{globalThis.fetch=previous;});
  const endpoint=new URL('https://youtv.workers.dev/proxy');
  endpoint.searchParams.set('url','https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8');
  endpoint.searchParams.set('hls','1');
  const res=await worker.fetch(new Request(endpoint,{headers:{Origin:'https://mohammadrezaamani.github.io'}}),
    {ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:'',PROXY_TOKEN:''});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://mohammadrezaamani.github.io');
  const rewritten=await res.text();
  assert.match(rewritten,/^#EXTM3U\\n#EXT-X-VERSION:6\\n/);
  for(const quality of ['1080p','720p','480p','240p'])
    assert.ok(rewritten.includes(encodeURIComponent('https://ncdn.telewebion.ir/hdtest/live/'+quality+'/index.m3u8')),quality);
  assert.doesNotMatch(rewritten,/^EXT-X-VERSION:/m);
});
`;
}
stage(smokeFile, smoke);

// Do not allow accidental execution of the obsolete v0.31 script to downgrade
// the release or reintroduce the require('typescript') failure.
const legacy = "scripts/upgrade-worker-v031.cjs";
if (fs.existsSync(path.join(root, legacy)))
  stage(
    legacy,
    "// Superseded by v0.32.0. Retained for compatibility with previous instructions.\nrequire('./upgrade-worker-v032.cjs');\n",
  );

// All checks are complete. Write only the planned project-owned files.
for (const [relative, content] of changes) {
  const filename = path.join(root, relative);
  const temporary = filename + ".youtv-v032-tmp";
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filename);
  console.log("Updated " + relative);
}
// The build is part of the upgrade, so the UI always downloads the real code.
execFileSync(process.execPath, [path.join(root, buildFile)], {
  cwd: root,
  stdio: "inherit",
});
const worker = read("apps/worker/dashboard-worker.mjs");
const published = read("apps/web/public/dashboard-worker.mjs");
if (
  worker !== published ||
  !worker.startsWith(`// YouTV Worker bundle version: v${VERSION}\n`)
)
  throw new Error("Worker/browser installer bundle verification failed");
console.log(
  `YouTV Worker v${VERSION}: runtime, Copy code and Download code are synchronized.`,
);
