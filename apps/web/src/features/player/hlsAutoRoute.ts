import type { ProxyResult } from "@/lib/proxy";
import { hlsRequestRoute, normalizeRelayPlaylist } from "./hlsRelayRoutes";

export type StartupResponse = { url: string; data: string | Blob; elapsedMs: number; firstByteMs: number };
export type StartupTransfer = {
  completion: Promise<StartupResponse>;
  start: number; first: number; loaded: number; total: number; lastProgress: number;
  abort: () => void;
};
export type HlsAutoRoute = { route: ProxyResult; responses: Map<string, StartupTransfer>; dispose: () => void };
const MAX_PLAYLIST_BYTES = 256 * 1024;
const MAX_FRAGMENT_BYTES = 2 * 1024 * 1024;
class InconclusiveProbe extends Error {}

async function readBounded(response: Response, max: number, signal: AbortSignal, progress: (bytes: number) => void): Promise<Blob> {
  if (!response.ok || !response.body || /text\/html|application\/json/i.test(response.headers.get("Content-Type") || "")) throw new Error("Invalid media response");
  if (Number(response.headers.get("Content-Length")) > max) throw new InconclusiveProbe("Probe exceeds byte budget");
  if (response.status === 206) {
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") || "");
    if (!range || Number(range[1]) + 1 !== Number(range[2])) throw new Error("Incomplete media response");
  }
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) throw new InconclusiveProbe("Probe exceeds byte budget");
      chunks.push(new Uint8Array(value));
      progress(bytes);
    }
    if (!bytes) throw new Error("Empty media response");
    return new Blob(chunks);
  } finally { void reader.cancel().catch(() => undefined); }
}

/** Only an optimization: ambiguous/unsupported playlists keep ordinary loading.
 * Two bounded essential probes, no health endpoint and no HEAD-only verdict. */
export async function chooseHlsAutoRoute(
  direct: ProxyResult,
  proxy: ProxyResult,
  signal: AbortSignal,
  options: { timeoutMs?: number; fetcher?: typeof fetch } = {},
): Promise<HlsAutoRoute> {
  const controllers = [new AbortController(), new AbortController()];
  const caches = [new Map<string, StartupTransfer>(), new Map<string, StartupTransfer>()];
  const failed = [false, false];
  let committed = false;
  const stop = () => controllers.forEach(controller => controller.abort());
  const dispose = () => { stop(); signal.removeEventListener("abort", stop); caches.forEach(cache => cache.clear()); };
  signal.throwIfAborted();
  signal.addEventListener("abort", stop, { once: true });
  const fetcher = options.fetcher ?? fetch;
  const probe = async (route: ProxyResult, index: number): Promise<HlsAutoRoute> => {
    const controller = controllers[index]!, responses = caches[index]!;
    const request = (url: string, playlist: boolean): Promise<StartupResponse> => {
      const requestUrl = route.worker ? hlsRequestRoute(url, route.worker, route.url, playlist) : url;
      const start = performance.now();
      const transfer = { start, first: 0, loaded: 0, total: 0, lastProgress: start, abort: () => controller.abort() };
      const completion = (async () => {
        const deadline = setTimeout(() => controller.abort(), 300_000);
        let response: Response | undefined;
        try {
          response = await fetcher(requestUrl, { signal: controller.signal, credentials: "omit", priority: "high" } as RequestInit & { priority: "high" });
          transfer.first = performance.now();
          transfer.total = Math.max(0, Number(response.headers.get("Content-Length")) || 0);
          const blob = await readBounded(response, playlist ? MAX_PLAYLIST_BYTES : MAX_FRAGMENT_BYTES, controller.signal, bytes => {
            transfer.loaded = bytes; transfer.lastProgress = performance.now();
          });
          const base = route.worker ? response.headers.get("X-YouTV-Source-URL") || requestUrl : response.url || requestUrl;
          const text = playlist ? await blob.text() : null;
          if (text !== null && !/^\s*#EXTM3U(?:\s|$)/.test(text)) throw new Error("Invalid HLS playlist");
          // Match ordinary direct loading exactly. HLS.js compares relative
          // URI spellings across live updates, not only resolved URLs.
          return { url: base, data: text === null ? blob : route.worker ? normalizeRelayPlaylist(text, base) : text, elapsedMs: performance.now() - start, firstByteMs: transfer.first - start };
        } finally {
          clearTimeout(deadline);
          if (!controller.signal.aborted) await response?.body?.cancel().catch(() => undefined);
        }
      })();
      responses.set(requestUrl, Object.assign(transfer, { completion }));
      return completion;
    };
    let url = route.url;
    for (let depth = 0; depth < 3; depth++) {
      const response = await request(url, true);
      if (committed) throw new InconclusiveProbe("Route already selected");
      const text = response.data as string;
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      // Variable substitution and byte-range state belong to HLS.js, not a
      // second partial HLS parser. Never guess or seed incorrectly sliced bytes.
      if (/\{\$|#EXT-X-(?:BYTERANGE|DEFINE|SKIP|PART):/.test(text)) throw new InconclusiveProbe("Use ordinary HLS loading");
      const variant = lines.findIndex(line => line.startsWith("#EXT-X-STREAM-INF:"));
      if (variant >= 0) {
        const child = lines.slice(variant + 1).find(line => !line.startsWith("#"));
        if (!child) throw new Error("No media playlist");
        url = new URL(child, response.url).href;
        continue;
      }
      if (!lines.some(line => line.startsWith("#EXTINF:"))) throw new Error("No published fragments");
      const fragments = lines.filter(line => !line.startsWith("#"));
      const live = !lines.includes("#EXT-X-ENDLIST");
      // Match the stable player's ten-segment live sync; VOD begins at zero.
      const fragment = fragments[live ? Math.max(0, fragments.length - 10) : 0];
      if (!fragment) throw new Error("No published fragments");
      await request(new URL(fragment, response.url).href, false);
      controller.signal.throwIfAborted();
      return { route, responses, dispose };
    }
    throw new InconclusiveProbe("Use ordinary HLS loading");
  };
  const fallback = (): HlsAutoRoute => {
    const index = failed[0] && !failed[1] ? 1 : 0;
    return { route: index ? proxy : direct, responses: caches[index]!, dispose };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const healthy = Promise.any([direct, proxy].map((route, index) => probe(route, index).catch(error => { failed[index] = !(error instanceof InconclusiveProbe); throw error; }))).catch(fallback);
    const bounded = new Promise<HlsAutoRoute>(resolve => { timer = setTimeout(() => resolve(fallback()), options.timeoutMs ?? 4000); });
    const result = await Promise.race([healthy, bounded]);
    signal.throwIfAborted();
    committed = true;
    const loser = result.route.mode === "direct" ? 1 : 0;
    controllers[loser]!.abort();
    caches[loser]!.clear();
    // At the decision deadline, retain the selected in-flight download. Its
    // promise and genuine byte counters are adopted by the ordinary HLS loader.
    return result;
  } catch (error) { dispose(); throw error; }
  finally { clearTimeout(timer); }
}
