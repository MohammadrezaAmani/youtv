import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanLocalSources} from '../../sourceCatalog';

describe('folder source catalog',()=>{
  it('finds nested, mixed-case and non-ASCII M3U files',async()=>{
    const root=await mkdtemp(join(tmpdir(),'youtv-source-test-'));
    try{
      await mkdir(join(root,'nested'));
      await writeFile(join(root,'persian IPTV @wbnet(1).m3u8'),'#EXTM3U\r\n#EXTINF:0, tvg-name="Manoto HD" - Manoto HD\r\nhttps://example.org/live.m3u8\r\n');
      await writeFile(join(root,'nested','80+TÜRK TV.M3U'),'#EXTM3U\n#EXTINF:-1,Türkçe TV\nhttps://example.org/live.m3u8\n');
      await writeFile(join(root,'hls.m3u8'),'#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment.ts\n');
      const sources=await scanLocalSources(root);
      expect(sources.filter(s=>s.kind==='playlist')).toHaveLength(2);
      expect(sources.find(s=>s.path==='persian IPTV @wbnet(1).m3u8')?.channelCount).toBe(1);
      expect(sources.find(s=>s.path==='nested/80+TÜRK TV.M3U')?.channelCount).toBe(1);
      expect(sources.find(s=>s.path==='hls.m3u8')?.kind).toBe('hls');
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
