/** Playback selection shared by the single player and the multi-view tiles.
 * iOS Safari (including browsers using WebKit on iOS) should prefer the
 * operating system's HLS decoder over Managed Media Source/hls.js.
 */
export type PlaybackEngine = 'native' | 'hlsjs' | 'unsupported';

export function isAppleMobileBrowser(userAgent: string, platform = '', touchPoints = 0): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && touchPoints > 1);
}

export function selectPlaybackEngine(options: {
  isHls: boolean;
  nativeHls: boolean;
  hlsJsSupported: boolean;
  appleMobile: boolean;
}): PlaybackEngine {
  if (!options.isHls) return 'native';
  if (options.nativeHls && (options.appleMobile || !options.hlsJsSupported)) return 'native';
  if (options.hlsJsSupported) return 'hlsjs';
  return options.nativeHls ? 'native' : 'unsupported';
}

/** A secured (HTTPS) application cannot play ordinary HTTP streams directly. */
export function isBlockedMixedMedia(appProtocol: string, mediaUrl: string): boolean {
  return appProtocol === 'https:' && /^http:\/\//i.test(mediaUrl);
}

/** User action is necessary when the browser rejects an autoplay attempt. */
export function needsUserPlayGesture(error: unknown): boolean {
  return error instanceof Error && /NotAllowedError|user gesture|user interaction|play\(\) failed/i.test(`${error.name}: ${error.message}`);
}
