import type { Channel } from "@youtv/shared";

/** Metadata and viewport changes are not new sessions. Actual sources are. */
export function playbackSessionIdentity(channel: Pick<Channel, "id" | "url" | "alternateUrls">, prepared?: { url: string; kind: string }): string {
  return JSON.stringify([channel.id, channel.url, channel.alternateUrls ?? [], prepared?.url, prepared?.kind]);
}

type Media = Pick<HTMLMediaElement, "pause" | "removeAttribute" | "load">;
type HlsSession = { stopLoad(): void; destroy(): void };
type DashSession = { reset(): void };

/** Release only the resources owned by this session. One failing cleanup
 * must not prevent the remaining engine or the browser network from stopping. */
export function releasePlayback(video: Media, hls?: HlsSession | null, dash?: DashSession): void {
  try { video.pause(); } catch { /* detached media */ }
  try { hls?.stopLoad(); } catch { /* already stopped */ }
  try { hls?.destroy(); } catch { /* already destroyed */ }
  try { dash?.reset(); } catch { /* already reset */ }
  try { video.removeAttribute("src"); } catch { /* detached media */ }
  try { video.load(); } catch { /* detached media */ }
}
