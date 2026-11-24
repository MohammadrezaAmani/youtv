/** Discover a real current player ID from a public YouTube page, never a hard-coded ID. */
export function extractPlayerId(source: string): string | undefined {
  const normalized = source.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/");
  return normalized.match(/\/s\/player\/([A-Za-z0-9_-]{6,64})\//)?.[1]
    || normalized.match(/\bplayer\/([A-Za-z0-9_-]{6,64})\//)?.[1];
}
export async function discoverPlayerId(fetcher: typeof fetch, videoId?: string): Promise<string> {
  const urls = videoId ? [
    `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`,
    "https://www.youtube.com/",
  ] : ["https://www.youtube.com/"];
  for (const url of urls) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) { await response.body?.cancel().catch(() => undefined); continue; }
      const id = extractPlayerId(await response.text());
      if (id) return id;
    } catch { /* try the next real page */ }
  }
  throw new Error("No current player ID found in public YouTube pages");
}
