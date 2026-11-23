/** Generate the exact Worker code served by YouTV's Copy/Download actions. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/worker/src/index.ts'), 'utf8');
const match = source.match(/const VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/);
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
  if (!/(?:\bexport\s+default\b|\bas\s+default\b)/.test(compiled))
    throw new Error('Worker bundle has no default export');
  const payload = '// YouTV Worker bundle version: v' + version + '\n' + compiled;
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
