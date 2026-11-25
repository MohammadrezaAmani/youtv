/** Zero-dependency functional smoke tests (Bun native test runner). */
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import { rewriteHls } from "../src/hls.ts";
import { assertAllowedUrl } from "../src/security.ts";
const key = "0123456789abcdefghijklmnopqrstuvwxyz";
const env = {
  ALLOWED_HOSTS: "media.example.com,*.cdn.example.com",
  ALLOWED_ORIGINS: "https://mohammadrezaamani.github.io,http://localhost:5173",
  PROXY_TOKEN: key,
  UPSTREAM_REFERER: "",
};
const endpoint = "https://youtv.workers.dev/proxy";
const input = "https://media.example.com/tv/index.m3u8?sig=abc";
function req(source = input, origin = "https://mohammadrezaamani.github.io") {
  const u = new URL(endpoint);
  u.searchParams.set("url", source);
  u.searchParams.set("key", key);
  return new Request(u.toString(), { headers: { Origin: origin } });
}

test("only public uncredentialed images get browser freshness; HLS stays network-only", async (t) => {
  const old = globalThis.fetch;
  t.after(() => { globalThis.fetch = old; });
  const target = new URL(endpoint);
  const publicEnv = { ALLOWED_HOSTS: "*" };
  target.searchParams.set("url", "https://media.example.com/logo.png");
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
  const publicResponse = await worker.fetch(new Request(target), publicEnv);
  assert.equal(publicResponse.headers.get("Cache-Control"), "public, max-age=3600");
  target.searchParams.set("url", "https://media.example.com/logo.png?token=secret");
  assert.equal((await worker.fetch(new Request(target), publicEnv)).headers.get("Cache-Control"), "no-store");
  target.searchParams.set("url", "https://media.example.com/logo.png");
  globalThis.fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
  assert.equal((await worker.fetch(new Request(target), publicEnv)).headers.get("Cache-Control"), "no-store");
  globalThis.fetch = async () => new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n", {
    headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "public, max-age=3600" },
  });
  target.searchParams.set("url", "https://media.example.com/live.m3u8");
  assert.equal((await worker.fetch(new Request(target), publicEnv)).headers.get("Cache-Control"), "no-store");
});

