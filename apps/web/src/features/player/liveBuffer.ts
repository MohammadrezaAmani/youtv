import { HLS_LOAD_TIMEOUT_MS } from "./hlsPrefetch";

/** Tolerant HLS loading policies for slow/high-latency networks.
 * hls.js defaults can cancel media fragments after ~20 seconds even while the
 * upstream is working. Keep retries inside the loader rather than rebuilding
 * the whole player, which aborts the active fragment and loses progress.
 */
const SLOW_FRAGMENT_RETRY = {
  maxNumRetry: 4,
  retryDelayMs: 1000,
  maxRetryDelayMs: 16000,
  backoff: "exponential",
} as const;
const SLOW_PLAYLIST_RETRY = {
  maxNumRetry: 3,
  retryDelayMs: 1000,
  maxRetryDelayMs: 8000,
  backoff: "exponential",
} as const;
export const SLOW_NETWORK_HLS_POLICY = {
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: HLS_LOAD_TIMEOUT_MS,
      maxLoadTimeMs: HLS_LOAD_TIMEOUT_MS,
      timeoutRetry: SLOW_FRAGMENT_RETRY,
      errorRetry: SLOW_FRAGMENT_RETRY,
    },
  },
  playlistLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: HLS_LOAD_TIMEOUT_MS,
      maxLoadTimeMs: HLS_LOAD_TIMEOUT_MS,
      timeoutRetry: SLOW_PLAYLIST_RETRY,
      errorRetry: SLOW_PLAYLIST_RETRY,
    },
  },
  manifestLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: HLS_LOAD_TIMEOUT_MS,
      maxLoadTimeMs: HLS_LOAD_TIMEOUT_MS,
      timeoutRetry: SLOW_PLAYLIST_RETRY,
      errorRetry: SLOW_PLAYLIST_RETRY,
    },
  },
} as const;

/** Prefer reliable, buffered playback for ordinary IPTV HLS on slower networks.
 * A higher live-sync target trades some delay for fewer stalls; low-latency
 * HLS part loading is intentionally disabled in this profile.
 */
export const LIVE_HLS_PROFILE = {
  ...SLOW_NETWORK_HLS_POLICY,
  enableWorker: true,
  startFragPrefetch: true,
  autoStartLoad: true,
  lowLatencyMode: false,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferSize: 64 * 1024 * 1024,
  backBufferLength: 20,
  liveSyncDurationCount: 10,
  liveMaxLatencyDurationCount: 30,
  maxLiveSyncPlaybackRate: 1,
  maxBufferHole: 0.35,
  capLevelToPlayerSize: false,
} as const;

/** Explicit opt-in for LL-HLS. The default remains reliable, buffered playback.
 * The Worker preserves the delivery directives needed by blocking reloads.
 */
export const LOW_LATENCY_HLS_PROFILE = {
  ...SLOW_NETWORK_HLS_POLICY,
  enableWorker: true,
  startFragPrefetch: true,
  autoStartLoad: true,
  lowLatencyMode: true,
  maxBufferLength: 16,
  maxMaxBufferLength: 48,
  maxBufferSize: 32 * 1024 * 1024,
  backBufferLength: 12,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 7,
  maxLiveSyncPlaybackRate: 1.1,
  maxBufferHole: 0.35,
  capLevelToPlayerSize: false,
} as const;

export function getHlsProfile(mode: "stable" | "low") {
  return mode === "low" ? LOW_LATENCY_HLS_PROFILE : LIVE_HLS_PROFILE;
}

/** Suppress player resets while a media segment is actively downloading. */
export function hasActiveFragmentLoading(
  starts: Iterable<number>,
  now: number,
  maximumMs = HLS_LOAD_TIMEOUT_MS + 30000,
): boolean {
  for (const started of starts) {
    if (Number.isFinite(started) && now >= started && now - started < maximumMs)
      return true;
  }
  return false;
}

export function secondsBufferedAhead(
  currentTime: number,
  ranges: Pick<TimeRanges, "length" | "start" | "end">,
): number {
  for (let i = 0; i < ranges.length; i++) {
    if (
      currentTime >= ranges.start(i) - 0.15 &&
      currentTime <= ranges.end(i) + 0.15
    ) {
      return Math.max(0, ranges.end(i) - currentTime);
    }
  }
  return 0;
}

/**
 * Use already-buffered media when a tiny gap blocks playback; otherwise
 * use the live sync point only after significant drift from the live edge.
 * Never invent missing fragments or jump past an unbuffered gap blindly.
 */
export function recoveryTarget(args: {
  current: number;
  ranges: Pick<TimeRanges, "length" | "start" | "end">;
  live: boolean;
  syncPosition: number | null;
  latency: number;
  targetLatency: number | null;
  stalledForMs: number;
}): number | null {
  const {
    current,
    ranges,
    live,
    syncPosition,
    latency,
    targetLatency,
    stalledForMs,
  } = args;
  if (stalledForMs < 2200) return null;
  if (
    live &&
    syncPosition != null &&
    Number.isFinite(syncPosition) &&
    targetLatency != null &&
    targetLatency > 0 &&
    latency > targetLatency * 2.25 &&
    syncPosition > current + 2
  ) {
    return syncPosition;
  }
  if (secondsBufferedAhead(current, ranges) > 0.4) return null;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    if (
      start > current &&
      start - current <= 1.25 &&
      ranges.end(i) > start + 0.25
    )
      return start + 0.04;
  }
  return null;
}
