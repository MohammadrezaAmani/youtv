import { describe, expect, it } from "vitest";
import {
  dashBaseTarget,
  dashRequestToken,
  isDash,
  rewriteDash,
} from "../src/dash.ts";

describe("MPEG-DASH Worker rewriting", () => {
  it("detects MPD by extension and MIME type", () => {
    expect(isDash(new URL("https://cdn.example/live.mpd"))).toBe(true);
    expect(
      isDash(new URL("https://cdn.example/stream.php"), "application/dash+xml"),
    ).toBe(true);
    expect(isDash(new URL("https://cdn.example/video.mp4"), "video/mp4")).toBe(
      false,
    );
  });
  it("rewrites BaseURL, Location, UTCTiming and absolute segment templates", () => {
    const source = new URL("https://origin.example/live/main.mpd");
    const worker = new URL("https://youtv.workers.dev/");
    const mpd =
      '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Location>https://origin.example/live/next.mpd</Location><Period><BaseURL>https://cdn.example/root/</BaseURL><AdaptationSet><SegmentTemplate media="$RepresentationID$/$Number%06d$.m4s" initialization="$RepresentationID$/init.mp4"/><Representation id="v1"/></AdaptationSet><UTCTiming schemeIdUri="urn:mpeg:mpeg:dash:utc:http-iso:2014" value="https://time.example/utc"/></Period></MPD>';
    const output = rewriteDash(mpd, source, worker, "token");
    const bases = [...output.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map(
      (match) => match[1]!,
    );
    expect(
      dashBaseTarget(new URL("v1/000001.m4s", bases[1]), {}).toString(),
    ).toBe("https://cdn.example/root/v1/000001.m4s");
    expect(dashRequestToken(new URL("v1/000001.m4s", bases[1]))).toBe("token");
    expect(output).toContain("$RepresentationID$/$Number%06d$.m4s");
    expect(output).toMatch(/dash-base\/v1\/[^/]+\/live\/next\.mpd/);
    expect(output).toMatch(/dash-base\/v1\/[^/]+\/utc/);
  });
  it("inserts a proxy BaseURL when the MPD has none", () => {
    const output = rewriteDash(
      '<MPD><Period><SegmentTemplate media="seg-$Number$.m4s"/><Representation id="1"/></Period></MPD>',
      new URL("https://origin.example/path/live.mpd"),
      new URL("https://worker.example/"),
    );
    const base = output.match(/<BaseURL>([^<]+)<\/BaseURL>/)![1]!;
    expect(dashBaseTarget(new URL("seg-1.m4s", base), {}).toString()).toBe(
      "https://origin.example/path/seg-1.m4s",
    );
  });
  it("resolves relative DASH segment paths against the encoded BaseURL and preserves base query tokens", () => {
    const request = new URL(
      "https://worker.example/dash-base/v1/000001.m4s?base=https%3A%2F%2Fcdn.example%2Fstream%2F%3Ftoken%3Dabc",
    );
    const target = dashBaseTarget(request, { ALLOWED_HOSTS: "*" });
    expect(target.toString()).toBe(
      "https://cdn.example/stream/v1/000001.m4s?token=abc",
    );
  });
});
