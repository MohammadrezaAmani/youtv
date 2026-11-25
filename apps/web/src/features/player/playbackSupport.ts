/** Playback selection shared by the single player and the multi-view tiles.
 * iOS Safari (including browsers using WebKit on iOS) should prefer the
 * operating system's HLS decoder over Managed Media Source/hls.js.
 */
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
  /** Non-Apple devices can use the relay loader for nested HLS requests. */
  relayed?: boolean;
}): PlaybackEngine {
  if (!options.isHls) return "native";
  // The native iOS fullscreen player must own playlist refresh and media
  // loading. A JavaScript/MMS session can stop advancing after entering it.
  // The relay already rewrites nested HLS URIs to the configured Worker.
  if (options.nativeHls && options.appleMobile) return "native";
  if (options.relayed && options.hlsJsSupported) return "hlsjs";
  if (options.nativeHls && !options.hlsJsSupported)
    return "native";
  if (options.hlsJsSupported) return "hlsjs";
  return options.nativeHls ? "native" : "unsupported";
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
