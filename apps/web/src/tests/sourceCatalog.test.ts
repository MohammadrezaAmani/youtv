import {describe,it,expect} from 'vitest';
import {mkdtemp,copyFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scanLocalSources} from '../../sourceCatalog';

const actualDefault=fileURLToPath(new URL('../../public/default.m3u8',import.meta.url));

describe('build-time folder playlist discovery',()=>{
  it('counts real channels from the bundled playlist without registering fake channels',async()=>{
    const root=await mkdtemp(join(tmpdir(),'youtv-sources-'));
    try{
      await copyFile(actualDefault,join(root,'actual.m3u8'));
      const manifest=await scanLocalSources(root);
      const text=await readFile(actualDefault,'utf8');
      const realCount=(text.match(/^#EXTINF:/gm)||[]).length;
      expect(manifest).toHaveLength(1);
      expect(manifest[0]?.channelCount).toBe(realCount);
      expect(manifest[0]?.kind).toBe('playlist');
    } finally {await rm(root,{recursive:true,force:true});}
  });
});
