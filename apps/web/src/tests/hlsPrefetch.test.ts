// @vitest-environment node
// Fetch, Headers, Blob and streams must use the same native implementation.
import { expect, test, vi } from "vitest";
import {
  HlsFragmentPrefetcher,
  hlsPrefetchKey,
  type HlsPrefetchFragment,
} from "../features/player/hlsPrefetch";

const fragment = (sn: number, start: number, url = `https://origin.example/${sn}.ts`): HlsPrefetchFragment => ({
  sn,
  url,
  start,
  duration: 6,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("prefetches upcoming segments in nearest-first order with bounded parallelism", async () => {
  const calls: string[] = [];
  const releases = new Map<string, () => void>();
  let active = 0;
  let peak = 0;
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    active++;
    peak = Math.max(peak, active);
    return new Promise<Response>((resolve) => {
      releases.set(url, () => {
        active--;
        resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      });
    });
  });
  const prefetcher = new HlsFragmentPrefetcher((url) => url, {
    maxConcurrent: 2, adaptive: false, waitForStartup: false,
    targetAheadSeconds: 30,
    fetcher,
  });

  prefetcher.schedule([
    fragment(4, 18),
    fragment(2, 6),
    fragment(3, 12),
    fragment(1, 0),
    fragment(9, 42),
  ], 0);

  expect(calls).toEqual([
    "https://origin.example/2.ts",
    "https://origin.example/3.ts",
  ]);
  expect(peak).toBe(2);

  releases.get("https://origin.example/2.ts")!();
  await tick();
  expect(calls).toContain("https://origin.example/4.ts");
  expect(peak).toBe(2);

  releases.get("https://origin.example/3.ts")!();
  releases.get("https://origin.example/4.ts")!();
  await tick();
  prefetcher.dispose();
});

test("serves a completed prefetched segment from the cache exactly once", async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([7, 8, 9]), {
    status: 200,
    headers: { "content-type": "video/mp2t" },
  }));
  const prefetcher = new HlsFragmentPrefetcher((url) => `https://worker.example/proxy?url=${encodeURIComponent(url)}`, { fetcher, adaptive: false, waitForStartup: false });
  const item = fragment(2, 6);
  prefetcher.schedule([item], 0);

  for (let attempt = 0; attempt < 20 && prefetcher.getStats().cached === 0; attempt++) await tick();
  const routed = `https://worker.example/proxy?url=${encodeURIComponent(item.url)}`;
  const cached = prefetcher.take(routed);
  expect(cached).not.toBeNull();
  expect([...new Uint8Array(await cached!.arrayBuffer())]).toEqual([7, 8, 9]);
  expect(prefetcher.take(routed)).toBeNull();
  expect(prefetcher.getStats().cachedBytes).toBe(0);
  prefetcher.dispose();
});

test("cancels speculative work when playback reaches a segment before it is ready", () => {
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const prefetcher = new HlsFragmentPrefetcher((url) => url, { fetcher, adaptive: false, waitForStartup: false });
  const item = fragment(2, 6);
  prefetcher.schedule([item], 0);
  expect(prefetcher.take(item.url)).toBeNull();
  expect(signal?.aborted).toBe(true);
  prefetcher.dispose();
});

