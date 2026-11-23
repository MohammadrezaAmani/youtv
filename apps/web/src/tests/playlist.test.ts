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
