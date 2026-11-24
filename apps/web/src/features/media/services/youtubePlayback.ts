import type { WorkerProfile } from "@youtv/shared";
import { workerEndpoint } from "@/lib/proxy";
import type { YouTubeFormat } from "./youtube";

/** YouTube.js v18.3.0 uses format_filter as an exclusion predicate. */
export function excludeDashFormat(
  format: { itag?: number; drm_families?: unknown[]; fair_play_key_uri?: unknown },
  selected?: ReadonlySet<number>,
): boolean {
  return Boolean(format.drm_families?.length || format.fair_play_key_uri ||
    (selected && !selected.has(Number(format.itag))));
}

/** Use exactly the same audio selection for preview and muxed download. */
export function chooseYouTubeAudio(formats: YouTubeFormat[], selected: YouTubeFormat | undefined, combine: boolean): YouTubeFormat | undefined {
  if (!combine || selected?.kind !== "video") return undefined;
  return formats.filter(format => format.kind === "audio").sort((a, b) => b.bitrate - a.bitrate)[0];
}

/** Only actual YouTube CDN media URLs can enter the selected-format player. */
export function youtubePlaybackUrl(url: URL, worker: WorkerProfile): string {
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "googlevideo.com" || url.hostname.endsWith(".googlevideo.com")) ||
      url.pathname !== "/videoplayback") throw new Error("Invalid YouTube media URL");
  return workerEndpoint(worker, "youtube/fetch", { url: url.toString() });
}

/** Check the actual selected media before handing the URL to the HTML player.
 * Cancel immediately: do not buffer an entire response if Range is ignored. */
export async function probeYouTubePlayback(url: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new DOMException("Media probe timed out", "TimeoutError")), 12000);
  let response: Response | undefined;
  try {
    response = await fetch(url, { headers: { Range: "bytes=0-1023" }, credentials: "omit", cache: "no-store", signal: controller.signal });
    const [mediaType = ""] = (response.headers.get("content-type") ?? "").split(";");
    const type = mediaType.trim().toLowerCase();
    if (!response.ok || !response.body || !(type.startsWith("video/") || type.startsWith("audio/") || type === "application/octet-stream" || type === "binary/octet-stream"))
      throw new Error(`Media probe HTTP ${response.status}: ${type || "missing media type"}`);
    signal?.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (response?.body) void response.body.cancel().catch(() => undefined);
  }
}
