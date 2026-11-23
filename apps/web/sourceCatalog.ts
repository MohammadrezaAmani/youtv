import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Purely build-time discovery. No server or directory access is needed in the shipped SPA. */
export type LocalSourceEntry = {
  path: string; name: string; channelCount: number; bytes: number;
  kind: 'playlist' | 'hls' | 'invalid' | 'oversize';
};
const folder = fileURLToPath(new URL('./public/sources/', import.meta.url));
const maxBytes = 15_000_000;

export async function scanLocalSources(root = folder): Promise<LocalSourceEntry[]> {
  const files: LocalSourceEntry[] = [];
  async function visit(dir: string) {
    let children;
    try { children = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const entry of children) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await visit(full); continue; }
      if (!entry.isFile() || !/\.m3u8?$/i.test(entry.name)) continue;
      const path = relative(root, full).split(sep).join('/');
      const size = (await stat(full)).size;
      if (size > maxBytes) { files.push({ path, name: entry.name, channelCount: 0, bytes:size, kind:'oversize' }); continue; }
      const text = await readFile(full, 'utf8');
      const isExtended = /^(?:\uFEFF)?\s*#EXTM3U\b/.test(text);
      const hls = /^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|PART-INF|PLAYLIST-TYPE|MAP|KEY)\b/m.test(text);
      const count = (text.match(/^\s*#EXTINF:/gmi) || []).length;
      files.push({ path, name:entry.name, channelCount:!hls && isExtended ? count : 0, bytes:size,
        kind:!isExtended?'invalid':hls?'hls':count>0?'playlist':'invalid' });
    }
  }
  await visit(root);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}

export function sourceCatalogPlugin(): Plugin {
  return {
    name: 'youtv-source-catalog',
    configureServer(server) {
      // Updating files while Vite is already running refreshes the source view.
      server.watcher.add(folder);
      const publish=(path:string)=>{
        const absolute=resolve(path);
        if(absolute.startsWith(resolve(folder)+sep)&&/\.m3u8?$/i.test(absolute)){
          server.ws.send({type:'custom',event:'youtv:sources-changed'});
        }
      };
      server.watcher.on('add',publish);
      server.watcher.on('unlink',publish);
      server.watcher.on('change',publish);
      server.middlewares.use(async (req,res,next) => {
        const pathname = (req.url||'').split('?')[0];
        if (!pathname?.endsWith('/sources/index.json')) return next();
        try {
          const data = await scanLocalSources();
          res.statusCode=200;
          res.setHeader('Content-Type','application/json; charset=utf-8');
          res.setHeader('Cache-Control','no-store');
          res.end(JSON.stringify({version:1,sources:data}));
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      const data = await scanLocalSources();
      this.emitFile({type:'asset',fileName:'sources/index.json',source:JSON.stringify({version:1,sources:data})});
    }
  };
}
