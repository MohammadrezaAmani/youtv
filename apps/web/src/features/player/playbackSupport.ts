/** Select from tested capabilities. A User-Agent is not proof that native
 * HLS can decode this source or sustain its relay/network requirements. */
export type PlaybackEngine = "native" | "hlsjs" | "unsupported";

export function isAppleMobileBrowser(
  userAgent: string,
  platform = "",
  touchPoints = 0,
): boolean {
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Mac/i.test(platform) && touchPoints > 1)
  );
}

export function selectPlaybackEngine(options: {
  isHls: boolean;
  nativeHls: boolean;
  hlsJsSupported: boolean;
  appleMobile: boolean;
  /** Routing is independent of decoder capability. */
  relayed?: boolean;
  failedEngines?: readonly PlaybackEngine[];
}): PlaybackEngine {
  if (!options.isHls) return "native";
  const failed = options.failedEngines ?? [];
  if (options.hlsJsSupported && !failed.includes("hlsjs")) return "hlsjs";
  if (options.nativeHls && !failed.includes("native")) return "native";
  return "unsupported";
}

/** A secured (HTTPS) application cannot play ordinary HTTP streams directly. */
export function isBlockedMixedMedia(
  appProtocol: string,
  mediaUrl: string,
): boolean {
  return appProtocol === "https:" && /^http:\/\//i.test(mediaUrl);
}

/** Loading another video or pausing before play() settles rejects the pending
 * Promise with AbortError. It is not a persistent stream failure. */
export function isInterruptedPlay(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" &&
    (/interrupted|aborted|abort|new load request|call to pause/.test(message) ||
      message.length === 0)
  );
}

/** User action is necessary when the browser rejects an autoplay attempt. */
export function needsUserPlayGesture(error: unknown): boolean {
  return (
    error instanceof Error &&
    /NotAllowedError|user gesture|user interaction|play\(\) failed/i.test(
      `${error.name}: ${error.message}`,
    )
  );
}
