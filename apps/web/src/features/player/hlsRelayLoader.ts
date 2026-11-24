import Hls from "hls.js";
import type { WorkerProfile } from "@youtv/shared";
import { hlsRequestRoute, hlsResponseBase, normalizeRelayPlaylist } from "./hlsRelayRoutes";
import type { HlsFragmentPrefetcher, PrefetchPayload } from "./hlsPrefetch";

/** Preserve hls.js retries, aborts, Range and buffering while routing requests
 * through the selected Worker. Completed speculative fragments are served
 * from a local Blob URL; an in-flight prefetch is joined without discarding
 * already downloaded bytes. A failed prefetch falls back to the native loader. */
export function hlsRelayLoader(
  worker: WorkerProfile,
  initial: string,
  prefetcher?: HlsFragmentPrefetcher,
): typeof Hls.DefaultConfig.loader {
  const BaseLoader = Hls.DefaultConfig.loader;
  type LoadArgs = Parameters<InstanceType<typeof BaseLoader>["load"]>;
  return class RelayLoader extends BaseLoader {
    private cachedObjectUrl: string | null = null;
    private generation = 0;
    private releaseForeground: (() => void) | null = null;
    private abortPending: (() => void) | null = null;

    private finishForeground(): void {
      this.releaseForeground?.();
      this.releaseForeground = null;
    }

    private releaseCachedObjectUrl(): void {
      if (!this.cachedObjectUrl) return;
      URL.revokeObjectURL(this.cachedObjectUrl);
      this.cachedObjectUrl = null;
    }

    abort(): void {
      this.generation++;
      this.finishForeground();
      this.releaseCachedObjectUrl();
      const abortPending = this.abortPending;
      this.abortPending = null;
      if (abortPending) abortPending();
      else super.abort();
    }

    destroy(): void {
      this.generation++;
      this.finishForeground();
      this.releaseCachedObjectUrl();
      this.abortPending = null;
      super.destroy();
    }

    load(context: LoadArgs[0], config: LoadArgs[1], callbacks: LoadArgs[2]): void {
      const playlist = ["manifest", "level", "audioTrack", "subtitleTrack"].includes(String(context.type));
      const url = hlsRequestRoute(context.url, worker, initial, playlist);
      const routedContext = { ...context, url };
      const generation = ++this.generation;
      // Only media fragments use the speculative cache; never keys, manifests,
      // subtitles or initialization segments.
      const frag = (context as typeof context & { frag?: { sn?: number | string; duration?: number; type?: string } }).frag;
      const fragmentContext = context as typeof context & { part?: unknown; resetIV?: boolean };
      const media = !playlist && !fragmentContext.part && !fragmentContext.resetIV && typeof frag?.sn === "number" && (frag.type === "main" || frag.type === "audio");
      this.finishForeground();
      if (media && prefetcher) this.releaseForeground = prefetcher.reserveForeground(url, context.rangeStart, context.rangeEnd);
      const claimed = media ? prefetcher?.claim(url, context.rangeStart, context.rangeEnd, () => this.generation === generation) : null;

      const callbacksWithRouting = {
        ...callbacks,
        onSuccess: (response: Parameters<typeof callbacks.onSuccess>[0], stats: Parameters<typeof callbacks.onSuccess>[1], loadedContext: Parameters<typeof callbacks.onSuccess>[2], networkDetails: Parameters<typeof callbacks.onSuccess>[3]) => {
          this.finishForeground();
          this.releaseCachedObjectUrl();
          if (media && frag?.duration) {
            prefetcher?.observe(stats.loading.end - stats.loading.start, stats.loading.first - stats.loading.start, frag.duration);
          }
          const base = typeof response.data === "string"
            ? hlsResponseBase(response.data, url, worker, this.getResponseHeader?.("X-YouTV-Source-URL") ?? null)
            : undefined;
          const normalized = base && typeof response.data === "string"
            ? { ...response, url: base, data: normalizeRelayPlaylist(response.data, base) }
            : response;
          callbacks.onSuccess(normalized, stats, loadedContext, networkDetails);
        },
        onError: (...args: Parameters<typeof callbacks.onError>) => { this.finishForeground(); callbacks.onError(...args); },
        onTimeout: (...args: Parameters<typeof callbacks.onTimeout>) => { this.finishForeground(); callbacks.onTimeout(...args); },
        onAbort: (...args: Parameters<NonNullable<typeof callbacks.onAbort>>) => { this.finishForeground(); callbacks.onAbort?.(...args); },
      };

      if (!claimed) {
        super.load(routedContext, config, callbacksWithRouting);
        return;
      }
      this.stats.loading.start = performance.now();
      this.abortPending = () => {
        this.stats.aborted = true;
        callbacks.onAbort?.(this.stats, routedContext, null);
      };
      void claimed.then((payload) => {
        if (this.generation !== generation) return;
        this.abortPending = null;
        if (!payload) { super.load(routedContext, config, callbacksWithRouting); return; }
        serveCached(payload);
      });

      const serveCached = (payload: PrefetchPayload): void => {
        const cached = payload.blob;
        let objectUrl: string;
        try {
          this.releaseCachedObjectUrl();
          objectUrl = URL.createObjectURL(cached);
        } catch {
          super.load(routedContext, config, callbacksWithRouting);
          return;
        }
        this.cachedObjectUrl = objectUrl;
        const cachedHeaders = routedContext.headers ? { ...routedContext.headers } : undefined;
        if (cachedHeaders) {
          for (const name of Object.keys(cachedHeaders)) {
            if (name.toLowerCase() === "range") delete cachedHeaders[name];
          }
        }
        const cachedContext = {
          ...routedContext,
          url: objectUrl,
          rangeStart: undefined,
          rangeEnd: undefined,
          headers: cachedHeaders,
        };
        super.load(cachedContext, config, {
          ...callbacks,
          onSuccess: (response, stats, _loadedContext, networkDetails) => {
            this.finishForeground();
            this.releaseCachedObjectUrl();
            // Local Blob speed is not network speed. Preserve the actual fetch
            // duration for hls.js ABR so a cache hit cannot force a huge upshift.
            const end = performance.now();
            stats.loading.start = Math.max(0.001, end - Math.max(1, payload.elapsedMs));
            stats.loading.first = Math.min(end, stats.loading.start + Math.min(payload.firstByteMs, payload.elapsedMs));
            stats.loading.end = end;
            callbacks.onSuccess({ ...response, url }, stats, routedContext, networkDetails);
          },
          onError: (error, _loadedContext, networkDetails, ...rest) => {
            this.finishForeground();
            this.releaseCachedObjectUrl();
            callbacks.onError(error, routedContext, networkDetails, ...rest);
          },
          onTimeout: (stats, _loadedContext, networkDetails) => {
            this.finishForeground();
            this.releaseCachedObjectUrl();
            callbacks.onTimeout(stats, routedContext, networkDetails);
          },
          onAbort: (stats, _loadedContext, networkDetails) => {
            this.finishForeground();
            this.releaseCachedObjectUrl();
            callbacks.onAbort?.(stats, routedContext, networkDetails);
          },
          onProgress: callbacks.onProgress
            ? (stats, _loadedContext, data, networkDetails) => {
                callbacks.onProgress!(stats, routedContext, data, networkDetails);
              }
            : undefined,
        });
      };
    }
  };
}
