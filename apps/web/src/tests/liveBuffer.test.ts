import { describe, it, expect } from "vitest";
import {
  LIVE_HLS_PROFILE,
  getHlsProfile,
  recoveryTarget,
  secondsBufferedAhead,
  hasActiveFragmentLoading,
} from "../features/player/liveBuffer";
function ranges(
  ...items: [number, number][]
): Pick<TimeRanges, "length" | "start" | "end"> {
  return {
    length: items.length,
    start: (index) => items[index]![0],
    end: (index) => items[index]![1],
  };
}
describe("Live HLS buffering and gap recovery", () => {
  it("prefetches and maintains several seconds of forward buffer", () => {
    expect(LIVE_HLS_PROFILE.startFragPrefetch).toBe(true);
    expect(LIVE_HLS_PROFILE.maxBufferLength).toBeGreaterThan(15);
    expect(LIVE_HLS_PROFILE.maxMaxBufferLength).toBeGreaterThanOrEqual(
      LIVE_HLS_PROFILE.maxBufferLength,
    );
  });
  it("measures buffer at current playback position, not last unrelated range", () => {
    expect(secondsBufferedAhead(12, ranges([0, 3], [10, 18], [30, 40]))).toBe(
      6,
    );
    expect(secondsBufferedAhead(21, ranges([0, 3], [10, 18]))).toBe(0);
  });
  it("does not jump a video that is already buffered", () => {
    expect(
      recoveryTarget({
        current: 12,
        ranges: ranges([10, 30]),
        live: false,
        syncPosition: null,
        latency: 0,
        targetLatency: null,
        stalledForMs: 3000,
      }),
    ).toBe(null);
  });
  it("nudges only across a nearby buffered gap when stalled", () => {
    const data = {
      current: 12,
      ranges: ranges([8, 11.9], [12.45, 20]),
      live: false,
      syncPosition: null,
      latency: 0,
      targetLatency: null,
    };
    expect(recoveryTarget({ ...data, stalledForMs: 1500 })).toBe(null);
    expect(recoveryTarget({ ...data, stalledForMs: 3500 })).toBeCloseTo(12.49);
  });
  it("recovers excessive live drift but does not continuously seek for normal latency", () => {
    const data = {
      current: 18,
      ranges: ranges([15, 25]),
      live: true,
      syncPosition: 32,
      targetLatency: 9,
    };
    expect(recoveryTarget({ ...data, latency: 10, stalledForMs: 4000 })).toBe(
      null,
    );
    expect(recoveryTarget({ ...data, latency: 29, stalledForMs: 4000 })).toBe(
      32,
    );
  });
});

describe("Slow HLS network tolerance", () => {
  it("does not cancel a slow but active media fragment after 22 seconds", () => {
    const policy = LIVE_HLS_PROFILE.fragLoadPolicy.default;
    expect(policy.maxTimeToFirstByteMs).toBeGreaterThan(22000);
    expect(policy.maxLoadTimeMs).toBeGreaterThan(90000);
    expect(policy.timeoutRetry.maxNumRetry).toBeGreaterThanOrEqual(3);
    expect(policy.errorRetry.maxNumRetry).toBeGreaterThanOrEqual(3);
    expect(hasActiveFragmentLoading([1000], 25000)).toBe(true);
    expect(hasActiveFragmentLoading([1000], 80000)).toBe(true);
    expect(hasActiveFragmentLoading([1000], 220000)).toBe(false);
  });
  it("keeps a bounded retry policy for slow live manifests", () => {
    expect(
      LIVE_HLS_PROFILE.playlistLoadPolicy.default.maxTimeToFirstByteMs,
    ).toBeGreaterThan(8000);
    expect(
      LIVE_HLS_PROFILE.manifestLoadPolicy.default.maxLoadTimeMs,
    ).toBeGreaterThan(20000);
    expect(LIVE_HLS_PROFILE.lowLatencyMode).toBe(false);
  });
});

describe("Selectable HLS latency profiles", () => {
  it("defaults to stable buffered HLS on slower connections", () => {
    expect(getHlsProfile("stable").lowLatencyMode).toBe(false);
    expect(getHlsProfile("stable").maxBufferLength).toBeGreaterThan(30);
  });
  it("enables low latency explicitly without changing the stable profile", () => {
    expect(getHlsProfile("low").lowLatencyMode).toBe(true);
    expect(getHlsProfile("low").maxBufferLength).toBeLessThan(
      getHlsProfile("stable").maxBufferLength,
    );
  });
});
