import { describe, expect, it } from "vitest";
import {
  rewriteHls,
  isHls,
  parseHlsVariables,
  rewriteSteeringJson,
} from "../src/hls.ts";
import {
  assertAllowedUrl,
  assertToken,
  allowedOrigin,
  ProxyError,
} from "../src/security.ts";
const source = new URL("https://live.example.com/hls/ch/main.m3u8?auth=abcd");
const proxy = new URL("https://proxy.example.workers.dev/proxy");
const token = "a-token";
const target = (line: string) => new URL(line).searchParams.get("url");

describe("HLS manifest rewrite", () => {
  it("rewrites relative playlist media and key URI", () => {
    const input =
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin?x=1"\n#EXTINF:4,\nsegment0001.ts\n';
    const result = rewriteHls(input, source, proxy, token).split("\n");
    expect(target(result[1]!.match(/URI="([^"]+)"/)![1]!)).toBe(
      "https://live.example.com/hls/key.bin?x=1",
    );
    expect(target(result[3]!)).toBe(
      "https://live.example.com/hls/ch/segment0001.ts",
    );
    expect(new URL(result[3]!).searchParams.get("key")).toBe(token);
  });
  it("rewrites LL-HLS part and alternate audio", () => {
    const input =
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/eng.m3u8"\n#EXT-X-PART:DURATION=0.3,URI="part1.m4s"';
    const result = rewriteHls(input, source, proxy, token);
    expect(result).toContain(
      "https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Faudio%2Feng.m3u8",
    );
    expect(result).toContain(
      "https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Fpart1.m4s",
    );
  });
  it("passes through inline data URI keys/session metadata while proxying Telewebion-style media segments", () => {
    const manifest = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      '#EXT-X-SESSION-DATA:DATA-ID="com.example.payload",URI="data:application/json;base64,eyJvayI6dHJ1ZX0="',
      '#EXT-X-KEY:METHOD=AES-128,URI="data:application/octet-stream;base64,AQIDBA=="',
      "#EXT-X-TARGETDURATION:6",
      "#EXTINF:6,",
      "segment0001.ts?token=abc",
      "",
    ].join("\n");
    const result = rewriteHls(
      manifest,
      new URL("https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8"),
      proxy,
      "",
    );
    expect(result).toContain(
      'URI="data:application/json;base64,eyJvayI6dHJ1ZX0="',
    );
    expect(result).toContain(
      'URI="data:application/octet-stream;base64,AQIDBA=="',
    );
    const segment = result.split("\n")[6]!;
    expect(new URL(segment).searchParams.get("url")).toBe(
      "https://ncdn.telewebion.ir/hdtest/live/segment0001.ts?token=abc",
    );
    expect(new URL(segment).searchParams.has("key")).toBe(false);
  });
  it("leaves non-HTTP FairPlay key identifiers intact without accidentally proxying them", () => {
    const result = rewriteHls(
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://license.example/key-id"\n#EXTINF:4,\nfrag.ts',
      source,
      proxy,
      token,
    );
    expect(result).toContain('URI="skd://license.example/key-id"');
    expect(result).toContain(
      "https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Ffrag.ts",
    );
  });
  it("allows inline data media without leaking a proxy URL but rejects dangerous schemes", () => {
    const manifest = "#EXTM3U\n#EXTINF:1,\ndata:video/mp2t;base64,AQIDBA==";
    const result = rewriteHls(manifest, source, proxy, "");
    expect(result).toContain("data:video/mp2t;base64,AQIDBA==");
    for (const path of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://public.example/media.ts",
    ]) {
      expect(() =>
        rewriteHls(`#EXTM3U\n#EXTINF:2,\n${path}`, source, proxy, ""),
      ).toThrow(/Unsupported HLS URI scheme/);
    }
    expect(() =>
      rewriteHls(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="javascript:alert(1)"',
        source,
        proxy,
        "",
      ),
    ).toThrow(/Unsupported HLS URI scheme/);
  });
  it("preserves inline HLS data without proxying it", () => {
    const manifest =
      '#EXTM3U\n#EXT-X-SESSION-DATA:DATA-ID="meta",URI="data:application/json;base64,e30="\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://license/key"\n#EXTINF:3,\nseg.ts';
    const result = rewriteHls(manifest, source, proxy, "");
    expect(result).toContain('URI="data:application/json;base64,e30="');
    expect(result).toContain('URI="skd://license/key"');
    expect(result).toContain(
      "https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Fseg.ts",
    );
  });
  it("rejects executable and file HLS URI schemes", () => {
    for (const uri of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.org/file",
    ])
      expect(() =>
        rewriteHls(`#EXTM3U\n#EXTINF:1,\n${uri}`, source, proxy, ""),
      ).toThrow(/Unsupported HLS URI scheme/);
  });
  it("repairs missing hash in Telewebion master playlist", () => {
    const telewebion = new URL(
      "https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8",
    );
    const input =
      "#EXTM3U\nEXT-X-VERSION:6\n" +
      '#EXT-X-STREAM-INF:BANDWIDTH=2756600,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2",NAME="وضوح بالا (Full HD)"\n1080p/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1861200,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",NAME="وضوح متوسط (HD)"\n720p/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=1240800,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2",NAME="اقتصادی (480p)"\n480p/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=655600,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",NAME="وضوح کم (240p)"\n240p/index.m3u8';
    const output = rewriteHls(input, telewebion, proxy, "");
    const lines = output.split("\n");
    expect(lines[0]).toBe("#EXTM3U");
    expect(lines[1]).toBe("#EXT-X-VERSION:6");
    for (const quality of ["1080p", "720p", "480p", "240p"]) {
      const uri = lines.find(
        (line) =>
          line.startsWith("https://") &&
          new URL(line).searchParams.get("url")?.includes("/" + quality + "/"),
      );
      expect(uri, quality).toBeDefined();
      expect(new URL(uri!).searchParams.get("url")).toBe(
        "https://ncdn.telewebion.ir/hdtest/live/" + quality + "/index.m3u8",
      );
      expect(new URL(uri!).searchParams.has("key")).toBe(false);
    }
    expect(output).not.toContain("ext-x-version:");
  });
  it("normalizes bare HLS directives without proxying them as URLs", () => {
    const input =
      "#EXTM3U\nEXT-X-TARGETDURATION:6\nEXT-X-MEDIA-SEQUENCE:123\nEXTINF:6,\nsegment.ts\nEXT-X-ENDLIST";
    const output = rewriteHls(input, source, proxy, "");
    expect(output).toContain("#EXT-X-TARGETDURATION:6");
    expect(output).toContain("#EXT-X-MEDIA-SEQUENCE:123");
    expect(output).toContain("#EXTINF:6,");
    expect(output).toContain("#EXT-X-ENDLIST");
    expect(output).toContain(
      "https%3A%2F%2Flive.example.com%2Fhls%2Fch%2Fsegment.ts",
    );
  });
  it("resolves DEFINE variables before URI rewriting and propagates them to media playlists", () => {
    const text =
      '#EXTM3U\n#EXT-X-DEFINE:NAME="folder",VALUE="sub"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n{$folder}/level.m3u8';
    const output = rewriteHls(text, source, proxy, "");
    const nested = new URL(output.split("\n").at(-1)!);
    expect(nested.searchParams.get("url")).toBe(
      "https://live.example.com/hls/ch/sub/level.m3u8",
    );
    expect(parseHlsVariables(nested.searchParams.get("vars")).folder).toBe(
      "sub",
    );
  });
  it("proxies PREFETCH, Content Steering and LL-HLS attribute URI resources", () => {
    const text =
      '#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="steer.json"\n#EXT-X-PREFETCH:next.ts\n#EXT-X-PART:URI="part.m4s",DURATION=0.5';
    const output = rewriteHls(text, source, proxy, "");
    expect(output).toContain("steer=1");
    expect(output).toContain(
      "#EXT-X-PREFETCH:https://proxy.example.workers.dev/proxy?",
    );
    expect(output).toContain("part.m4s");
    expect(output).toContain("next.ts");
  });
  it("preserves proxy host for Content Steering pathway clones", () => {
    const upstream = new URL("https://live.example.com/hls/steer.json");
    const input = JSON.stringify({
      VERSION: 1,
      "PATHWAY-PRIORITY": ["clone"],
      "PATHWAY-CLONES": [
        {
          "BASE-ID": "base",
          ID: "clone",
          "URI-REPLACEMENT": { HOST: "cdn.example.net" },
        },
      ],
    });
    const transformed = JSON.parse(
      rewriteSteeringJson(input, upstream, proxy, ""),
    );
    expect(
      transformed["PATHWAY-CLONES"][0]["URI-REPLACEMENT"].HOST,
    ).toBeUndefined();
    expect(
      transformed["PATHWAY-CLONES"][0]["URI-REPLACEMENT"].PARAMS._youtv_steer,
    ).toContain("cdn.example.net");
  });
  it("rejects not-HLS input", () =>
    expect(() => rewriteHls("hello", source, proxy, token)).toThrow());
  it("detects HLS from path and mime", () => {
    expect(isHls(source, "application/octet-stream")).toBe(true);
    expect(
      isHls(
        new URL("https://a.test/live?id=123"),
        "application/vnd.apple.mpegurl",
      ),
    ).toBe(true);
  });
});

