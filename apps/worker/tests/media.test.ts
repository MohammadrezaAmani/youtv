import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
const env = { ALLOWED_HOSTS: "*", ALLOWED_ORIGINS: "", PROXY_TOKEN: "" };
const origin = "https://mohammadrezaamani.github.io";

describe("YouTV platform relays", () => {
  it("relays YouTube InnerTube POST requests through the existing Worker without forwarding cookies or authorization", async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      captured = init;
      return new Response('{"playabilityStatus":{"status":"OK"}}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const target =
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
    const endpoint = new URL("https://youtv.workers.dev/youtube/fetch");
    endpoint.searchParams.set("url", target);
    const response = await worker.fetch(
      new Request(endpoint, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-YouTube-Client-Name": "1",
          "X-YouTube-Client-Version": "2.20261124.00.00",
          Cookie: "secret=1",
          Authorization: "Bearer secret",
        },
        body: '{"videoId":"abcdefghijk"}',
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      playabilityStatus: { status: "OK" },
    });
    const headers = new Headers(captured?.headers);
    expect(headers.get("X-YouTube-Client-Name")).toBe("1");
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Origin")).toBe("https://www.youtube.com");
  });
  it("allows GoogleVideo playback URLs only at /videoplayback", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": "bytes 0-2/3",
          },
        }),
    ) as typeof fetch;
    const endpoint = new URL("https://youtv.workers.dev/youtube/fetch");
    endpoint.searchParams.set(
      "url",
      "https://rr1---sn.googlevideo.com/videoplayback?id=abc",
    );
    const response = await worker.fetch(
      new Request(endpoint, {
        headers: { Origin: origin, Range: "bytes=0-2" },
      }),
      env,
    );
    expect(response.status).toBe(206);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    const invalid = new URL("https://youtv.workers.dev/youtube/fetch");
    invalid.searchParams.set("url", "https://rr1---sn.googlevideo.com/other");
    expect(
      (
        await worker.fetch(
          new Request(invalid, { headers: { Origin: origin } }),
          env,
        )
      ).status,
    ).toBe(403);
  });
  it("rejects arbitrary hosts and private IPs on the YouTube relay", async () => {
    const arbitrary = new URL("https://youtv.workers.dev/youtube/fetch");
    arbitrary.searchParams.set("url", "https://example.com/youtubei/v1/player");
    expect(
      (
        await worker.fetch(
          new Request(arbitrary, { headers: { Origin: origin } }),
          env,
        )
      ).status,
    ).toBe(403);
    const local = new URL("https://youtv.workers.dev/youtube/fetch");
    local.searchParams.set("url", "http://127.0.0.1/youtubei/v1/player");
    expect(
      (
        await worker.fetch(
          new Request(local, { headers: { Origin: origin } }),
          env,
        )
      ).status,
    ).toBe(403);
  });
  it("relays public Instagram post pages with fixed public headers and no browser cookies", async () => {
    let captured: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) => {
      captured = init;
      return new Response(
        '<meta property="og:video" content="https://scontent.cdninstagram.com/media.mp4">',
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }) as typeof fetch;
    const endpoint = new URL("https://youtv.workers.dev/instagram/fetch");
    endpoint.searchParams.set(
      "url",
      "https://www.instagram.com/reel/ABC123/?__a=1&__d=dis",
    );
    const response = await worker.fetch(
      new Request(endpoint, {
        headers: { Origin: origin, Cookie: "sessionid=secret" },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("og:video");
    const headers = new Headers(captured?.headers);
    expect(headers.get("X-IG-App-ID")).toBe("936619743392459");
    expect(headers.get("Cookie")).toBeNull();
  });
  it("sniffs HLS returned by an extensionless PHP endpoint even when the origin says text/plain", async () => {
    const playlist =
      "#EXTM3U\n#EXTINF:4,\nhttps://cdn.example/segment.ts\n#EXT-X-ENDLIST";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(playlist, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    ) as typeof fetch;
    const endpoint = new URL("https://youtv.workers.dev/proxy");
    endpoint.searchParams.set(
      "url",
      "https://origin.example/stream.php?channel=1",
    );
    const response = await worker.fetch(
      new Request(endpoint, { headers: { Origin: origin } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "application/vnd.apple.mpegurl",
    );
    expect(await response.text()).toContain("/proxy?url=");
  });
  it("detects HLS and DASH from extensionless URLs during a bounded Range probe", async () => {
    const playlist = "#EXTM3U\n#EXTINF:4,\nsegment.ts";
    globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        : new Response(playlist, {
            status: 206,
            headers: {
              "Content-Type": "text/plain",
              "Content-Range": "bytes 0-4095/10000",
              "Accept-Ranges": "bytes",
            },
          }),
    ) as typeof fetch;
    const hlsUrl = new URL("https://youtv.workers.dev/probe");
    hlsUrl.searchParams.set("url", "https://origin.example/stream.php?ch=1");
    const hls = await worker.fetch(
      new Request(hlsUrl, { headers: { Origin: origin } }),
      env,
    );
    expect(((await hls.json()) as any).kind).toBe("hls");
    globalThis.fetch = vi.fn(async (_input: any, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        : new Response('<MPD type="dynamic"><Period/></MPD>', {
            status: 206,
            headers: {
              "Content-Type": "text/plain",
              "Content-Range": "bytes 0-4095/10000",
            },
          }),
    ) as typeof fetch;
    const dash = await worker.fetch(
      new Request(hlsUrl, { headers: { Origin: origin } }),
      env,
    );
    expect(((await dash.json()) as any).kind).toBe("dash");
  });
  it("rewrites an MPD response from an extensionless PHP-style source URL", async () => {
    const mpd =
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><BaseURL>https://cdn.example/live/</BaseURL><AdaptationSet><SegmentTemplate media="$RepresentationID$/$Number$.m4s" initialization="$RepresentationID$/init.mp4"/><Representation id="video"/></AdaptationSet></Period></MPD>';
    globalThis.fetch = vi.fn(
      async () =>
        new Response(mpd, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
    ) as typeof fetch;
    const endpoint = new URL("https://youtv.workers.dev/proxy");
    endpoint.searchParams.set("url", "https://origin.example/stream.php?id=1");
    const response = await worker.fetch(
      new Request(endpoint, { headers: { Origin: origin } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "application/dash+xml",
    );
    expect(await response.text()).toContain("dash-base/v1/");
  });
  it("streams DASH BaseURL segments through the same Worker and preserves Range", async () => {
    let capturedUrl = "",
      capturedRange = "";
    globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedRange = new Headers(init?.headers).get("Range") || "";
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: {
          "Content-Type": "video/iso.segment",
          "Content-Range": "bytes 0-2/3",
          "Accept-Ranges": "bytes",
        },
      });
    }) as typeof fetch;
    const endpoint = new URL(
      "https://youtv.workers.dev/dash-base/video/seg-00001.m4s",
    );
    endpoint.searchParams.set("base", "https://cdn.example/stream/?token=abc");
    const response = await worker.fetch(
      new Request(endpoint, {
        headers: { Origin: origin, Range: "bytes=0-2" },
      }),
      env,
    );
    expect(response.status).toBe(206);
    expect(capturedUrl).toBe(
      "https://cdn.example/stream/video/seg-00001.m4s?token=abc",
    );
    expect(capturedRange).toBe("bytes=0-2");
  });
  it("advertises binary downloads and platform relays in capabilities", async () => {
    const response = await worker.fetch(
      new Request("https://youtv.workers.dev/capabilities", {
        headers: { Origin: origin },
      }),
      env,
    );
    const data = (await response.json()) as Record<string, unknown>;
    expect(data.binaryStreaming).toBe(true);
    expect(data.dash).toBe(true);
    expect(data.mediaCenter).toBe(true);
    expect(data.attachmentDownload).toBe(true);
    expect(data.youtubeRelay).toBe(true);
    expect(data.instagramPublicRelay).toBe(true);
  });
  it("attaches safe Content-Disposition filenames for direct media downloads", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "video/x-matroska",
            "Content-Length": "3",
            "Accept-Ranges": "bytes",
          },
        }),
    ) as typeof fetch;
    const endpoint = new URL("https://youtv.workers.dev/proxy");
    endpoint.searchParams.set("url", "https://cdn.example/video.mkv");
    endpoint.searchParams.set("download", "1");
    endpoint.searchParams.set("filename", "فیلم نهایی.mkv");
    const response = await worker.fetch(
      new Request(endpoint, { headers: { Origin: origin } }),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      "filename*=UTF-8''",
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "Content-Disposition",
    );
  });
});
