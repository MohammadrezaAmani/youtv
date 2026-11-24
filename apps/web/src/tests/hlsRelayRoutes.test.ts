import { expect, test } from "vitest";
import { hlsRequestRoute, hlsResponseBase } from "../features/player/hlsRelayRoutes";
import { playlistResponseBase, proxyUrl } from "../lib/proxy";
import type { WorkerProfile } from "@youtv/shared";
const worker: WorkerProfile = { id: "w", name: "relay", enabled: true, baseUrl: "https://round-fog-1d8f.mr4016a1382.workers.dev/", token: "secret" };
const source = "https://origin.example/watch";
const initial = proxyUrl(source, worker, "proxy", true);

test("a path on the Worker hostname is not itself a proxy endpoint", () => {
  const raw = `${worker.baseUrl}ifilmfa_2_482/index.m3u8`;
  const route = new URL(hlsRequestRoute(raw, worker, initial, true));
  expect(route.pathname).toBe("/proxy");
  expect(route.searchParams.get("url")).toBe(raw);
  expect(route.searchParams.get("key")).toBe(worker.token);
});
test("relative paths use the real final origin, then are routed through /proxy", () => {
  const text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n/ifilmfa_2_482/index.m3u8\n";
  const final = "https://cdn.example/redirected/folder/";
  const base = hlsResponseBase(text, initial, worker, final);
  expect(base).toBe(final);
  for (const raw of ["/ifilmfa_2_482/index.m3u8", "child.m3u8", "../child.m3u8", "//cdn2.example/live.m3u8", "?id=1"]) {
    const resolved = new URL(raw, base).href;
    expect(new URL(hlsRequestRoute(resolved, worker, initial, true)).searchParams.get("url")).toBe(resolved);
  }
});
test("do not double proxy an existing relay or lose LL-HLS parameters", () => {
  const routed = new URL(proxyUrl("https://cdn.example/live.m3u8?sig=a%2Bb", worker, "proxy", true));
  routed.searchParams.set("_HLS_msn", "123");
  expect(hlsRequestRoute(routed.href, worker, initial, true)).toBe(routed.href);
  const text = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${routed.href}`;
  expect(hlsResponseBase(text, initial, worker, source)).toBeUndefined();
});
test("relative key and map attributes use the upstream base", () => {
  const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXT-X-MAP:URI="init.mp4"\n';
  expect(hlsResponseBase(text, initial, worker, "https://cdn.example/dir/index.m3u8")).toBe("https://cdn.example/dir/index.m3u8");
});
test("playlist import uses the actual redirect target, not the Worker URL", () => {
  const final = "https://cdn.example/folder/list.m3u";
  const response = { url: initial, headers: new Headers({ "X-YouTV-Source-URL": final }) };
  expect(playlistResponseBase(response, source, true)).toBe(final);
  expect(playlistResponseBase({ url: final, headers: new Headers() }, source, false)).toBe(final);
  expect(playlistResponseBase({ url: initial, headers: new Headers() }, source, true)).toBe(source);
});
