export type PlaybackPreparation = {
  phase: "connecting" | "buffering" | "waiting" | "ready";
  elapsedSeconds: number;
  bufferedSeconds: number;
  targetSeconds: number;
  downloadedBytes: number;
  totalBytes: number;
  etaSeconds: number | null;
  inactiveSeconds: number;
};

/** Estimates need both a measured transfer rate and a known media bitrate.
 * Unknown size/speed is shown as unknown, never as a made-up countdown. */
export function playbackPreparation(input: {
  elapsedMs: number;
  inactivityMs: number;
  bufferedSeconds: number;
  targetSeconds: number;
  downloadedBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  mediaBitsPerSecond: number;
  nativeReady?: boolean;
}): PlaybackPreparation {
  const bufferedSeconds = Math.max(0, input.bufferedSeconds);
  const targetSeconds = Math.max(.1, input.targetSeconds);
  const ready = input.nativeReady || bufferedSeconds + .35 >= targetSeconds;
  const waiting = !ready && input.inactivityMs >= 5000;
  const remaining = Math.max(0, targetSeconds - bufferedSeconds);
  const etaSeconds = ready ? 0 : !waiting && input.bytesPerSecond > 0 && input.mediaBitsPerSecond > 0
    ? Math.max(1, Math.ceil(remaining * input.mediaBitsPerSecond / 8 / input.bytesPerSecond))
    : null;
  return {
    phase: ready ? "ready" : waiting ? "waiting" : input.downloadedBytes > 0 || bufferedSeconds > 0 ? "buffering" : "connecting",
    elapsedSeconds: Math.floor(Math.max(0, input.elapsedMs) / 1000),
    inactiveSeconds: Math.floor(Math.max(0, input.inactivityMs) / 1000),
    bufferedSeconds, targetSeconds, downloadedBytes: input.downloadedBytes,
    totalBytes: input.totalBytes, etaSeconds,
  };
}
