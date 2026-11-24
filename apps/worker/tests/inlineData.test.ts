import { describe, expect, it } from "vitest";
import { rewriteHls } from "../src/hls.ts";

const source = new URL("https://media.example.com/live/master.m3u8");
const worker = new URL("https://proxy.example.workers.dev/proxy");

const rewrite = (manifest: string) =>
  rewriteHls(manifest, source, worker, "secret");

describe("inline HLS data URI regression", () => {
  it("keeps an inline media segment verbatim, with no Worker URL or token", () => {
    const data = "data:video/mp2t;base64,AAECAwQ=";
    const result = rewrite(`#EXTM3U\n#EXTINF:4,\n${data}\n`);
    expect(result.split("\n")[2]).toBe(data);
    expect(result).not.toContain("/proxy?");
    expect(result).not.toContain("secret");
  });

  it("keeps inline init maps, LL-HLS parts and prefetch segments", () => {
    const result = rewrite(
      [
        "#EXTM3U",
        '#EXT-X-MAP:URI="data:video/mp4;base64,AAAA"',
        '#EXT-X-PART:URI="data:video/mp4;base64,AQID",DURATION=0.2',
        '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="data:video/mp4;base64,BAUG"',
        "#EXT-X-PREFETCH:data:video/mp2t;base64,AAAA",
      ].join("\n"),
    );
    expect(result).toContain('URI="data:video/mp4;base64,AAAA"');
    expect(result).toContain('URI="data:video/mp4;base64,AQID"');
    expect(result).toContain('URI="data:video/mp4;base64,BAUG"');
    expect(result).toContain("#EXT-X-PREFETCH:data:video/mp2t;base64,AAAA");
    expect(result).not.toContain("/proxy?");
  });

  it("keeps standard key/session inline data and still proxies network segments", () => {
    const result = rewrite(
      [
        "#EXTM3U",
        '#EXT-X-KEY:METHOD=AES-128,URI="data:application/octet-stream;base64,AQID"',
        '#EXT-X-SESSION-DATA:DATA-ID="info",URI="data:application/json;base64,e30="',
        "#EXTINF:4,",
        "chunk01.ts",
      ].join("\n"),
    );
    expect(result).toContain('URI="data:application/octet-stream;base64,AQID"');
    expect(result).toContain('URI="data:application/json;base64,e30="');
    const segment = result.split("\n").at(-1)!;
    expect(new URL(segment).searchParams.get("url")).toBe(
      "https://media.example.com/live/chunk01.ts",
    );
  });

  it("rejects executable, local file and FTP URI schemes", () => {
    for (const uri of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/a.ts",
    ]) {
      expect(() => rewrite(`#EXTM3U\n#EXTINF:2,\n${uri}`)).toThrow(
        /Unsupported HLS URI scheme/,
      );
      expect(() => rewrite(`#EXTM3U\n#EXT-X-MAP:URI="${uri}"`)).toThrow(
        /Unsupported HLS URI scheme/,
      );
    }
  });

  it("rejects data URIs for network-only steering resources", () => {
    expect(() =>
      rewrite(
        '#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="data:application/json,{}"',
      ),
    ).toThrow(/Unsupported HLS URI scheme/);
  });
});