describe("allowed destinations", () => {
  const env = {
    ALLOWED_HOSTS: "live.example.com,*.example.net",
    ALLOWED_ORIGINS: "https://mohammadrezaamani.github.io",
    PROXY_TOKEN: "x".repeat(32),
  };
  it("permits explicit hosts", () =>
    expect(assertAllowedUrl(source.toString(), env).hostname).toBe(
      "live.example.com",
    ));
  it("permits explicitly wildcarded subdomains", () =>
    expect(assertAllowedUrl("https://a.example.net/x", env).hostname).toBe(
      "a.example.net",
    ));
  it("rejects private IP and unrelated hosts", () => {
    expect(() => assertAllowedUrl("http://127.0.0.1/admin", env)).toThrow(
      ProxyError,
    );
    expect(() => assertAllowedUrl("https://evil.com/segment", env)).toThrow(
      ProxyError,
    );
  });
});

describe("IPTV HTTP hints", () => {
  it("keeps approved hints on each proxied segment and nested playlist", () => {
    const result = rewriteHls(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd.m3u8\n#EXTINF:4,\nvideo01.ts",
      source,
      proxy,
      token,
      { userAgent: "smartlabs", referer: "https://player.example.org/" },
    );
    for (const line of result
      .split("\n")
      .filter((v) => v.startsWith("https://"))) {
      const url = new URL(line);
      expect(url.searchParams.get("ua")).toBe("smartlabs");
      expect(url.searchParams.get("ref")).toBe("https://player.example.org/");
    }
  });
});