test("HLS rewrites nested playlists, segments, key and map URIs", () => {
  const manifest =
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:URI="../key",METHOD=AES-128\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nsub/720p.m3u8\n#EXTINF:5,\nsegment.ts\n';
  const rewritten = rewriteHls(
    manifest,
    new URL(input),
    new URL(endpoint),
    key,
  );
  const lines = rewritten.split("\n");
  for (const i of [1, 2, 4, 6])
    assert.match(lines[i], /youtv\.workers\.dev\/proxy\?/);
  assert.ok(rewritten.includes("init.mp4"));
  assert.ok(rewritten.includes("720p.m3u8"));
});
test("SSRF guard requires allowlist and rejects IP literals", () => {
  assert.equal(assertAllowedUrl(input, env).hostname, "media.example.com");
  for (const url of ["http://127.0.0.1/", "https://evil.com/", "http://[::1]/"])
    assert.throws(() => assertAllowedUrl(url, env));
});
test("worker manifest response honors CORS and rewrite", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, _opts) =>
    new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n", {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const result = await worker.fetch(req(), env);
  assert.equal(result.status, 200);
  assert.equal(
    result.headers.get("Access-Control-Allow-Origin"),
    "https://mohammadrezaamani.github.io",
  );
  const s = await result.text();
  assert.ok(s.includes("seg0.ts"));
  assert.ok(s.includes("youtv.workers.dev/proxy?"));
});
test("Worker keeps inline HLS metadata/keys, rewrites real URLs and returns CORS success", async (t) => {
  const previous = globalThis.fetch;
  const realSource = "https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8";
  const manifest = [
    "#EXTM3U",
    '#EXT-X-SESSION-DATA:DATA-ID="com.example.test",URI="data:application/json;base64,eyJvayI6dHJ1ZX0="',
    '#EXT-X-KEY:METHOD=AES-128,URI="data:application/octet-stream;base64,AQID"',
    "#EXTINF:5,",
    "seg-001.ts",
    "",
  ].join("\n");
  globalThis.fetch = async () =>
    new Response(manifest, {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    });
  t.after(() => {
    globalThis.fetch = previous;
  });
  const url = new URL(endpoint);
  url.searchParams.set("url", realSource);
  url.searchParams.set("hls", "1");
  const response = await worker.fetch(
    new Request(url, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    { ALLOWED_HOSTS: "*" },
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://mohammadrezaamani.github.io",
  );
  const output = await response.text();
  assert.ok(
    output.includes('URI="data:application/json;base64,eyJvayI6dHJ1ZX0="'),
  );
  assert.ok(output.includes('URI="data:application/octet-stream;base64,AQID"'));
  const segment = output.split("\n")[4];
  assert.equal(
    new URL(segment).searchParams.get("url"),
    "https://ncdn.telewebion.ir/hdtest/live/seg-001.ts",
  );
});
test("binary data and HTTP 206 are passed through without modification", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array([4, 1, 9]), {
      status: 206,
      headers: {
        "Content-Range": "bytes 0-2/100",
        "Content-Type": "video/mp2t",
      },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const response = await worker.fetch(
    req("https://media.example.com/a.ts"),
    env,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-2/100");
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [4, 1, 9],
  );
});
test("worker rejects bad origin and bad credentials", async () => {
  const noOrigin = await worker.fetch(
    req(input, "https://attacker.example"),
    env,
  );
  assert.equal(noOrigin.status, 403);
  const url = new URL(req().url);
  url.searchParams.set("key", "wrong");
  const noAuth = await worker.fetch(
    new Request(url, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    env,
  );
  assert.equal(noAuth.status, 401);
});
test("worker enforces redirect allowlist", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://untrusted.example/private" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const result = await worker.fetch(req(), env);
  assert.equal(result.status, 403);
});

test("extensionless HLS URLs are rewritable with explicit hls hint", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nchunk-a.ts\n", {
      headers: { "Content-Type": "application/octet-stream" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const url = new URL(req("https://media.example.com/stream?id=123").url);
  url.searchParams.set("hls", "1");
  const result = await worker.fetch(
    new Request(url, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    env,
  );
  assert.equal(result.status, 200);
  assert.match(await result.text(), /youtv\.workers\.dev\/proxy\?/);
});
test("Teletext/plain-text endpoint uses allowlist, auth and CORS without script execution", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("TELETEXT PAGE 100\nNEWS", {
      headers: { "Content-Type": "text/plain" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const u = new URL("https://youtv.workers.dev/text");
  u.searchParams.set("url", "https://media.example.com/teletext/100.txt");
  u.searchParams.set("key", key);
  const response = await worker.fetch(
    new Request(u, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "TELETEXT PAGE 100\nNEWS");
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://mohammadrezaamani.github.io",
  );
});
test("Teletext plaintext endpoint rejects unapproved destination", async () => {
  const u = new URL("https://youtv.workers.dev/text");
  u.searchParams.set("url", "https://unapproved.example/101.txt");
  u.searchParams.set("key", key);
  const response = await worker.fetch(
    new Request(u, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    env,
  );
  assert.equal(response.status, 403);
});

test("playlist import streams responses larger than the former 15 MB limit", async (t) => {
  const original = globalThis.fetch;
  const body =
    "#EXTM3U\n" +
    "#EXTINF:-1,TV\nhttps://example.org/live.m3u8\n".repeat(350_000);
  assert.ok(body.length > 15_000_000);
  globalThis.fetch = async () =>
    new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
      },
    });
  t.after(() => {
    globalThis.fetch = original;
  });
  const url = new URL("https://youtv.workers.dev/text");
  url.searchParams.set("url", "https://media.example.com/iptv.m3u");
  url.searchParams.set("key", key);
  const response = await worker.fetch(
    new Request(url, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.text()).length, body.length);
});

test("wildcard worker serves public stream with no configured secret", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("#EXTM3U\n#EXTINF:4,\nseg.ts\n", {
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const withoutSecret = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "" };
  const url = new URL("https://youtv.workers.dev/proxy");
  url.searchParams.set("url", "https://live.presstv.co.uk/hls/ifilmfa.m3u8");
  const response = await worker.fetch(
    new Request(url, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    withoutSecret,
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Access-Control-Allow-Origin"),
    "https://mohammadrezaamani.github.io",
  );
  const body = await response.text();
  assert.match(body, /seg.ts/);
  const segment = body.split("\n").find((line) => line.startsWith("https://"));
  assert.ok(segment);
  assert.equal(new URL(segment).searchParams.has("key"), false);
});

test("wildcard worker denies IP and local host even with no token", async () => {
  const open = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "" };
  for (const target of [
    "http://127.0.0.1/admin",
    "http://[::1]/",
    "http://metadata.google.internal/",
  ]) {
    const url = new URL("https://youtv.workers.dev/proxy");
    url.searchParams.set("url", target);
    const response = await worker.fetch(new Request(url), open);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "blocked_host");
  }
});

test("configured secret requires the correct key, including /probe and /text", async () => {
  const settings = {
    ALLOWED_HOSTS: "*",
    ALLOWED_ORIGINS: "",
    PROXY_TOKEN: "a-secret",
  };
  for (const route of ["proxy", "probe", "text"]) {
    const url = new URL("https://youtv.workers.dev/" + route);
    url.searchParams.set("url", input);
    const without = await worker.fetch(new Request(url), settings);
    assert.equal(without.status, 401);
    assert.equal((await without.json()).code, "unauthorized");
  }
});

test("redirects to private addresses remain blocked when ALLOWED_HOSTS=*", async (t) => {
  const old = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data/" },
    });
  t.after(() => {
    globalThis.fetch = old;
  });
  const url = new URL("https://youtv.workers.dev/proxy");
  url.searchParams.set("url", input);
  const response = await worker.fetch(new Request(url), {
    ALLOWED_HOSTS: "*",
    ALLOWED_ORIGINS: "",
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "blocked_host");
});

