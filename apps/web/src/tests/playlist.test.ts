import {describe,it,expect} from 'vitest';
import { parseM3u, isHlsManifest,toM3u } from '../lib/playlist';
import {createChannel} from '@youtv/shared';

describe('IPTV lists',()=>{
  it('imports URL, TVG metadata, and grouping',()=>{
    const text='#EXTM3U\n#EXTINF:-1 tvg-id="channel.1" group-title="News" tvg-logo="https://img.test/a.png",Real Station\nhttps://media.test/live/index.m3u8\n';
    const list=parseM3u(text);
    expect(list.channels).toHaveLength(1);
    expect(list.channels[0]?.name).toBe('Real Station');
    expect(list.channels[0]?.group).toBe('News');
    expect(list.channels[0]?.tvgId).toBe('channel.1');
  });
  it('distinguishes HLS playback manifest',()=>{
    expect(isHlsManifest('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nfile.ts')).toBe(true);
    expect(()=>parseM3u('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nfile.ts')).toThrow();
  });
  it('exports compatible EXTINF/URL pairs',()=>{
    const channel=createChannel({name:'User channel',url:'https://media.test/live.m3u8',group:'Live'});
    expect(toM3u([channel])).toContain('group-title="Live",User channel');
  });
});

describe('EXTINF interoperability',()=>{
  it('extracts names when IPTV metadata is after the comma',()=>{
    const text=[
      '#EXTM3U',
      '#EXTINF:0, tvg-id="" tvg-logo="" tvg-name="Manoto HD" group-title="" - Manoto HD',
      'https://media.example.org/manoto/playlist.m3u8',
      '#EXTINF:0, tvg-id="" tvg-logo="" tvg-name="iran international" group-title="" - iran international',
      'https://media.example.org/iran/playlist.m3u8'
    ].join('\r\n');
    const parsed=parseM3u(text);
    expect(parsed.channels.map(c=>c.name)).toEqual(['Manoto HD','iran international']);
    expect(parsed.channels[0]?.name).not.toContain('tvg-id');
    expect(parsed.channels[0]?.group).toBe('');
  });
  it('keeps commas within quoted TVG attributes',()=>{
    const parsed=parseM3u('#EXTM3U\n#EXTINF:-1 tvg-name="News, World" group-title="News, International",News HD\nhttps://media.example.org/live.m3u8');
    expect(parsed.channels[0]?.name).toBe('News HD');
    expect(parsed.channels[0]?.group).toBe('News, International');
  });
  it('falls back to tvg-name without a visible title',()=>{
    const parsed=parseM3u('#EXTM3U\n#EXTINF:0, tvg-id="alpha" tvg-name="Sample Sports" group-title="Sports"\nhttps://media.example.org/sports.m3u8');
    expect(parsed.channels[0]?.name).toBe('Sample Sports');
    expect(parsed.channels[0]?.tvgId).toBe('alpha');
  });
});


describe('headerless IPTV compatibility',()=>{
  it('imports a real-world EXTINF list even without the EXTM3U header',()=>{
    const parsed=parseM3u([
      '#EXTINF:0, tvg-id="" tvg-logo="" tvg-name="Manoto HD" group-title="" - Manoto HD',
      'https://example.org/manoto.m3u8',
      '#EXTINF:-1 group-title="News",iran international',
      'https://example.org/iran.m3u8'
    ].join('\n'));
    expect(parsed.channels.map(c=>c.name)).toEqual(['Manoto HD','iran international']);
    expect(parsed.channels).toHaveLength(2);
  });
  it('imports a plain list of HTTP streaming URLs',()=>{
    const parsed=parseM3u('https://example.org/a.m3u8\nhttps://example.org/b.m3u8\n');
    expect(parsed.channels).toHaveLength(2);
  });
  it('still distinguishes HLS fragment playlists even without EXTM3U',()=>{
    expect(()=>parseM3u('#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts')).toThrow(/HLS/i);
  });
});
