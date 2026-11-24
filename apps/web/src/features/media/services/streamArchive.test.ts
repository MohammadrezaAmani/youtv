import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHlsArchiveEntries } from "./hlsDownload";
import { buildDashArchiveEntries } from "./dashDownload";

const worker = {
  id: "worker",
  name: "Worker",
  baseUrl: "https://worker.example",
  token: "",
  enabled: true,
};
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function textResponse(text: string, type = "application/octet-stream") {
  return new Response(text, { status: 200, headers: { "Content-Type": type } });
}

describe("HLS offline archive", () => {
  it("selects the highest variant and packages AES-128 key, map and byte-range segments", async () => {
    const masterUrl =
      "https://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Fmaster.m3u8&hls=1";
    const mediaUrl =
      "https://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Fhigh%2Findex.m3u8&hls=1";
    const calls: { url: string; range: string | null }[] = [];
    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, range: new Request(url, init).headers.get("range") });
      if (url === masterUrl)
        return textResponse(
          `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Flow%2Findex.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000\n${mediaUrl}`,
          "application/vnd.apple.mpegurl",
        );
      if (url === mediaUrl)
        return textResponse(
          `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="https://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Fkey.bin"\n#EXT-X-MAP:URI="https://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Finit.mp4"\n#EXTINF:4,\n#EXT-X-BYTERANGE:3@0\nhttps://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Fmedia.mp4\n#EXTINF:4,\nhttps://worker.example/proxy?url=https%3A%2F%2Forigin.example%2Fmedia2.mp4\n#EXT-X-ENDLIST`,
          "application/vnd.apple.mpegurl",
        );
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { "Content-Type": "application/octet-stream", "Content-Range": "bytes 0-2/3" },
      });
    }) as typeof fetch;
    const archive = await buildHlsArchiveEntries(
      "https://origin.example/master.m3u8",
      worker,
    );
    expect(archive.segments).toBe(2);
    expect(archive.entries.map((entry) => entry.filename).sort()).toEqual(
      [
        "master.m3u8",
        "video/index.m3u8",
        "keys/key-1.bin",
        "video/init-1.mp4",
        "video/segments/000001.mp4",
        "video/segments/000002.mp4",
      ].sort(),
    );
    const playlist = await new Response(
      await archive.entries
        .find((entry) => entry.filename === "video/index.m3u8")!
        .open(),
    ).text();
    expect(playlist).toContain('URI="../keys/key-1.bin"');
    expect(playlist).toContain('URI="init-1.mp4"');
    expect(playlist).toContain("segments/000001.mp4");
    expect(playlist).not.toContain("BYTERANGE");
    await archive.entries
      .find((entry) => entry.filename === "video/segments/000001.mp4")!
      .open();
    expect(calls.some((call) => call.range === "bytes=0-2")).toBe(true);
  });
  it("labels the finite live window as a snapshot rather than a full broadcast", async () => {
    globalThis.fetch = vi.fn(async () =>
      textResponse(
        "#EXTM3U\n#EXTINF:4,\nsegment.ts",
        "application/vnd.apple.mpegurl",
      ),
    ) as typeof fetch;
    const archive = await buildHlsArchiveEntries(
      "https://origin.example/live.m3u8",
      worker,
    );
    expect(archive.liveSnapshot).toBe(true);
    expect(archive.entries.map((entry) => entry.filename)).toContain(
      "ARCHIVE-INFO.txt",
    );
    expect(
      await new Response(
        await archive.entries
          .find((entry) => entry.filename === "playlist.m3u8")!
          .open(),
      ).text(),
    ).toContain("#EXT-X-ENDLIST");
  });
});

describe("DASH offline archive", () => {
  it("packages static SegmentTemplate initialization and media segments and rewrites the offline MPD", async () => {
    const manifest = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S"><Period><BaseURL>https://worker.example/dash-base/v1/${btoa(JSON.stringify({ origin: "https://cdn.example", query: "", key: "" })).replace(/=+$/, "")}/stream/</BaseURL><AdaptationSet mimeType="video/mp4"><SegmentTemplate timescale="1" duration="2" startNumber="5" media="$RepresentationID$/$Number%03d$.m4s" initialization="$RepresentationID$/init.mp4"/><Representation id="v1" bandwidth="1000"/></AdaptationSet></Period></MPD>`;
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/proxy?"))
        return textResponse(manifest, "application/dash+xml");
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const archive = await buildDashArchiveEntries(
      "https://origin.example/live.mpd",
      worker,
    );
    expect(archive.segments).toBe(2);
    expect(archive.entries.map((entry) => entry.filename)).toEqual([
      "manifest.mpd",
      "period-1/adaptation-1/v1/init.mp4",
      "period-1/adaptation-1/v1/segment-000001.m4s",
      "period-1/adaptation-1/v1/segment-000002.m4s",
    ]);
    const offlineMpd = await new Response(
      await archive.entries[0]!.open(),
    ).text();
    expect(offlineMpd).toContain('startNumber="1"');
    expect(offlineMpd).toContain(
      "period-1/adaptation-1/v1/segment-$Number%06d$.m4s",
    );
    expect(offlineMpd).not.toContain("dash-base");
    await archive.entries[1]!.open();
    expect(
      requested.some(
        (url) =>
          url.includes("/dash-base/v1/") && url.endsWith("/stream/v1/init.mp4"),
      ),
    ).toBe(true);
  });
  it("refuses dynamic live MPDs instead of pretending they are complete downloads", async () => {
    globalThis.fetch = vi.fn(async () =>
      textResponse(
        '<MPD type="dynamic"><Period/></MPD>',
        "application/dash+xml",
      ),
    ) as typeof fetch;
    await expect(
      buildDashArchiveEntries("https://origin.example/live.mpd", worker),
    ).rejects.toThrow(/زنده|dynamic/i);
  });
});
