// @vitest-environment node
import { test, expect } from "vitest";
import { createServer } from "node:http";
import { mediaRoutingPolicy, mediaAssetUrls } from "./mediaRoutes";
import { assetRoutes } from "@/lib/assetRoutes";
import { buildHlsArchiveEntries } from "./hlsDownload";
import type { WorkerProfile } from "@youtv/shared";
const a: WorkerProfile = { id: "a", name: "A", baseUrl: "https://a.example", enabled: true, token: "a-secret" };
const b: WorkerProfile = { ...a, id: "b", name: "B", baseUrl: "https://b.example" };
const defaults = { mediaRouteMode: "proxy" as const, mediaWorkerId: "", defaultWorkerId: "b", mediaWorkerFallback: true, mediaDirectFallback: false };
test("explicit direct bypasses all saved Workers, including the selected one", () => {
  const route = mediaRoutingPolicy([a,b], { ...defaults, mediaRouteMode: "direct", mediaWorkerId: "a" }, "https:");
  expect(route).toEqual({ candidates: [], allowDirect: true });
  const origin = "https://i.imgur.com/BCC123A.jpg";
  expect(mediaAssetUrls(origin, route.candidates, route.allowDirect)).toEqual([origin]);
  expect(assetRoutes(origin, route.candidates, route.allowDirect, "https:", [a,b])).toEqual([origin]);
});
test("proxy mode never contacts the origin without explicit permission", () => {
  const route = mediaRoutingPolicy([a,b], defaults, "https:");
  expect(route.candidates.map(w => w.id)).toEqual(["b","a"]);
  expect(route.allowDirect).toBe(false);
  expect(mediaRoutingPolicy([], defaults, "https:")).toEqual({ candidates: [], allowDirect: false });
});
test("selected Worker and fallback settings are respected", () => {
  const route = mediaRoutingPolicy([a,b], { ...defaults, mediaWorkerId: "a", mediaWorkerFallback: false, mediaDirectFallback: true }, "https:");
  expect(route.candidates.map(w => w.id)).toEqual(["a"]);
  expect(route.allowDirect).toBe(true);
});
test("HLS archive in Direct mode fetches manifest and relative segments from the origin", async () => {
  const calls: string[] = [];
  const server = createServer((req,res) => {
    calls.push(req.url || "");
    if (req.url === "/media/index.m3u8") { res.setHeader("content-type", "application/vnd.apple.mpegurl"); res.end("#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n"); }
    else if (req.url === "/media/segment.ts") { res.end(Buffer.from([1,2,3])); }
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No server address");
    const result = await buildHlsArchiveEntries(`http://127.0.0.1:${address.port}/media/index.m3u8`, undefined);
    const segment = result.entries.find(entry => entry.filename.endsWith(".ts"));
    if (!segment) throw new Error("Missing segment");
    expect(Array.from(new Uint8Array(await new Response(await segment.open()).arrayBuffer()))).toEqual([1,2,3]);
    expect(calls).toEqual(["/media/index.m3u8", "/media/segment.ts"]);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); }
});