describe("public-host wildcard + secure destination filtering", () => {
  const open = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "", PROXY_TOKEN: "" };
  it("accepts any public DNS hostname with a literal * and with no ALLOWED_HOSTS", () => {
    expect(
      assertAllowedUrl("https://live.presstv.co.uk/hls/ifilmfa.m3u8", open)
        .hostname,
    ).toBe("live.presstv.co.uk");
    expect(
      assertAllowedUrl("https://segments.cdn.example.org/v1.ts", {
        ...open,
        ALLOWED_HOSTS: "",
      }).hostname,
    ).toBe("segments.cdn.example.org");
    expect(
      assertAllowedUrl("https://static.example.com/a", {
        ...open,
        ALLOWED_HOSTS: undefined,
      }).hostname,
    ).toBe("static.example.com");
  });
  it("keeps exact and subdomain restrictions when explicitly configured", () => {
    const restricted = {
      ...open,
      ALLOWED_HOSTS: "live.presstv.co.uk,*.example.com",
    };
    expect(
      assertAllowedUrl("https://a.example.com/a", restricted).hostname,
    ).toBe("a.example.com");
    expect(() =>
      assertAllowedUrl("https://evil.example.net/", restricted),
    ).toThrowError(/host/i);
  });
  it("denies local and IP literals even with wildcard *", () => {
    for (const url of [
      "http://localhost:8000/",
      "http://sub.localhost/",
      "http://intranet.local/",
      "http://service.internal/",
      "http://127.0.0.1/",
      "http://169.254.169.254/",
      "http://[::1]/",
      "http://0x7f000001/",
      "file:///etc/passwd",
      "https://name:pass@valid.example.com/",
    ])
      expect(() => assertAllowedUrl(url, open), url).toThrow(ProxyError);
  });
});

