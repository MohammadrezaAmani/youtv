// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { buildHlsArchiveEntries } from "./hlsDownload";

type Reply = "correct" | "ignored" | "wrong-range";

async function withRangeServer(
  reply: Reply,
  run: (baseUrl: string, ranges: string[]) => Promise<void>,
) {
  const ranges: string[] = [];
  const server = createServer((request, response) => {
    const base = `http://${request.headers.host}`;
    const target = new URL(request.url || "/", base).searchParams.get("url");
    if (target === "https://origin.example/media.m3u8") {
      const mediaUrl = `${base}/proxy?url=${encodeURIComponent("https://origin.example/media.mp4")}`;
      response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
      response.end([
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-TARGETDURATION:4",
        `#EXT-X-MAP:URI="${mediaUrl}",BYTERANGE="3@0"`,
        "#EXTINF:4,",
        "#EXT-X-BYTERANGE:3@3",
        mediaUrl,
        "#EXTINF:4,",
        "#EXT-X-BYTERANGE:3",
        mediaUrl,
        "#EXT-X-ENDLIST",
      ].join("\n"));
      return;
    }
    if (target !== "https://origin.example/media.mp4") {
      response.writeHead(404).end();
      return;
    }
    const range = request.headers.range || "";
    ranges.push(range);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) {
      response.writeHead(416).end();
      return;
    }
    const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (reply === "ignored") {
      response.writeHead(200).end(data);
      return;
    }
    response.writeHead(206, {
      "Content-Range": reply === "wrong-range" ? "bytes 3-5/9" : `bytes ${start}-${end}/9`,
    });
    response.end(data.subarray(start, end + 1));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, ranges);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
}

function archiveAt(baseUrl: string) {
  return buildHlsArchiveEntries("https://origin.example/media.m3u8", {
    id: "range-test",
    name: "Range test",
    enabled: true,
    baseUrl,
    token: "",
  });
}

describe("HLS byte ranges over real HTTP", () => {
  it("transmits initialization, explicit and implicit ranges and preserves their bytes", async () => {
    await withRangeServer("correct", async (baseUrl, ranges) => {
      const archive = await archiveAt(baseUrl);
      const bytes: number[][] = [];
      for (const entry of archive.entries.filter((entry) => entry.filename.endsWith(".mp4"))) {
        bytes.push(Array.from(new Uint8Array(await new Response(await entry.open()).arrayBuffer())));
      }
      expect(ranges).toEqual(["bytes=0-2", "bytes=3-5", "bytes=6-8"]);
      expect(bytes).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    });
  });
  it("rejects an origin that ignores the byte range", async () => {
    await withRangeServer("ignored", async (baseUrl, ranges) => {
      const archive = await archiveAt(baseUrl);
      await expect(archive.entries[0]!.open()).rejects.toThrow(/Invalid HLS byte-range response/);
      expect(ranges).toEqual(["bytes=0-2"]);
    });
  });
  it("rejects a partial response with the wrong Content-Range", async () => {
    await withRangeServer("wrong-range", async (baseUrl, ranges) => {
      const archive = await archiveAt(baseUrl);
      await expect(archive.entries[0]!.open()).rejects.toThrow(/Invalid HLS byte-range response/);
      expect(ranges).toEqual(["bytes=0-2"]);
    });
  });
});