test("capabilities states whether worker access is passwordless or token-protected", async () => {
  const url = "https://youtv.workers.dev/capabilities";
  const open = await worker.fetch(new Request(url), {
    ALLOWED_HOSTS: "*",
    ALLOWED_ORIGINS: "",
  });
  assert.equal((await open.json()).authentication, "none");
  const secured = await worker.fetch(new Request(url), {
    ALLOWED_HOSTS: "*",
    ALLOWED_ORIGINS: "",
    PROXY_TOKEN: key,
  });
  assert.equal((await secured.json()).authentication, "query-token");
});

test("passwordless /probe, /text and CORS preflight work with localhost defaults", async (t) => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, options) =>
    options?.method === "HEAD"
      ? new Response(null, {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        })
      : new Response(
          "#EXTM3U\n#EXTINF:-1,Channel\nhttps://live.presstv.co.uk/hls/ifilmfa.m3u8\n",
        );
  t.after(() => {
    globalThis.fetch = previous;
  });
  const open = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "" };
  const origin = "http://localhost:32001";
  const path = (route) => {
    const url = new URL("https://youtv.workers.dev/" + route);
    url.searchParams.set("url", input);
    return url;
  };
  const options = await worker.fetch(
    new Request(path("proxy"), {
      method: "OPTIONS",
      headers: { Origin: origin },
    }),
    open,
  );
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Allow-Origin"), origin);
  const probe = await worker.fetch(
    new Request(path("probe"), { headers: { Origin: origin } }),
    open,
  );
  assert.equal(probe.status, 200);
  assert.equal((await probe.json()).status, 200);
  const textResponse = await worker.fetch(
    new Request(path("text"), { headers: { Origin: origin } }),
    open,
  );
  assert.equal(textResponse.status, 200);
  assert.match(await textResponse.text(), /#EXTM3U/);
  assert.equal(textResponse.headers.get("Access-Control-Allow-Origin"), origin);
  const health = await worker.fetch(
    new Request("https://youtv.workers.dev/health"),
    open,
  );
  assert.equal((await health.json()).version, "0.36.1");
});

