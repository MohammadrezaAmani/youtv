import {describe,expect,it} from 'vitest';
import {parseYouTubeUrl,transcriptSegmentsToVtt} from './youtube';
import {extractInstagramPostHtml} from './instagram';
import {guessMediaKind} from './mediaDetector';
import {createYoutubeFetch,instagramFetchUrl,proxyDownloadUrl,proxyUrl} from '@/lib/proxy';
import {buildHlsArchiveEntries} from './hlsDownload';
import {buildDashArchiveEntries} from './dashDownload';

describe('Media Center URL classification',()=>{
  it('recognizes YouTube watch, Shorts, live, short and playlist URLs',()=>{
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abcdefghijk')).toEqual({kind:'video',id:'abcdefghijk'});
    expect(parseYouTubeUrl('https://youtu.be/abcdefghijk')).toEqual({kind:'video',id:'abcdefghijk'});
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/abcdefghijk')).toEqual({kind:'video',id:'abcdefghijk'});
    expect(parseYouTubeUrl('https://www.youtube.com/live/abcdefghijk')).toEqual({kind:'video',id:'abcdefghijk'});
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890ABCDEFGHIJ')).toEqual({kind:'playlist',id:'PL1234567890ABCDEFGHIJ'});
  });
  it('classifies common direct media formats and manifest MIME types',()=>{
    expect(guessMediaKind('https://cdn.example/video.mkv')).toBe('video');
    expect(guessMediaKind('https://cdn.example/video.avi')).toBe('video');
    expect(guessMediaKind('https://cdn.example/audio.flac')).toBe('audio');
    expect(guessMediaKind('https://cdn.example/image.webp')).toBe('image');
    expect(guessMediaKind('https://cdn.example/stream.php','application/vnd.apple.mpegurl')).toBe('hls');
    expect(guessMediaKind('https://cdn.example/stream.php','application/dash+xml')).toBe('dash');
    expect(guessMediaKind('https://cdn.example/file.bin','application/octet-stream')).toBe('file');
    expect(guessMediaKind('https://cdn.example/file','application/x-matroska')).toBe('video');
    expect(guessMediaKind('https://cdn.example/audio','audio/x-flac')).toBe('audio');
  });
  it('extracts video and image assets from public Instagram carousel JSON',()=>{
    const payload={xdt_shortcode_media:{media_type:8,caption:{text:'Public carousel'},carousel_media:[
      {media_type:2,video_versions:[{url:'https://scontent.cdninstagram.com/video-1.mp4',width:720,height:1280}]},
      {media_type:1,image_versions2:{candidates:[{url:'https://scontent.cdninstagram.com/image-small.jpg',width:320,height:320},{url:'https://scontent.cdninstagram.com/image-large.jpg',width:1080,height:1080}]}}
    ]}};
    const html=`<html><head><meta property="og:description" content="Public post"/></head><body><script type="application/json">${JSON.stringify(payload)}</script></body></html>`;
    const result=extractInstagramPostHtml(html,'https://www.instagram.com/p/ABC123/');
    expect(result?.assets).toHaveLength(2);
    expect(result?.assets[0]?.kind).toBe('video');
    expect(result?.assets[1]?.url).toBe('https://scontent.cdninstagram.com/image-large.jpg');
    expect(result?.caption).toBe('Public carousel');
  });
  it('uses Open Graph media as a fallback when Instagram embeds no JSON',()=>{
    const html='<html><head><meta property="og:video" content="https://scontent.cdninstagram.com/reel.mp4"><meta property="og:image" content="https://scontent.cdninstagram.com/thumb.jpg"></head></html>';
    const result=extractInstagramPostHtml(html,'https://www.instagram.com/reel/ABC123/');
    expect(result?.assets[0]?.kind).toBe('video');
    expect(result?.assets[0]?.url).toContain('reel.mp4');
  });
});



describe('YouTube transcript export',()=>{
  it('converts transcript segments to a valid WebVTT file',()=>{
    const vtt=transcriptSegmentsToVtt([
      {type:'TranscriptSegment',start_ms:'0',end_ms:'1250',snippet:{toString:()=> 'Hello world'}},
      {type:'TranscriptSegment',start_ms:'1250',end_ms:'2500',snippet:{toString:()=> 'Second line'}}
    ]);
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.250');
    expect(vtt).toContain('Hello world');
    expect(vtt).toContain('00:00:01.250 --> 00:00:02.500');
  });
});