test("uses exact HTTP byte ranges and does not cache an HTML error page", async () => {
  let range = "";
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    range = new Headers(init?.headers).get("Range") || "";
    return new Response(new Uint8Array(100), {
      status: 206,
      headers: { "content-type": "video/mp4", "content-range": "bytes 100-199/1000" },
    });
  });
  const prefetcher = new HlsFragmentPrefetcher((url) => url, { fetcher, adaptive: false, waitForStartup: false });
  const item = { ...fragment(2, 6), byteRangeStartOffset: 100, byteRangeEndOffset: 200 };
  prefetcher.schedule([item], 0);
  for (let attempt = 0; attempt < 20 && prefetcher.getStats().cached === 0; attempt++) await tick();
  expect(range).toBe("bytes=100-199");
  expect(prefetcher.take(item.url, 100, 200)).not.toBeNull();
  prefetcher.dispose();

  const htmlPrefetcher = new HlsFragmentPrefetcher((url) => url, {
    adaptive: false, waitForStartup: false,
    fetcher: async () => new Response("<html>blocked</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  htmlPrefetcher.schedule([fragment(3, 6)], 0);
  for (let attempt = 0; attempt < 20 && htmlPrefetcher.getStats().active > 0; attempt++) await tick();
  expect(htmlPrefetcher.getStats().cached).toBe(0);
  htmlPrefetcher.dispose();
});

test("uses exclusive byte-range offsets in cache identity", () => {
  expect(hlsPrefetchKey("https://origin.example/a", 10, 20)).not.toBe(
    hlsPrefetchKey("https://origin.example/a", 20, 30),
  );
});


test("cancels queued fragments from a superseded rendition", async () => {
  const calls: string[] = [];
  const signals = new Map<string, AbortSignal>();
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const signal = init?.signal as AbortSignal;
    signals.set(url, signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const prefetcher = new HlsFragmentPrefetcher((url) => url, { maxConcurrent: 1, adaptive: false, waitForStartup: false, fetcher });
  prefetcher.schedule([fragment(1, 6), fragment(2, 12)], 0, "main");
  expect(calls).toEqual(["https://origin.example/1.ts"]);
  prefetcher.schedule([fragment(3, 6, "https://origin.example/new-level-1.ts")], 0, "main");
  expect(signals.get("https://origin.example/1.ts")?.aborted).toBe(true);
  for (let attempt = 0; attempt < 10 && !calls.includes("https://origin.example/new-level-1.ts"); attempt++) await tick();
  expect(calls).toContain("https://origin.example/new-level-1.ts");
  prefetcher.dispose();
});

test("retries one transient upstream 5xx response", async () => {
  let calls = 0;
  const prefetcher = new HlsFragmentPrefetcher((url) => url, {
    retryDelayMs: 1, adaptive: false, waitForStartup: false,
    fetcher: async () => {
      calls++;
      return calls === 1
        ? new Response("upstream unavailable", { status: 502 })
        : new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "content-type": "video/mp2t" } });
    },
  });
  const item = fragment(2, 6);
  prefetcher.schedule([item], 0);
  for (let attempt = 0; attempt < 30 && prefetcher.getStats().cached === 0; attempt++) await tick();
  expect(calls).toBe(2);
  expect(prefetcher.take(item.url)).not.toBeNull();
  prefetcher.dispose();
});

test("protects the first media fragment from speculative downloads", async () => {
  const calls: string[] = [];
  const p = new HlsFragmentPrefetcher((url) => url, { fetcher: async (url) => {
    calls.push(String(url));
    return new Response(new Uint8Array(4));
  } });
  const items = [fragment(1, 0), fragment(2, 6), fragment(3, 12)];
  p.schedule(items, 0);
  p.observe(30000, 25000, 6);
  expect(calls).toEqual([]);
  p.markBuffered(items[0]!);
  p.start();
  p.schedule(items, 0);
  expect(calls).toEqual([items[1]!.url, items[2]!.url]);
  p.dispose();
});

