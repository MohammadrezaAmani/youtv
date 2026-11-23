import { describe, expect, it } from 'vitest';
import { rewriteHls, isHls } from '../src/hls.ts';
import { assertAllowedUrl, assertToken, allowedOrigin, ProxyError } from '../src/security.ts';
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


describe('public-host wildcard + secure destination filtering',()=>{
  const open={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:'',PROXY_TOKEN:''};
  it('accepts any public DNS hostname with a literal * and with no ALLOWED_HOSTS',()=>{
    expect(assertAllowedUrl('https://live.presstv.co.uk/hls/ifilmfa.m3u8',open).hostname).toBe('live.presstv.co.uk');
    expect(assertAllowedUrl('https://segments.cdn.example.org/v1.ts',{...open,ALLOWED_HOSTS:''}).hostname).toBe('segments.cdn.example.org');
    expect(assertAllowedUrl('https://static.example.com/a',{...open,ALLOWED_HOSTS:undefined}).hostname).toBe('static.example.com');
  });
  it('keeps exact and subdomain restrictions when explicitly configured',()=>{
    const restricted={...open,ALLOWED_HOSTS:'live.presstv.co.uk,*.example.com'};
    expect(assertAllowedUrl('https://a.example.com/a',restricted).hostname).toBe('a.example.com');
    expect(()=>assertAllowedUrl('https://evil.example.net/',restricted)).toThrowError(/host/i);
  });
  it('denies local and IP literals even with wildcard *',()=>{
    for(const url of [
      'http://localhost:8000/', 'http://sub.localhost/', 'http://intranet.local/',
      'http://service.internal/', 'http://127.0.0.1/', 'http://169.254.169.254/',
      'http://[::1]/', 'http://0x7f000001/', 'file:///etc/passwd',
      'https://name:pass@valid.example.com/'
    ]) expect(()=>assertAllowedUrl(url,open),url).toThrow(ProxyError);
  });
});

describe('browser origin defaults and optional token',()=>{
  const env={ALLOWED_HOSTS:'*',ALLOWED_ORIGINS:''};
  const req=(origin:string)=>new Request('https://example.workers.dev/proxy',{headers:{Origin:origin}});
  it('accepts deployed GitHub Pages origin without configuration',()=>{
    expect(allowedOrigin(req('https://mohammadrezaamani.github.io'),env)).toBe('https://mohammadrezaamani.github.io');
  });
  it('accepts localhost, 127.0.0.1 and IPv6 loopback on arbitrary ports',()=>{
    for(const origin of ['http://localhost:5173','http://localhost:3000','https://localhost:1234','http://127.0.0.1:4173','http://[::1]:5000'])
      expect(allowedOrigin(req(origin),env)).toBe(origin);
  });
  it('rejects lookalikes, invalid origins and unrelated websites',()=>{
    for(const origin of ['null','https://mohammadrezaamani.github.io.evil.com','http://localhost.evil.com','https://evil.com','file://example.com','https://localhost:3456/foo'])
      expect(allowedOrigin(req(origin),env)).toBeNull();
  });
  it('allows extra origins additively and supports explicit *',()=>{
    expect(allowedOrigin(req('https://other.example.com'),{...env,ALLOWED_ORIGINS:'https://other.example.com'})).toBe('https://other.example.com');
    expect(allowedOrigin(req('https://mohammadrezaamani.github.io'),{...env,ALLOWED_ORIGINS:'https://other.example.com'})).not.toBeNull();
    expect(allowedOrigin(req('https://other.example.com'),{...env,ALLOWED_ORIGINS:'*'})).not.toBeNull();
  });
  it('does not require a key unless the secret is set, including short secrets',()=>{
    expect(()=>assertToken(null,{...env,PROXY_TOKEN:''})).not.toThrow();
    expect(()=>assertToken('',{...env,PROXY_TOKEN:undefined})).not.toThrow();
    expect(()=>assertToken(null,{...env,PROXY_TOKEN:'actual-secret'})).toThrowError(/token/i);
    expect(()=>assertToken('actual-secret',{...env,PROXY_TOKEN:'actual-secret'})).not.toThrow();
    expect(()=>assertToken('wrong',{...env,PROXY_TOKEN:'actual-secret'})).toThrow(ProxyError);
  });
  it('does not place an empty key on nested playlists or segments',()=>{
    const result=rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts',source,proxy,'');
    const urls=[result.match(/URI="([^"]+)"/)?.[1],result.split('\n')[3]];
    for(const url of urls){expect(url).toBeDefined();expect(new URL(url!).searchParams.has('key')).toBe(false);}
  });
});