describe('HLS offline archive',()=>{
  it('packages the selected video rendition, separate audio and subtitle playlists with local relative paths',async()=>{
    const worker={id:'hls-test',name:'HLS test',baseUrl:'https://worker.example',token:'',enabled:true};
    const original=globalThis.fetch;
    const videoPlaylist='#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4,\n'+proxyUrl('https://cdn.example/video/seg-1.ts',worker)+'\n#EXT-X-ENDLIST';
    const audioPlaylist='#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4,\n'+proxyUrl('https://cdn.example/audio/seg-1.aac',worker)+'\n#EXT-X-ENDLIST';
    const subtitlePlaylist='#EXTM3U\n#EXT-X-VERSION:7\n#EXTINF:4,\n'+proxyUrl('https://cdn.example/subtitles/seg-1.vtt',worker)+'\n#EXT-X-ENDLIST';
    const master=[
      '#EXTM3U','#EXT-X-VERSION:7',
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI=${JSON.stringify(proxyUrl('https://cdn.example/audio/index.m3u8',worker))}`,
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI=${JSON.stringify(proxyUrl('https://cdn.example/subtitles/index.m3u8',worker))}`,
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080,AUDIO="aud",SUBTITLES="subs"',
      proxyUrl('https://cdn.example/video/index.m3u8',worker)
    ].join('\n');
    globalThis.fetch=(async(input:RequestInfo|URL)=>{
      const requestUrl=new URL(input instanceof Request?input.url:String(input));
      const target=requestUrl.searchParams.get('url')||'';
      if(target==='https://origin.example/master.m3u8')return new Response(master,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
      if(target==='https://cdn.example/video/index.m3u8')return new Response(videoPlaylist,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
      if(target==='https://cdn.example/audio/index.m3u8')return new Response(audioPlaylist,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
      if(target==='https://cdn.example/subtitles/index.m3u8')return new Response(subtitlePlaylist,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
      if(target.includes('/seg-1.'))return new Response(new Uint8Array([1,2,3]),{status:200});
      throw new Error(`Unexpected HLS test request: ${requestUrl.toString()}`);
    }) as typeof fetch;
    try{
      const result=await buildHlsArchiveEntries('https://origin.example/master.m3u8',worker);
      const names=result.entries.map(entry=>entry.filename);
      expect(names).toContain('master.m3u8');
      expect(names).toContain('video/index.m3u8');
      expect(names).toContain('audio/English/index.m3u8');
      expect(names).toContain('subtitles/English/index.m3u8');
      expect(names).toContain('video/segments/000001.ts');
      const masterEntry=result.entries.find(entry=>entry.filename==='master.m3u8')!;
      const text=await new Response(await masterEntry.open()).text();
      expect(text).toContain('URI="audio/English/index.m3u8"');
      expect(text).toContain('URI="subtitles/English/index.m3u8"');
      expect(text).toContain('video/index.m3u8');
      expect(result.segments).toBe(3);
    }finally{globalThis.fetch=original;}
  });
  it('archives AES-128 keys, initialization byte ranges and implicit segment byte ranges',async()=>{
    const worker={id:'hls-range',name:'HLS range',baseUrl:'https://worker.example',token:'',enabled:true};
    const original=globalThis.fetch;const fileUrl='https://cdn.example/media.mp4';const requests:string[]=[];
    const manifest=[
      '#EXTM3U','#EXT-X-VERSION:7',
      `#EXT-X-KEY:METHOD=AES-128,URI=${JSON.stringify(proxyUrl('https://cdn.example/key.bin',worker))}`,
      `#EXT-X-MAP:URI=${JSON.stringify(proxyUrl(fileUrl,worker))},BYTERANGE="100@0"`,
      '#EXTINF:4,','#EXT-X-BYTERANGE:100@100',proxyUrl(fileUrl,worker),
      '#EXTINF:4,','#EXT-X-BYTERANGE:100',proxyUrl(fileUrl,worker),'#EXT-X-ENDLIST'
    ].join('\n');
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=new URL(input instanceof Request?input.url:String(input));const target=url.searchParams.get('url')||'';
      if(target==='https://origin.example/live.m3u8')return new Response(manifest,{status:200});
      if(target==='https://cdn.example/key.bin')return new Response(new Uint8Array([9,8,7]),{status:200});
      if(target===fileUrl){requests.push(new Headers(init?.headers).get('Range')||'');return new Response(new Uint8Array(100),{status:206,headers:{'Content-Range':'bytes 0-99/1000'}});}
      throw new Error(`Unexpected HLS range request: ${url}`);
    }) as typeof fetch;
    try{
      const result=await buildHlsArchiveEntries('https://origin.example/live.m3u8',worker);
      expect(result.liveSnapshot).toBe(false);
      expect(result.entries.map(item=>item.filename)).not.toContain('ARCHIVE-INFO.txt');
      expect(result.entries.map(item=>item.filename)).toContain('keys/key-1.bin');
      const playlist=result.entries.find(item=>item.filename==='playlist.m3u8')!;
      const text=await new Response(await playlist.open()).text();
      expect(text).toContain('URI="keys/key-1.bin"');
      expect(text).toContain('URI="init-1.mp4"');
      expect(text).not.toContain('BYTERANGE');
      for(const entry of result.entries.filter(item=>item.filename.endsWith('.mp4')||item.filename.endsWith('.ts'))){const stream=await entry.open();await new Response(stream).arrayBuffer();}
      expect(requests).toEqual(['bytes=0-99','bytes=100-199','bytes=200-299']);
    }finally{globalThis.fetch=original;}
  });
});


describe('DASH offline archive' ,()=>{
  const worker={id:'dash-test',name:'DASH test',baseUrl:'https://worker.example',token:'',enabled:true};
  it('merges inherited SegmentTemplate attributes and preserves local RepresentationID/Number templates',async()=>{
    const original=globalThis.fetch;
    const mpd=`<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S"><Period><BaseURL>https://cdn.example/vod/</BaseURL><AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1" duration="4" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/$Number%06d$.m4s" startNumber="12"/><Representation id="v1" bandwidth="1000000"/></AdaptationSet></Period></MPD>`;
    globalThis.fetch=(async(input:RequestInfo|URL)=>{
      const requestUrl=new URL(input instanceof Request?input.url:String(input));
      if(requestUrl.searchParams.get('url')==='https://origin.example/manifest.mpd')return new Response(mpd,{status:200,headers:{'Content-Type':'application/dash+xml'}});
      return new Response(new Uint8Array([1,2,3]),{status:200});
    }) as typeof fetch;
    try{
      const result=await buildDashArchiveEntries('https://origin.example/manifest.mpd',worker);
      expect(result.entries.map(item=>item.filename)).toContain('period-1/adaptation-1/v1/init.mp4');
      expect(result.entries.map(item=>item.filename)).toContain('period-1/adaptation-1/v1/segment-000001.m4s');
      const manifest=await new Response(await result.entries[0]!.open()).text();
      expect(manifest).toContain('media="period-1/adaptation-1/v1/segment-$Number%06d$.m4s"');
      expect(manifest).toContain('startNumber="1"');
      expect(result.segments).toBe(1);
    }finally{globalThis.fetch=original;}
  });
  it('archives SegmentBase single-file representations and keeps byte-range metadata',async()=>{
    const original=globalThis.fetch;
    const mpd=`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v1"><BaseURL>https://cdn.example/movie.mp4</BaseURL><SegmentBase indexRange="100-199"><Initialization range="0-99"/></SegmentBase></Representation></AdaptationSet></Period></MPD>`;
    globalThis.fetch=(async(input:RequestInfo|URL)=>{
      const requestUrl=new URL(input instanceof Request?input.url:String(input));
      if(requestUrl.searchParams.get('url')==='https://origin.example/manifest.mpd')return new Response(mpd,{status:200});
      return new Response(new Uint8Array([1,2,3]),{status:200});
    }) as typeof fetch;
    try{
      const result=await buildDashArchiveEntries('https://origin.example/manifest.mpd',worker);
      expect(result.entries.map(item=>item.filename)).toContain('period-1/adaptation-1/v1/base.mp4');
      const manifest=await new Response(await result.entries[0]!.open()).text();
      expect(manifest).toContain('<BaseURL>period-1/adaptation-1/v1/base.mp4</BaseURL>');
      expect(manifest).toContain('indexRange="100-199"');
    }finally{globalThis.fetch=original;}
  });
});

describe('Media Center Worker URL routing',()=>{
  const worker={id:'test',name:'Test Worker',baseUrl:'https://worker.example',token:'secret',enabled:true};
  it('routes YouTube API requests through the configured Worker and keeps POST bodies',async()=>{
    const original=globalThis.fetch;let capturedUrl='',capturedInit:RequestInit|undefined;
    globalThis.fetch=(async(input:any,init?:RequestInit)=>{capturedUrl=String(input);capturedInit=init;return new Response('{}',{status:200});}) as typeof fetch;
    try{
      const fetcher=createYoutubeFetch(worker);
      const response=await fetcher('https://www.youtube.com/youtubei/v1/player?key=public',{method:'POST',headers:{'Content-Type':'application/json','X-YouTube-Client-Name':'1'},body:'{"videoId":"abcdefghijk"}'});
      expect(response.status).toBe(200);
      const endpoint=new URL(capturedUrl);
      expect(endpoint.pathname).toBe('/youtube/fetch');
      expect(endpoint.searchParams.get('url')).toContain('/youtubei/v1/player');
      expect(endpoint.searchParams.get('key')).toBe('secret');
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.body).toBeInstanceOf(ArrayBuffer);
    }finally{globalThis.fetch=original;}
  });
  it('rejects non-YouTube hosts before sending a relay request',async()=>{
    const fetcher=createYoutubeFetch(worker);
    await expect(fetcher('https://example.com/youtubei/v1/player')).rejects.toThrow(/outside the supported relay scope/i);
  });
  it('builds public Instagram and attachment download routes through the same Worker',()=>{
    const instagram=new URL(instagramFetchUrl(worker,'https://www.instagram.com/reel/ABC123/'));
    expect(instagram.pathname).toBe('/instagram/fetch');
    expect(instagram.searchParams.get('key')).toBe('secret');
    expect(instagram.searchParams.get('url')).toContain('__a=1');
    const download=new URL(proxyDownloadUrl('https://cdn.example/video.mkv',worker,'video.mkv'));
    expect(download.pathname).toBe('/proxy');
    expect(download.searchParams.get('download')).toBe('1');
    expect(download.searchParams.get('filename')).toBe('video.mkv');
  });
});
