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
  if (process.argv.includes('--typescript-fallback')) {
    // Explicit offline/development fallback; production builds still use Bun.
    // Every module is transpiled by TypeScript and linked into one ESM file.
    const ts = require(require.resolve('typescript', {paths:[root,path.join(root,'apps/worker')]}));
    const modules = new Map();
    function visit(file) {
      const id = path.relative(root,file).split(path.sep).join('/');
      if (modules.has(id)) return id;
      const text = fs.readFileSync(file,'utf8');
      modules.set(id,'');
      const dependencies = {};
      for (const imported of ts.preProcessFile(text,true,true).importedFiles) {
        const spec = imported.fileName;
        if (!spec.startsWith('.')) throw new Error('External Worker import in offline bundle: '+spec);
        dependencies[spec] = visit(path.resolve(path.dirname(file),spec));
      }
      const result = ts.transpileModule(text,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
      const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
      if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=>"\n"}));
      modules.set(id,`[${JSON.stringify(dependencies)},function(module,exports,require){\n${result.outputText}\n}]`);
      return id;
    }
    const entry=visit(path.join(root,'apps/worker/src/index.ts'));
    fs.writeFileSync(output,`const __modules={${[...modules].map(([id,body])=>JSON.stringify(id)+':'+body).join(',\n')}};\nconst __cache=Object.create(null);\nfunction __load(id){if(__cache[id])return __cache[id].exports;const [deps,run]=__modules[id];const module={exports:{}};__cache[id]=module;run(module,module.exports,spec=>__load(deps[spec]));return module.exports;}\nexport default __load(${JSON.stringify(entry)}).default;\n`);
  } else {
    const result = spawnSync('bun', [
      'build', 'apps/worker/src/index.ts', '--target=browser', '--format=esm',
      '--outfile', output
    ], {cwd:root, stdio:'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('bun build Worker failed with exit ' + result.status);
  }
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