// The Cloudflare installer in YouTV must not distribute an older Worker.
// This also catches future updates that forgot to synchronize the published file.
test("dashboard installer uses the same v0.36.1 Worker as the runtime", async () => {
  const fs = await import("node:fs");
  const runtime = fs.readFileSync(
    new URL("../dashboard-worker.mjs", import.meta.url),
    "utf8",
  );
  const published = fs.readFileSync(
    new URL("../../web/public/dashboard-worker.mjs", import.meta.url),
    "utf8",
  );
  const guide = fs.readFileSync(
    new URL(
      "../../web/src/features/proxy/CloudflareGuide.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(published, runtime);
  assert.match(published, /^\/\/ YouTV Worker bundle version: v0\.36\.1\n/);
  assert.match(guide, /^\s*const\s+WORKER_RELEASE\s*=\s*(["'])0\.36\.1\1\s*;?\s*$/m);
  assert.match(guide, /dashboard-worker\.mjs\?v=/);
  assert.match(guide, /YouTV-Worker-v/);
});

// Reproduces the exact server-side "ext-x-version:" rejection from Telewebion.
test("Telewebion malformed HLS master is served by /proxy", async (t) => {
  const manifest =
    "#EXTM3U\nEXT-X-VERSION:6\n" +
    '#EXT-X-STREAM-INF:BANDWIDTH=2756600,RESOLUTION=1920x1080,CODECS="avc1.4d4028,mp4a.40.2",NAME="وضوح بالا (Full HD)"\n1080p/index.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1861200,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",NAME="وضوح متوسط (HD)"\n720p/index.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=1240800,RESOLUTION=854x480,CODECS="avc1.4d401f,mp4a.40.2",NAME="اقتصادی (480p)"\n480p/index.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=655600,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2",NAME="وضوح کم (240p)"\n240p/index.m3u8';
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(manifest, {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    });
  t.after(() => {
    globalThis.fetch = previous;
  });
  const endpoint = new URL("https://youtv.workers.dev/proxy");
  endpoint.searchParams.set(
    "url",
    "https://ncdn.telewebion.ir/hdtest/live/playlist.m3u8",
  );
  endpoint.searchParams.set("hls", "1");
  const res = await worker.fetch(
    new Request(endpoint, {
      headers: { Origin: "https://mohammadrezaamani.github.io" },
    }),
    { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "", PROXY_TOKEN: "" },
  );
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    "https://mohammadrezaamani.github.io",
  );
  const rewritten = await res.text();
  assert.match(rewritten, /^#EXTM3U\n#EXT-X-VERSION:6\n/);
  for (const quality of ["1080p", "720p", "480p", "240p"])
    assert.ok(
      rewritten.includes(
        encodeURIComponent(
          "https://ncdn.telewebion.ir/hdtest/live/" + quality + "/index.m3u8",
        ),
      ),
      quality,
    );
  assert.doesNotMatch(rewritten, /^EXT-X-VERSION:/m);
});


test("Wikimedia image requests identify YouTV and preserve bytes and range", async (t) => {
  const previous = globalThis.fetch;
  const source = "https://upload.wikimedia.org/wikipedia/fa/thumb/9/94/Bushehr_TV.svg/500px-Bushehr_TV.svg.png";
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: new Headers(opts.headers) });
    return new Response(bytes, { status: 206, headers: {
      "Content-Type": "image/png", "Content-Range": "bytes 0-3/100",
    } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const target = new URL(req(source).url);
  target.searchParams.set("ua", "Mozilla/5.0");
  const response = await worker.fetch(new Request(target, { headers: {
    Origin: "https://mohammadrezaamani.github.io", Range: "bytes=0-3",
  } }), { ...env, ALLOWED_HOSTS: "*" });
  assert.equal(response.status, 206);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, source);
  assert.match(calls[0].headers.get("User-Agent"), /^YouTV\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/MohammadrezaAmani\/youtv\/issues\)$/);
  assert.equal(calls[0].headers.get("Range"), "bytes=0-3");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("Wikimedia identification is applied after redirects without changing other upstream hints", async (t) => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(new Headers(opts.headers).get("User-Agent"));
    if (calls.length === 1) return new Response(null, { status: 302, headers: {
      Location: "https://upload.wikimedia.org/wikipedia/commons/logo.png",
    } });
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const target = new URL(req("https://media.example.com/logo.png").url);
  target.searchParams.set("ua", "CustomIPTV/1.0");
  const response = await worker.fetch(new Request(target), { ...env, ALLOWED_HOSTS: "*" });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(calls.length, 2);
  assert.equal(calls[0], "CustomIPTV/1.0");
  assert.match(calls[1], /^YouTV\//);
});

test("Wikimedia rate limiting is returned with Retry-After without proxy retry", async (t) => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const response = await worker.fetch(req("https://upload.wikimedia.org/wikipedia/commons/logo.png"), { ...env, ALLOWED_HOSTS: "*" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.match(response.headers.get("Access-Control-Expose-Headers"), /Retry-After/);
  assert.equal(calls, 1);
  assert.equal(await response.text(), "Too many requests");
});


test("proxy forwards the real Chrome agent and safe request preferences", async (t) => {
  const previous = globalThis.fetch;
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const calls = [];
  globalThis.fetch = async (_url, opts) => {
    calls.push(new Headers(opts.headers));
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const target = new URL(req("https://media.example.com/logo.png").url);
  const response = await worker.fetch(new Request(target, { headers: {
    "User-Agent": ua, "Accept": "image/png,image/*;q=0.8", "Accept-Language": "fa,en;q=0.8",
    Cookie: "session=private", Authorization: "Bearer private",
  } }), env);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("User-Agent"), ua);
  assert.equal(calls[0].get("Accept"), "image/png,image/*;q=0.8");
  assert.equal(calls[0].get("Accept-Language"), "fa,en;q=0.8");
  assert.equal(calls[0].get("Cookie"), null);
  assert.equal(calls[0].get("Authorization"), null);
});

test("Wikimedia identifies the relay and retains the actual browser agent", async (t) => {
  const previous = globalThis.fetch;
  const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
  let sent;
  globalThis.fetch = async (_url, opts) => {
    sent = new Headers(opts.headers);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const target = new URL(req("https://upload.wikimedia.org/wikipedia/commons/logo.png").url);
  target.searchParams.set("ua", "MadeUpAgent/1.0");
  const response = await worker.fetch(new Request(target, { headers: { "User-Agent": ua } }), { ...env, ALLOWED_HOSTS: "*" });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.match(sent.get("User-Agent"), /^YouTV\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/MohammadrezaAmani\/youtv\/issues\) /);
  assert.ok(sent.get("User-Agent").endsWith(ua));
  assert.ok(!sent.get("User-Agent").includes("MadeUpAgent"));
});

test("proxy preserves explicit IPTV hints and identifies requests without a client agent", async (t) => {
  const previous = globalThis.fetch;
  const agents = [];
  globalThis.fetch = async (_url, opts) => {
    agents.push(new Headers(opts.headers).get("User-Agent"));
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
  };
  t.after(() => { globalThis.fetch = previous; });
  const target = new URL(req("https://media.example.com/logo.png").url);
  const plain = await worker.fetch(new Request(target), env);
  await plain.arrayBuffer();
  target.searchParams.set("ua", "IPTV/2.0");
  const explicit = await worker.fetch(new Request(target, { headers: { "User-Agent": "Browser/1.0" } }), env);
  await explicit.arrayBuffer();
  assert.match(agents[0], /^YouTV\//);
  assert.equal(agents[1], "IPTV/2.0");
});
