import { describe, expect, it } from "vitest";
import { playbackSessionIdentity, releasePlayback } from "@/features/player/playbackLifecycle";

function fixture() {
  const calls: string[] = [];
  const video = { pause: () => { calls.push("pause"); }, removeAttribute: (name: string) => { calls.push(`remove:${name}`); }, load: () => { calls.push("load"); } };
  const hls = { stopLoad: () => { calls.push("stop"); }, destroy: () => { calls.push("destroy"); } };
  const dash = { reset: () => { calls.push("reset"); } };
  return { calls, video, hls, dash };
}

describe("channel playback teardown", () => {
  it("isolates channels even if their stream URLs are identical", () => {
    const a = { id: "a", url: "https://example.org/live.m3u8", alternateUrls: [] };
    const b = { ...a, id: "b" };
    expect(playbackSessionIdentity(a) === playbackSessionIdentity(b)).toBe(false);
    expect(playbackSessionIdentity(a)).toBe(playbackSessionIdentity({ ...a }));
    expect(playbackSessionIdentity(a) === playbackSessionIdentity({ ...a, alternateUrls: ["https://example.org/backup.m3u8"] })).toBe(false);
  });
  it("stops HLS requests and releases the old browser media source", () => {
    const { calls, video, hls } = fixture();
    releasePlayback(video, hls);
    expect(calls).toEqual(["pause", "stop", "destroy", "remove:src", "load"]);
  });
  it("releases native and DASH sessions as well", () => {
    const { calls, video, dash } = fixture();
    releasePlayback(video, null, dash);
    expect(calls).toEqual(["pause", "reset", "remove:src", "load"]);
  });
  it("still releases media when an engine's teardown throws", () => {
    const { calls, video, hls, dash } = fixture();
    releasePlayback(video, { ...hls, stopLoad: () => { throw new Error("stopped"); }, destroy: () => { throw new Error("destroyed"); } }, dash);
    expect(calls).toEqual(["pause", "reset", "remove:src", "load"]);
  });
});
