import type { WorkerProfile } from "@youtv/shared";
import { proxyUrl } from "@/lib/proxy";
import { mediaError } from "./mediaRoutes";

export type YouTubeSource = { kind: "video" | "playlist"; id: string };
export type YouTubePublicPreview = {
  source: YouTubeSource;
  canonicalUrl: string;
  embedUrl: string;
  metadata: { title: string; author: string; thumbnail: string } | null;
  metadataWorkerId: string | null;
  reason: "bot-check" | "extraction-failed";
  detail: string;
};

export function isYouTubeBotCheck(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value);
  return /sign\s*in\s*to\s*confirm\s*(?:that\s*)?you(?:['’\u02bc]?re|\s+are)\s*not\s*a\s*bot/i.test(message);
}

/** Public metadata only. Never treat oEmbed HTML or its response as a stream. */
export async function resolveYouTubePublicPreview(
  source: YouTubeSource,
  workers: WorkerProfile[],
  cause: unknown,
  signal?: AbortSignal,
  allowDirect = false,
): Promise<YouTubePublicPreview> {
  signal?.throwIfAborted();
  const video = source.kind === "video";
  if (video ? !/^[A-Za-z0-9_-]{11}$/.test(source.id) : !/^[A-Za-z0-9_-]{10,150}$/.test(source.id)) {
    throw new Error("Invalid YouTube source ID");
  }
  const canonicalUrl = video
    ? `https://www.youtube.com/watch?v=${source.id}`
    : `https://www.youtube.com/playlist?list=${source.id}`;
  const embedUrl = video
    ? `https://www.youtube-nocookie.com/embed/${source.id}`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=${source.id}`;
  const result: YouTubePublicPreview = {
    source, canonicalUrl, embedUrl, metadata: null, metadataWorkerId: null,
    reason: isYouTubeBotCheck(cause) ? "bot-check" : "extraction-failed",
    detail: mediaError(cause),
  };
  // Playlist oEmbed does not reliably return a list of videos. Do not invent one.
  if (!video) return result;
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", canonicalUrl);
  endpoint.searchParams.set("format", "json");
  for (const worker of [...workers, ...(allowDirect ? [undefined] : [])]) {
    signal?.throwIfAborted();
    try {
      const timeout = AbortSignal.timeout(8000);
      const response = await fetch(worker ? proxyUrl(endpoint.toString(), worker) : endpoint.toString(), {
        credentials: "omit", cache: "no-store",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok || !/application\/(?:[^;]+\+)?json/i.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      const data = await response.json() as Record<string, unknown> | null;
      if (!data || data.type !== "video" || typeof data.title !== "string" || !data.title.trim()) continue;
      let thumbnail = "";
      if (typeof data.thumbnail_url === "string") {
        try {
          const url = new URL(data.thumbnail_url);
          if (url.protocol === "https:" && !url.username && !url.password && ["i.ytimg.com", "img.youtube.com"].includes(url.hostname)) thumbnail = url.toString();
        } catch { /* Ignore invalid thumbnails, not metadata. */ }
      }
      signal?.throwIfAborted();
      result.metadata = { title: data.title.trim().slice(0, 500), author: typeof data.author_name === "string" ? data.author_name.slice(0, 300) : "", thumbnail };
      result.metadataWorkerId = worker?.id ?? null;
      return result;
    } catch { signal?.throwIfAborted(); }
  }
  return result;
}
