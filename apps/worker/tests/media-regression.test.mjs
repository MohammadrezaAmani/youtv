import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.ts";
import bundled from "../dashboard-worker.mjs";
import { rewriteDash, dashBaseTarget, dashRequestToken } from "../src/dash.ts";
const endpoint = "https://worker.example";
const env = {
  PROXY_TOKEN: "test-token",
  ALLOWED_HOSTS: "*",
  ALLOWED_ORIGINS: "https://mohammadrezaamani.github.io",
};
const url = (source, extra = {}) => {
  const u = new URL("/proxy", endpoint);
  u.searchParams.set("url", source);
  u.searchParams.set("key", env.PROXY_TOKEN);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u;
};
const extract = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, "g"))].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
const withFetch = async (mock, fn) => {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await fn();
  } finally {
    globalThis.fetch = previous;
  }
};

test("DASH relative segment resolution retains both relay context and authorization", () => {
  const mpd =
    '<MPD><BaseURL>https://cdn.example/live/?a=1&amp;b=2</BaseURL><Period><AdaptationSet><SegmentTemplate media="$RepresentationID$/$Number%06d$.m4s"/></AdaptationSet></Period></MPD>';
  const xml = rewriteDash(
    mpd,
    new URL("https://origin.example/stream.php"),
    new URL(endpoint),
    env.PROXY_TOKEN,
  );
  const [base] = extract(xml, "BaseURL");
  const segment = new URL("video/000012.m4s", base);
  assert.equal(dashRequestToken(segment), env.PROXY_TOKEN);
  assert.equal(
    dashBaseTarget(segment, env).toString(),
    "https://cdn.example/live/video/000012.m4s?a=1&b=2",
  );
  assert.match(xml, /\$Number%06d\$/);
});
test("DASH nested BaseURLs resolve against the preceding hierarchy, not the MPD source", () => {
  const mpd =
    '<MPD><BaseURL>https://cdn.example/main/</BaseURL><Period><BaseURL>period/</BaseURL><AdaptationSet><BaseURL>../video/</BaseURL><Representation id="v1"><BaseURL>track/</BaseURL></Representation></AdaptationSet></Period></MPD>';
  const xml = rewriteDash(
    mpd,
    new URL("https://origin.example/m.mpd"),
    new URL(endpoint),
  );
  const bases = extract(xml, "BaseURL");
  assert.equal(
    dashBaseTarget(new URL("seg.m4s", bases.at(-1)), {}).href,
    "https://cdn.example/main/video/track/seg.m4s",
  );
});
test("DASH absolute templates retain query substitutions and XML escapes", () => {
  const xml = rewriteDash(
    '<MPD><Period><SegmentTemplate media="https://cdn.example/$RepresentationID$/seg-$Number%06d$.m4s?a=$Bandwidth$&amp;b=2"/></Period></MPD>',
    new URL("https://origin.example/a.mpd"),
    new URL(endpoint),
  );
  const media = xml.match(/media="([^"]+)"/)[1];
  assert.match(media, /&amp;b=2/);
  const expanded = media
    .replace(/&amp;/g, "&")
    .replace("$RepresentationID$", "v1")
    .replace("$Number%06d$", "000001")
    .replace("$Bandwidth$", "1000");
  assert.equal(
    dashBaseTarget(new URL(expanded), {}).href,
    "https://cdn.example/v1/seg-000001.m4s?a=1000&b=2",
  );
});
test("MPD returned with a legacy HLS hint is correctly detected by both source and bundle", async () => {
  const mpd =
    '<MPD type="dynamic"><BaseURL>https://cdn.example/live/</BaseURL><Location>https://origin.example/next.mpd</Location><Period/></MPD>';
  await withFetch(
    async () =>
      new Response(mpd, {
        headers: { "Content-Type": "text/plain", ETag: "old-etag" },
      }),
    async () => {
      for (const impl of [worker, bundled]) {
        const response = await impl.fetch(
          new Request(url("https://origin.example/stream.php", { hls: "1" })),
          env,
        );
        assert.equal(response.status, 200);
        assert.match(response.headers.get("Content-Type"), /dash\+xml/);
        assert.equal(response.headers.get("ETag"), null);
        const output = await response.text();
        const [base] = extract(output, "BaseURL");
        assert.equal(
          dashBaseTarget(new URL("seg.m4s", base), env).href,
          "https://cdn.example/live/seg.m4s",
        );
        const [location] = extract(output, "Location");
        const next = await impl.fetch(new Request(location), env);
        assert.equal(next.status, 200);
        assert.match(await next.text(), /\/dash-base\/v1\//);
      }
    },
  );
});
test("DASH segment request retains Range and authorization; disallowed targets fail closed", async () => {
  const xml = rewriteDash(
    "<MPD><BaseURL>https://cdn.example/stream/</BaseURL><Period/></MPD>",
    new URL("https://origin.example/live.mpd"),
    new URL(endpoint),
    env.PROXY_TOKEN,
  );
  const [base] = extract(xml, "BaseURL");
  let calls = 0;
  await withFetch(
    async (target, init) => {
      calls++;
      assert.equal(target, "https://cdn.example/stream/v1/001.m4s");
      assert.equal(new Headers(init.headers).get("Range"), "bytes=0-2");
      return new Response(Uint8Array.of(1, 2, 3), {
        status: 206,
        headers: {
          "Content-Range": "bytes 0-2/10",
          "Content-Type": "video/mp4",
        },
      });
    },
    async () => {
      const request = new Request(new URL("v1/001.m4s", base), {
        headers: { Range: "bytes=0-2" },
      });
      const response = await bundled.fetch(request, env);
      assert.equal(response.status, 206);
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        [1, 2, 3],
      );
      assert.equal(
        (await bundled.fetch(request, { ...env, PROXY_TOKEN: "different" }))
          .status,
        401,
      );
      assert.equal(
        (
          await bundled.fetch(request, {
            ...env,
            ALLOWED_HOSTS: "origin.example",
          })
        ).status,
        403,
      );
      assert.equal(calls, 1);
    },
  );
});
test("format sniffing does not eagerly read a large streaming response", async () => {
  let pulls = 0,
    cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(4096));
    },
    cancel() {
      cancelled = true;
    },
  });
  await withFetch(
    async () =>
      new Response(stream, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    async () => {
      const response = await worker.fetch(
        new Request(url("https://cdn.example/media")),
        env,
      );
      assert.equal(response.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(pulls <= 4, `Unexpected eager reads: ${pulls}`);
      const reader = response.body.getReader();
      const chunk = await reader.read();
      assert.equal(chunk.value.length, 4096);
      await reader.cancel();
      assert.equal(cancelled, true);
    },
  );
});
test("large first upstream chunk is preserved exactly, even after prefix sniffing", async () => {
  const bytes = Uint8Array.from({ length: 18000 }, (_, index) => index % 251);
  await withFetch(
    async () =>
      new Response(bytes, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    async () => {
      const response = await bundled.fetch(
        new Request(url("https://cdn.example/download")),
        env,
      );
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    },
  );
});
test("DASH XML external entities and fake HTML manifests are rejected", () => {
  for (const input of [
    "<html><MPD></MPD></html>",
    '<!DOCTYPE MPD [<!ENTITY a SYSTEM "file:///etc/passwd">]><MPD>&a;</MPD>',
  ])
    assert.throws(() =>
      rewriteDash(
        input,
        new URL("https://origin.example/a.mpd"),
        new URL(endpoint),
      ),
    );
});
test("upstream HTML cannot execute as a same-origin Worker document", async () => {
  await withFetch(
    async () =>
      new Response('<script>throw Error("unsafe")</script>', {
        headers: { "Content-Type": "text/html" },
      }),
    async () => {
      const response = await bundled.fetch(
        new Request(url("https://cdn.example/page")),
        env,
      );
      assert.match(response.headers.get("Content-Security-Policy"), /sandbox/);
      assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    },
  );
});
