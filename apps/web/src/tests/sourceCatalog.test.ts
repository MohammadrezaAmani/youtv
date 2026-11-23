import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanLocalSources,scanSourceCatalog} from '../../sourceCatalog';

describe('filesystem source catalog',()=>{
  it('discovers nested directories, README markdown and non-ASCII filenames',async()=>{
    const root=await mkdtemp(join(tmpdir(),'youtv-sources-'));
    try{
      await mkdir(join(root,'Iran','News'),{recursive:true});
      await writeFile(join(root,'README.md'),'# Personal playlists\n\n| Group | Networks |\n| --- | --- |\n| News | 2 |\n');
      await writeFile(join(root,'Iran','README.md'),'# ایران\n\n**فهرست منابع**');
      await writeFile(join(root,'Iran','News','persian IPTV @wbnet(1).m3u8'),
        '#EXTINF:0, tvg-name="Manoto HD" - Manoto HD\nhttps://example.org/manoto.m3u8\n');
      await writeFile(join(root,'Iran','80+TÜRK TV.M3U'),'https://example.org/channel-one.m3u8\nhttps://example.org/channel-two.m3u8\n');
      await writeFile(join(root,'hls.m3u8'),'#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n');
      const catalog=await scanSourceCatalog(root);
      expect(catalog.version).toBe(2);
      expect(catalog.folders.find(folder=>folder.path==='')?.readme).toBe('README.md');
      expect(catalog.folders.find(folder=>folder.path==='Iran')?.readme).toBe('Iran/README.md');
      expect(catalog.folders.find(folder=>folder.path==='Iran')?.channelCount).toBe(2+1);
      expect(catalog.sources.find(source=>source.path==='Iran/80+TÜRK TV.M3U')?.channelCount).toBe(2);
      expect(catalog.sources.find(source=>source.path==='Iran/News/persian IPTV @wbnet(1).m3u8')?.kind).toBe('playlist');
      expect(catalog.sources.find(source=>source.path==='hls.m3u8')?.kind).toBe('hls');
      expect((await scanLocalSources(root)).length).toBe(3);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('in curated mode lists only DNS-screened playlists while retaining source files on disk',async()=>{
    const root=await mkdtemp(join(tmpdir(),'youtv-curated-source-'));
    try{
      await mkdir(join(root,'_verified'),{recursive:true});
      await writeFile(join(root,'old.m3u'),'#EXTINF:-1,Old\nhttps://dead.example.invalid/stream.m3u8\n');
      await mkdir(join(root,'_verified','collections','Iran'),{recursive:true});
      await writeFile(join(root,'_verified','online.m3u8'),'#EXTINF:-1,Available\nhttps://resolved.example.org/live.m3u8\n');
      await writeFile(join(root,'_verified','collections','Iran','news.m3u8'),'#EXTINF:-1,Available\nhttps://resolved.example.org/live.m3u8\n');
      await writeFile(join(root,'_verified','README.md'),'# DNS verified');
      const catalog=await scanSourceCatalog(root,true);
      expect(catalog.sources.map(source=>source.path)).toEqual(['_verified/collections/Iran/news.m3u8']);
      expect(catalog.folders.find(folder=>folder.path==='_verified')?.readme).toBe('_verified/README.md');
      expect((await scanSourceCatalog(root)).sources).toHaveLength(3);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('does not impose the previous 15 MB source limit',async()=>{
    const root=await mkdtemp(join(tmpdir(),'youtv-large-source-'));
    try{
      // A real playlist structure, with a long metadata section followed by a valid stream.
      const body='#EXTM3U\n# '+('x'.repeat(15_500_000))+'\n#EXTINF:-1,International TV\nhttps://example.org/live.m3u8\n';
      await writeFile(join(root,'large.m3u'),body);
      const sources=await scanLocalSources(root);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({kind:'playlist',channelCount:1});
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
