import { expect, test } from "vitest";
import { hlsRequestRoute, hlsResponseBase, normalizeRelayPlaylist } from "../features/player/hlsRelayRoutes";
import { playlistResponseBase, proxyUrl } from "../lib/proxy";
import type { WorkerProfile } from "@youtv/shared";
const worker: WorkerProfile = { id: "w", name: "relay", enabled: true, baseUrl: "https://meow.arushop.ir/", token: "secret" };
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

test("raw root-relative variants are resolved before the browser or loader can use the Worker origin", () => {
  const manifest = '#EXTM3U\r\n#EXT-X-STREAM-INF:BANDWIDTH=1000\r\n/ifilmfa_2_482/index.m3u8\r\n#EXT-X-STREAM-INF:BANDWIDTH=2000\r\n../hd/index.m3u8?sig=a%2Bb\r\n';
  const final = "https://cdn.example/redirected/folder/master.m3u8";
  const normalized = normalizeRelayPlaylist(manifest, hlsResponseBase(manifest, initial, worker, final)!);
  const variants = normalized.split(/\r\n/).filter(line => line.startsWith("https://"));
  expect(variants).toEqual(["https://cdn.example/ifilmfa_2_482/index.m3u8", "https://cdn.example/redirected/hd/index.m3u8?sig=a%2Bb"]);
  for (const variant of variants) expect(new URL(hlsRequestRoute(variant, worker, initial, true)).searchParams.get("url")).toBe(variant);
});
test("normalize nested URI attributes but leave signed absolute URLs, inline data and HLS variables intact", () => {
  const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="//audio.example/a.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain,abc"\n{$cdn}/seg.ts\nhttps://other.example/s.ts?sig=a%2Bb\n';
  expect(normalizeRelayPlaylist(text, "https://cdn.example/final/master.m3u8")).toBe('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key"\n#EXT-X-MAP:URI="https://cdn.example/final/init.mp4"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="https://audio.example/a.m3u8"\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain,abc"\n{$cdn}/seg.ts\nhttps://other.example/s.ts?sig=a%2Bb\n');
});

test("quoted metadata cannot be mistaken for a URI attribute", () => {
  const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,NAME="English,URI=not-a-url",URI="audio.m3u8"';
  expect(normalizeRelayPlaylist(text, "https://cdn.example/master.m3u8")).toBe('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,NAME="English,URI=not-a-url",URI="https://cdn.example/audio.m3u8"');
});


test("already relayed child playlists keep the HLS hint and explicit source headers", () => {
  const master = proxyUrl("https://bozztv.com/1gbw5/tintv2/tintv2/playlist.m3u8", worker, "proxy", true, { userAgent: "YouTV test", referer: "https://bozztv.com/" });
  const child = proxyUrl("https://bozztv.com/1gbw5/tintv2/tintv2/chunklist.m3u8?sig=a%2Bb", worker);
  const result = new URL(hlsRequestRoute(child, worker, master, true));
  expect(result.searchParams.get("hls")).toBe("1");
  expect(result.searchParams.get("ua")).toBe("YouTV test");
  expect(result.searchParams.get("ref")).toBe("https://bozztv.com/");
  expect(result.searchParams.get("url")).toBe("https://bozztv.com/1gbw5/tintv2/tintv2/chunklist.m3u8?sig=a%2Bb");
});
