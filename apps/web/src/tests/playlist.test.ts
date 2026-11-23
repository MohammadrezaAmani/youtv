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

describe('VLC / Kodi / IPTV options from real-world playlists',()=>{
  it('never renders an inline EXTVLCOPT directive as a channel title',()=>{
    const text='\uFEFF#EXTM3U\r\n#EXTINF:-1,#EXTVLCOPT:http-user-agent=smartlabs\r\nhttps://hls.goodgame.ru/hls/5346.m3u8\r\n';
    const channel=parseM3u(text).channels[0]!;
    expect(channel.name).toBe('hls.goodgame.ru · 5346');
    expect(channel.name).not.toContain('#EXTVLCOPT');
    expect(channel.iptv.userAgent).toBe('smartlabs');
    expect(channel.iptv.vlcOptions['http-user-agent']).toBe('smartlabs');
  });
  it('preserves separate VLC/Kodi directives, radio, EPG and catchup metadata',()=>{
    const text=[
      '#EXTM3U x-tvg-url="https://epg.example.org/guide.xml"',
      '#EXTINF:-1 tvg-id="news" tvg-name="International" tvg-chno="17" radio="true" catchup="append" catchup-days="7" catchup-source="&start={utc}" tvg-shift="3.5",International HD',
      '#EXTGRP:News',
      '#EXTVLCOPT:http-user-agent=My Smart TV',
      '#EXTVLCOPT:http-referrer=https://player.example.org/',
      '#KODIPROP:inputstream.adaptive.manifest_type=hls',
      'https://stream.example.org/hls.m3u8'
    ].join('\n');
    const channel=parseM3u(text).channels[0]!;
    expect(channel.name).toBe('International HD');
    expect(channel.group).toBe('News');
    expect(channel.iptv.channelNumber).toBe('17');
    expect(channel.iptv.radio).toBe(true);
    expect(channel.iptv.tvgShift).toBe('3.5');
    expect(channel.iptv.epgUrls).toContain('https://epg.example.org/guide.xml');
    expect(channel.iptv.catchup).toBe('append');
    expect(channel.iptv.catchupDays).toBe('7');
    expect(channel.iptv.userAgent).toBe('My Smart TV');
    expect(channel.iptv.referer).toBe('https://player.example.org/');
    expect(channel.iptv.kodiProps['inputstream.adaptive.manifest_type']).toBe('hls');
    const restored=parseM3u(toM3u([channel])).channels[0]!;
    expect(restored.iptv).toMatchObject({channelNumber:'17',radio:true,catchup:'append',catchupDays:'7',userAgent:'My Smart TV',referer:'https://player.example.org/'});
    expect(restored.iptv.kodiProps).toEqual(channel.iptv.kodiProps);
  });
  it('takes only allowed HTTP hints out of EXHTTP and ignores private headers',()=>{
    const c=parseM3u([
      '#EXTM3U',
      '#EXTINF:-1,Test',
      '#EXTHTTP:{"User-Agent":"Player/1","Referer":"https://ref.example.org/","Authorization":"secret","Cookie":"private"}',
      'https://media.example.org/live.m3u8'
    ].join('\n')).channels[0]!;
    expect(c.iptv.userAgent).toBe('Player/1');
    expect(c.iptv.referer).toBe('https://ref.example.org/');
    expect(JSON.stringify(c.iptv)).not.toContain('secret');
    expect(JSON.stringify(c.iptv)).not.toContain('private');
  });
  it('reads pipe-style headers without changing the stream address',()=>{
    const c=parseM3u('#EXTINF:-1,Music\nhttps://media.example.org/live.m3u8|User-Agent=App%2F1&Referer=https%3A%2F%2Fref.example.org%2F').channels[0]!;
    expect(c.url).toBe('https://media.example.org/live.m3u8');
    expect(c.iptv.userAgent).toBe('App/1');
    expect(c.iptv.referer).toBe('https://ref.example.org/');
  });
  it('does not leak group or VLC options to a following station',()=>{
    const [a,b]=parseM3u([
      '#EXTINF:-1,Station A','#EXTGRP:Sports','#EXTVLCOPT:http-user-agent=A','https://media.example.org/a.m3u8',
      '#EXTINF:-1,Station B','https://media.example.org/b.m3u8'
    ].join('\n')).channels;
    expect(a?.group).toBe('Sports');
    expect(a?.iptv.userAgent).toBe('A');
    expect(b?.group).toBe('');
    expect(b?.iptv.userAgent).toBe('');
  });
});

describe('Kodi IPTV interoperability',()=>{
  it('allows a Kodi stream hint without mistaking the catalog for an HLS manifest',()=>{
    const channels=parseM3u([
      '#EXTM3U',
      '#EXTINF:-1,Example VOD',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      'https://media.example.org/movie.mkv'
    ].join('\n')).channels;
    expect(channels).toHaveLength(1);
    expect(channels[0]?.name).toBe('Example VOD');
  });
});