test("joins an in-flight segment rather than aborting or issuing another request", async () => {
  let finish!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  let calls = 0;
  const p = new HlsFragmentPrefetcher((url) => url, { waitForStartup: false, fetcher: (_url, init) => {
    calls++;
    signal = init?.signal ?? undefined;
    return new Promise((resolve) => { finish = resolve; });
  } });
  const item = fragment(2, 6);
  p.schedule([item], 0);
  const release = p.reserveForeground(item.url, 0, 0);
  const pending = p.claim(item.url, 0, 0);
  expect(pending).not.toBeNull();
  p.schedule([], 0);
  expect(signal?.aborted).toBe(false);
  finish(new Response(new Uint8Array([1, 2, 3])));
  const result = await pending;
  expect([...new Uint8Array(await result!.blob.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(calls).toBe(1);
  release(); p.dispose();
});

test("reserves foreground requests and normalizes an empty HLS byte range", () => {
  const calls: string[] = [];
  const p = new HlsFragmentPrefetcher((url) => url, { waitForStartup: false, fetcher: async (url) => {
    calls.push(String(url)); return new Response(new Uint8Array(1));
  } });
  const item = fragment(2, 6);
  const release = p.reserveForeground(item.url, 0, 0);
  p.schedule([item], 0);
  expect(calls).toEqual([]);
  expect(hlsPrefetchKey(item.url, 0, 0)).toBe(hlsPrefetchKey(item.url));
  release(); p.dispose();
});

test("increases concurrency cautiously for latency-dominated downloads", () => {
  const p = new HlsFragmentPrefetcher((url) => url);
  expect(p.getStats().concurrency).toBe(1);
  p.observe(30000, 24000, 5);
  expect(p.getStats().concurrency).toBe(2);
  for (let i = 0; i < 20; i++) p.observe(30000, 24000, 5);
  expect(p.getStats().concurrency).toBeLessThanOrEqual(16);
  p.updatePlayback(90);
  p.observe(30000, 24000, 5);
  expect(p.getStats().concurrency).toBe(1);
  p.dispose();
});

test("does not increase a transfer-limited connection to sixteen requests", () => {
  const p = new HlsFragmentPrefetcher((url) => url);
  for (let i = 0; i < 100; i++) p.observe(30000, 500, 5);
  expect(p.getStats().concurrency).toBeLessThanOrEqual(3);
  p.dispose();
});

test("aborts stalled speculative downloads at the configured overall deadline", async () => {
  let signal: AbortSignal | undefined;
  const p = new HlsFragmentPrefetcher((url) => url, { waitForStartup: false, timeoutMs: 15, fetcher: (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  } });
  const item = fragment(2, 6);
  p.schedule([item], 0);
  const release = p.reserveForeground(item.url);
  expect(await p.claim(item.url)).toBeNull();
  expect(signal?.aborted).toBe(true);
  expect(p.getStats().active).toBe(0);
  release(); p.dispose();
});


test("prefetches an unranged hls.js fragment with zero offsets", async () => {
  let receivedRange: string | null | undefined;
  const p = new HlsFragmentPrefetcher((url) => url, {
    waitForStartup: false,
    fetcher: async (_url, init) => {
      receivedRange = new Headers(init?.headers).get("Range");
      return new Response(new Uint8Array([4, 5, 6]));
    },
  });
  try {
    const item = { ...fragment(2, 6), byteRangeStartOffset: 0, byteRangeEndOffset: 0 };
    p.schedule([item], 0);
    for (let attempt = 0; attempt < 20 && p.getStats().cached === 0; attempt++) await tick();
    expect(receivedRange).toBeNull();
    const result = await p.claim(item.url, 0, 0);
    expect(result).not.toBeNull();
    expect([...new Uint8Array(await result!.blob.arrayBuffer())]).toEqual([4, 5, 6]);
  } finally {
    p.dispose();
  }
});

test("rejects incorrect byte-range responses without caching them", async () => {
  for (const [status, contentRange, length] of [
    [200, "bytes 100-199/1000", 100],
    [206, "bytes 101-200/1000", 100],
    [206, "bytes 100-199/1000", 99],
  ] as const) {
    const p = new HlsFragmentPrefetcher((url) => url, {
      waitForStartup: false,
      fetcher: async () => new Response(new Uint8Array(length), {
        status, headers: { "content-type": "video/mp4", "content-range": contentRange },
      }),
    });
    try {
      const item = { ...fragment(2, 6), byteRangeStartOffset: 100, byteRangeEndOffset: 200 };
      p.schedule([item], 0);
      for (let attempt = 0; attempt < 20 && p.getStats().active > 0; attempt++) await tick();
      expect(p.getStats().active).toBe(0);
      expect(p.getStats().cached).toBe(0);
      expect(p.take(item.url, 100, 200)).toBeNull();
    } finally {
      p.dispose();
    }
  }
});