describe("browser origin defaults and optional token", () => {
  const env = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "" };
  const req = (origin: string) =>
    new Request("https://example.workers.dev/proxy", {
      headers: { Origin: origin },
    });
  it("accepts deployed GitHub Pages origin without configuration", () => {
    expect(allowedOrigin(req("https://mohammadrezaamani.github.io"), env)).toBe(
      "https://mohammadrezaamani.github.io",
    );
  });
  it("accepts localhost, 127.0.0.1 and IPv6 loopback on arbitrary ports", () => {
    for (const origin of [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://localhost:1234",
      "http://127.0.0.1:4173",
      "http://[::1]:5000",
    ])
      expect(allowedOrigin(req(origin), env)).toBe(origin);
  });
  it("rejects lookalikes, invalid origins and unrelated websites", () => {
    for (const origin of [
      "null",
      "https://mohammadrezaamani.github.io.evil.com",
      "http://localhost.evil.com",
      "https://evil.com",
      "file://example.com",
      "https://localhost:3456/foo",
    ])
      expect(allowedOrigin(req(origin), env)).toBeNull();
  });
  it("allows extra origins additively and supports explicit *", () => {
    expect(
      allowedOrigin(req("https://other.example.com"), {
        ...env,
        ALLOWED_ORIGINS: "https://other.example.com",
      }),
    ).toBe("https://other.example.com");
    expect(
      allowedOrigin(req("https://mohammadrezaamani.github.io"), {
        ...env,
        ALLOWED_ORIGINS: "https://other.example.com",
      }),
    ).not.toBeNull();
    expect(
      allowedOrigin(req("https://other.example.com"), {
        ...env,
        ALLOWED_ORIGINS: "*",
      }),
    ).not.toBeNull();
  });
  it("does not require a key unless the secret is set, including short secrets", () => {
    expect(() => assertToken(null, { ...env, PROXY_TOKEN: "" })).not.toThrow();
    expect(() =>
      assertToken("", { ...env, PROXY_TOKEN: undefined }),
    ).not.toThrow();
    expect(() =>
      assertToken(null, { ...env, PROXY_TOKEN: "actual-secret" }),
    ).toThrowError(/token/i);
    expect(() =>
      assertToken("actual-secret", { ...env, PROXY_TOKEN: "actual-secret" }),
    ).not.toThrow();
    expect(() =>
      assertToken("wrong", { ...env, PROXY_TOKEN: "actual-secret" }),
    ).toThrow(ProxyError);
  });
  it("does not place an empty key on nested playlists or segments", () => {
    const result = rewriteHls(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts',
      source,
      proxy,
      "",
    );
    const urls = [result.match(/URI="([^"]+)"/)?.[1], result.split("\n")[3]];
    for (const url of urls) {
      expect(url).toBeDefined();
      expect(new URL(url!).searchParams.has("key")).toBe(false);
    }
  });
});

describe("plain HTTP sources through HTTPS worker", () => {
  const open = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "", PROXY_TOKEN: "" };
  const http = new URL("http://media.example.com:8080/live/master.m3u8");
  it("allows a public HTTP hostname without upgrading the upstream source", () => {
    expect(assertAllowedUrl(http.href, open).href).toBe(http.href);
  });
  it("rewrites HTTP playlists, segments and encryption keys back into HTTPS Worker URLs", () => {
    const input =
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nvariant/720p.m3u8\n#EXTINF:6,\nsegment0.ts';
    const output = rewriteHls(input, http, proxy, "");
    expect(output).not.toContain('URI="http://');
    expect(
      output.split("\n").filter((s) => s.startsWith("https://")),
    ).toHaveLength(2);
    expect(output).toContain("http%3A%2F%2Fmedia.example.com%3A8080");
    expect(output).not.toContain("key=");
    expect(output).toContain('URI="https://');
  });
  it("rejects private addresses and direct IP literals (Cloudflare fetch limitation)", () => {
    for (const raw of [
      "http://127.0.0.1:80/x",
      "http://192.168.0.1/x",
      "http://1.1.1.1/x",
    ])
      expect(() => assertAllowedUrl(raw, open)).toThrow(ProxyError);
  });
});
