// @vitest-environment node
import { test, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { WorkerProfile } from "@youtv/shared";
import { parseYouTubeUrl, type YouTubeFormat } from "./youtube";
import { chooseYouTubeAudio, excludeDashFormat, probeYouTubePlayback, youtubePlaybackUrl } from "./youtubePlayback";

const worker: WorkerProfile = { id: "one", name: "One", baseUrl: "https://one.example/proxy", token: "one-key", enabled: true };
const format = (itag: number, kind: YouTubeFormat["kind"], bitrate: number): YouTubeFormat => ({
  itag, kind, bitrate, quality: "test", mimeType: kind === "audio" ? "audio/mp4" : "video/mp4", width: 0, height: 0, fps: 0, size: null,
  hasAudio: kind !== "video", hasVideo: kind !== "audio",
});

test("watch URLs carrying a playlist resolve the selected video by default, with explicit playlist choice", () => {
  const url = "https://www.youtube.com/watch?v=abcdefghijk&list=PL1234567890ABCDEFGHIJ";
  expect(parseYouTubeUrl(url)).toEqual({ kind: "video", id: "abcdefghijk" });
  expect(parseYouTubeUrl(url, true)).toEqual({ kind: "playlist", id: "PL1234567890ABCDEFGHIJ", videoId: "abcdefghijk" });
  expect(parseYouTubeUrl("https://www.youtube.com/playlist?list=PL1234567890ABCDEFGHIJ").kind).toBe("playlist");
});
test("DASH filter excludes DRM rather than excluding all normal tracks", () => {
  const tracks = [{ itag: 137 }, { itag: 140 }, { itag: 999, drm_families: ["widevine"] }, { itag: 998, fair_play_key_uri: "skd://key" }];
  expect(tracks.filter(track => !excludeDashFormat(track)).map(track => track.itag)).toEqual([137, 140]);
});
test("selected DASH keeps only the chosen video and audio itags", () => {
  const tracks = [{ itag: 137 }, { itag: 136 }, { itag: 140 }, { itag: 251 }];
  expect(tracks.filter(track => !excludeDashFormat(track, new Set([137, 140]))).map(track => track.itag)).toEqual([137, 140]);
});
test("preview and download use the same audio selection without altering the format list", () => {
  const video = format(137, "video", 2000000);
  const audio = [format(140, "audio", 128000), format(251, "audio", 160000)];
  expect(chooseYouTubeAudio([video, ...audio], video, true)?.itag).toBe(251);
  expect(chooseYouTubeAudio([video, ...audio], video, false)).toBeUndefined();
  expect(chooseYouTubeAudio([video, ...audio], audio[0], true)).toBeUndefined();
  expect(audio.map(item => item.itag)).toEqual([140, 251]);
});
test("media relay preserves the actual signed URL and uses only the selected Worker's token", () => {
  const upstream = new URL("https://rr1.example.googlevideo.com/videoplayback?itag=137&sig=x%2By&expire=123");
  const routed = new URL(youtubePlaybackUrl(upstream, worker));
  expect(routed.origin).toBe("https://one.example");
  expect(routed.pathname).toBe("/youtube/fetch");
  expect(routed.searchParams.get("url")).toBe(upstream.toString());
  expect(routed.searchParams.get("key")).toBe("one-key");
  const second = new URL(youtubePlaybackUrl(upstream, { ...worker, baseUrl: "https://two.example", token: "two-key" }));
  expect(second.searchParams.get("key")).toBe("two-key");
});
test("selected playback rejects non-CDN, non-HTTPS, credential-bearing and wrong-path URLs", () => {
  for (const url of ["https://googlevideo.com.evil.example/videoplayback", "http://googlevideo.com/videoplayback", "https://user:pass@googlevideo.com/videoplayback", "https://googlevideo.com/other"]) {
    let rejected = false;
    try { youtubePlaybackUrl(new URL(url), worker); } catch { rejected = true; }
    expect(rejected).toBe(true);
  }
});
test("real HTTP probe sends Range, accepts media and rejects HTML masquerading as playback", async () => {
  const ranges: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    ranges.push(req.headers.range);
    if (req.url === "/bad") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html>sign in</html>"); return; }
    res.writeHead(206, { "Content-Type": "video/mp4", "Content-Range": "bytes 0-2/3", "Content-Length": 3 }); res.end(Buffer.from([1,2,3]));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await probeYouTubePlayback(`${url}/ok`);
    await expect(probeYouTubePlayback(`${url}/bad`)).rejects.toThrow(/HTTP 200: text\/html/);
    expect(ranges).toEqual(["bytes=0-1023", "bytes=0-1023"]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
