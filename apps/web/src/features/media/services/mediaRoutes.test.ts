// @vitest-environment node
import { test, expect } from "vitest";
import { createServer } from "node:http";
import type { WorkerProfile } from "@youtv/shared";
import { createYoutubeFetch, normalizeWorkerBaseUrl, proxyUrl, workerEndpoint } from "@/lib/proxy";
import { probeDirectMedia } from "./mediaDetector";
import { orderedMediaWorkers, withMediaWorkers, requireMediaCapability, mediaAssetUrls, openMediaAsset, primeMediaStream, archiveResourceRoutes, fetchArchiveResource } from "./mediaRoutes";
import { discoverPlayerId, extractPlayerId } from "./youtubeBootstrap";

const profile = (id: string, baseUrl = `https://${id}.example`): WorkerProfile => ({ id, name: id, baseUrl, token: `${id}-secret`, enabled: true });
async function withServer(run: (base: string, calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    calls.push(url.pathname);
    if (url.pathname.startsWith("/old/")) { response.writeHead(404); response.end("not found"); return; }
    if (url.pathname.endsWith("/capabilities")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ youtubeRelay: true, authentication: "query-token" })); return; }
    if (url.pathname.endsWith("/youtube/fetch")) {
      const upstream = new URL(url.searchParams.get("url") || "https://www.youtube.com/");
      response.setHeader("X-YouTV-Proxy", "0.36.1");
      if (upstream.pathname === "/iframe_api" || upstream.pathname === "/watch") { response.writeHead(404); response.end(); return; }
      response.end('<script src="/s/player/a61444a1/player_ias.vflset/en_US/base.js"></script>'); return;
    }
    if (url.pathname.endsWith("/probe")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: false, status: 404, kind: "file" })); return;
    }
    if (url.pathname.endsWith("/proxy")) {
      if (request.headers.range === "bytes=1-2") { response.writeHead(206, { "Content-Range": "bytes 1-2/4" }); response.end(Buffer.from([2,3])); return; }
      response.writeHead(200, { "Content-Type": "video/mp4" }); response.end(Buffer.from([1,2,3,4])); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server address");
    await run(`http://127.0.0.1:${address.port}`, calls);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
test("prefers selected Worker, excludes disabled/insecure endpoints and honors fallback off", () => {
  const a = profile("a"), b = profile("b"), c = { ...profile("c"), enabled: false }, d = profile("d", "http://d.example");
  expect(orderedMediaWorkers([a,b,c,d], "b", true, "https:").map(w => w.id)).toEqual(["b","a"]);
  expect(orderedMediaWorkers([a,b], "b", false, "https:").map(w => w.id)).toEqual(["b"]);
});
test("capability failure moves to next Worker over HTTP", async () => withServer(async (base, calls) => {
  const old = profile("old", `${base}/old`), good = profile("good", `${base}/good`);
  const result = await withMediaWorkers([old, good], async worker => { await requireMediaCapability(worker, "youtubeRelay"); return worker.id; });
  expect(result.value).toBe("good");
  expect(calls).toEqual(["/old/capabilities", "/good/capabilities"]);
}));
test("old Worker relay 404 is diagnosed, upstream 404 triggers public player discovery", async () => withServer(async (base, calls) => {
  const old = profile("old", `${base}/old`), good = profile("good", `${base}/good`);
  await expect(createYoutubeFetch(old)("https://www.youtube.com/iframe_api")).rejects.toThrow(/does not expose/);
  expect((await createYoutubeFetch(good)("https://www.youtube.com/iframe_api")).status).toBe(404);
  expect(await discoverPlayerId(createYoutubeFetch(good), "abcdefghijk")).toBe("a61444a1");
  expect(calls.filter(path => path === "/good/youtube/fetch")).toHaveLength(3);
  expect(extractPlayerId(String.raw`\/s\/player\/a61444a1\/base.js`)).toBe("a61444a1");
  expect(extractPlayerId("404 Not Found")).toBeUndefined();
}));
test("download retries a failed Worker and returns exact bytes", async () => withServer(async (base, calls) => {
  const workers = [profile("old", `${base}/old`), profile("good", `${base}/good`)];
  const urls = mediaAssetUrls("https://origin.example/video.mp4", workers, false, "video.mp4");
  const bytes = new Uint8Array(await new Response(await openMediaAsset(urls)).arrayBuffer());
  expect([...bytes]).toEqual([1,2,3,4]);
  expect(calls).toEqual(["/old/proxy", "/good/proxy"]);
}));
test("archive fallback preserves Range and never forwards primary token to alternate Worker", async () => withServer(async (base, calls) => {
  const old = profile("old", `${base}/old`), good = profile("good", `${base}/good`);
  const source = mediaAssetUrls("https://origin.example/seg.mp4", [old], false)[0]!;
  const routes = archiveResourceRoutes(source, old, [good]);
  expect(new URL(routes[1]!).searchParams.get("key")).toBe(good.token);
  const response = await fetchArchiveResource(routes, { headers: [["range", "bytes=1-2"]] }, res => { if (res.status !== 206) throw new Error("Invalid range"); });
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2,3]);
  expect(calls).toEqual(["/old/proxy", "/good/proxy"]);
  expect(archiveResourceRoutes("https://other.example/proxy?url=https://origin.example/seg.mp4", old, [good])).toHaveLength(1);
}));
test("prime stream allows fallback on first-read failure and preserves successful chunks", async () => {
  const workers = [profile("a"), profile("b")];
  const result = await withMediaWorkers(workers, worker => primeMediaStream(new ReadableStream<Uint8Array>({ start(controller) { if (worker.id === "a") controller.error(new Error("stream failed")); else { controller.enqueue(new Uint8Array([1,2])); controller.enqueue(new Uint8Array([3])); controller.close(); } } })));
  expect(result.worker.id).toBe("b");
  expect([...new Uint8Array(await new Response(result.value).arrayBuffer())]).toEqual([1,2,3]);
});
test("aborted operations do not try another Worker", async () => {
  const controller = new AbortController(); const calls: string[] = [];
  await expect(withMediaWorkers([profile("a"),profile("b")], async worker => { calls.push(worker.id); controller.abort(); controller.signal.throwIfAborted(); }, controller.signal)).rejects.toThrow();
  expect(calls).toEqual(["a"]);
});

