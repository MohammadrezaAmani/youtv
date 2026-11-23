import { describe, expect, it } from 'vitest';
import { rewriteHls, isHls } from '../src/hls.ts';
import { assertAllowedUrl, ProxyError } from '../src/security.ts';
const source = new URL('https://live.example.com/hls/ch/main.m3u8?auth=abcd');
const proxy = new URL('https://proxy.example.workers.dev/proxy');
const token='a-token';
const target = (line:string) => new URL(line).searchParams.get('url');

describe('HLS manifest rewrite',()=>{
  it('rewrites relative playlist media and key URI',()=>{
    const input = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin?x=1"\n#EXTINF:4,\nsegment0001.ts\n';
    const result = rewriteHls(input,source,proxy,token).split('\n');
    expect(target(result[1]!.match(/URI="([^"]+)"/)![1]!)).toBe('https://live.example.com/hls/key.bin?x=1');
    expect(target(result[3]!)).toBe('https://live.example.com/hls/ch/segment0001.ts');
    expect(new URL(result[3]!).searchParams.get('key')).toBe(token);
  });
  it('rewrites LL-HLS part and alternate audio',()=>{
    const input='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/eng.m3u8"\n#EXT-X-PART:DURATION=0.3,URI="part1.m4s"';
    const result=rewriteHls(input,source,proxy,token);
    expect(result).toContain('https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Faudio%2Feng.m3u8');
    expect(result).toContain('https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Fpart1.m4s');
  });
  it('rejects not-HLS input',()=>expect(()=>rewriteHls('hello',source,proxy,token)).toThrow());
  it('detects HLS from path and mime',()=>{
    expect(isHls(source,'application/octet-stream')).toBe(true);
    expect(isHls(new URL('https://a.test/live?id=123'),'application/vnd.apple.mpegurl')).toBe(true);
  });
});

describe('allowed destinations',()=>{
  const env={ALLOWED_HOSTS:'live.example.com,*.example.net',ALLOWED_ORIGINS:'https://user.github.io',PROXY_TOKEN:'x'.repeat(32)};
  it('permits explicit hosts',()=>expect(assertAllowedUrl(source.toString(),env).hostname).toBe('live.example.com'));
  it('permits explicitly wildcarded subdomains',()=>expect(assertAllowedUrl('https://a.example.net/x',env).hostname).toBe('a.example.net'));
  it('rejects private IP and unrelated hosts',()=>{
    expect(()=>assertAllowedUrl('http://127.0.0.1/admin',env)).toThrow(ProxyError);
    expect(()=>assertAllowedUrl('https://evil.com/segment',env)).toThrow(ProxyError);
  });
});

describe('IPTV HTTP hints',()=>{
  it('keeps approved hints on each proxied segment and nested playlist',()=>{
    const result=rewriteHls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd.m3u8\n#EXTINF:4,\nvideo01.ts',source,proxy,token,{userAgent:'smartlabs',referer:'https://player.example.org/'});
    for(const line of result.split('\n').filter(v=>v.startsWith('https://'))){
      const url=new URL(line);
      expect(url.searchParams.get('ua')).toBe('smartlabs');
      expect(url.searchParams.get('ref')).toBe('https://player.example.org/');
    }
  });
});