// Existing imported profiles may contain an entire copied relay URL, not a base.
test("normalizes copied Worker endpoints without reusing URL credentials or dropping mount prefixes", async () => withServer(async (base, calls) => {
  const worker = profile("good", `${base}/good/proxy?url=https%3A%2F%2Fexample.org&key=old-secret#fragment`);
  expect(normalizeWorkerBaseUrl(worker.baseUrl)).toBe(`${base}/good/`);
  expect(normalizeWorkerBaseUrl(`${base}/good/youtube/fetch/`)).toBe(`${base}/good/`);
  expect(normalizeWorkerBaseUrl(`${base}/good/health`)).toBe(`${base}/good/`);
  expect(normalizeWorkerBaseUrl(`${base}/good/`)).toBe(`${base}/good/`);
  const route = new URL(proxyUrl("https://origin.example/video.mp4", worker));
  expect(route.pathname).toBe("/good/proxy");
  expect(route.searchParams.get("key")).toBe(worker.token);
  expect(route.hash).toBe("");
  expect(new URL(workerEndpoint(worker, "health")).pathname).toBe("/good/health");
  await requireMediaCapability(worker, "youtubeRelay");
  expect((await createYoutubeFetch(worker)("https://www.youtube.com/iframe_api")).status).toBe(404);
  expect(await discoverPlayerId(createYoutubeFetch(worker), "abcdefghijk")).toBe("a61444a1");
  expect(calls).toEqual(["/good/capabilities", "/good/youtube/fetch", "/good/youtube/fetch", "/good/youtube/fetch"]);
}));
test("distinguishes a missing Worker probe endpoint from an upstream 404", async () => withServer(async (base) => {
  await expect(probeDirectMedia("https://origin.example/video.mp4", profile("old", `${base}/old`))).rejects.toThrow(/Worker \/probe HTTP 404/);
  await expect(probeDirectMedia("https://origin.example/video.mp4", profile("good", `${base}/good`))).rejects.toThrow(/Upstream HTTP 404/);
}));
