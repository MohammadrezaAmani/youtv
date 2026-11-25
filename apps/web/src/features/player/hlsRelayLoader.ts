import Hls from "hls.js";
import type { WorkerProfile } from "@youtv/shared";
import { hlsRequestRoute, hlsResponseBase, normalizeRelayPlaylist } from "./hlsRelayRoutes";
import type { HlsFragmentPrefetcher, HlsPrefetchFragment } from "./hlsPrefetch";

/** Preserve hls.js retries, aborts, Range and buffering while routing requests
 * through the selected Worker. Completed speculative fragments are served
 * directly from cached bytes; an in-flight prefetch is joined without discarding
 * already downloaded bytes. A failed prefetch falls back to the native loader. */
export function hlsRelayLoader(
  worker: WorkerProfile,
  initial: string,
  prefetcher?: HlsFragmentPrefetcher,
): typeof Hls.DefaultConfig.loader {
  const BaseLoader = Hls.DefaultConfig.loader;
  type LoadArgs = Parameters<InstanceType<typeof BaseLoader>["load"]>;
  return class RelayLoader extends BaseLoader {
    private generation = 0;
    private releaseForeground: (() => void) | null = null;
    private abortPending: (() => void) | null = null;

    private finishForeground(): void {
      this.releaseForeground?.();
      this.releaseForeground = null;
    }

    abort(): void {
      this.generation++;
      this.finishForeground();
      const abortPending = this.abortPending;
      this.abortPending = null;
      if (abortPending) abortPending();
      else super.abort();
    }

    destroy(): void {
      this.generation++;
      this.finishForeground();
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
      const frag = (context as typeof context & { frag?: HlsPrefetchFragment }).frag;
      const fragmentContext = context as typeof context & { part?: unknown; resetIV?: boolean };
      const media = !playlist && !fragmentContext.part && !fragmentContext.resetIV && typeof frag?.sn === "number" && (frag.type === "main" || frag.type === "audio");
      this.finishForeground();
      if (media && prefetcher) this.releaseForeground = prefetcher.reserveForeground(url, context.rangeStart, context.rangeEnd, frag);
      const claimed = media ? prefetcher?.claim(url, context.rangeStart, context.rangeEnd, () => this.generation === generation, frag, (loaded, total) => {
        this.stats.loaded = loaded;
        this.stats.total = total || loaded;
        if (loaded > 0 && !this.stats.loading.first) this.stats.loading.first = performance.now();
      }) : null;

      const callbacksWithRouting = {
        ...callbacks,
        onSuccess: (response: Parameters<typeof callbacks.onSuccess>[0], stats: Parameters<typeof callbacks.onSuccess>[1], loadedContext: Parameters<typeof callbacks.onSuccess>[2], networkDetails: Parameters<typeof callbacks.onSuccess>[3]) => {
          this.finishForeground();
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
      this.stats.loading.start = this.stats.loading.first || performance.now();
      this.abortPending = () => {
        this.stats.aborted = true;
        callbacks.onAbort?.(this.stats, routedContext, null);
      };
      const fallback = () => {
        if (this.generation !== generation) return;
        this.abortPending = null;
        // A new native transfer starts with clean timing and progress stats.
        this.stats.loading.start = this.stats.loading.first = this.stats.loading.end = 0;
        this.stats.loaded = this.stats.total = 0;
        super.load(routedContext, config, callbacksWithRouting);
      };
      void claimed.then(async payload => {
        if (this.generation !== generation) return;
        if (!payload) { fallback(); return; }
        let data: ArrayBuffer;
        try { data = await payload.blob.arrayBuffer(); }
        catch { fallback(); return; }
        if (this.generation !== generation) return;
        this.abortPending = null;
        const stats = this.stats;
        const end = performance.now();
        stats.loading.start = Math.max(0.001, end - Math.max(1, payload.elapsedMs));
        stats.loading.first = Math.min(end, stats.loading.start + Math.min(payload.firstByteMs, payload.elapsedMs));
        stats.loading.end = end;
        stats.loaded = stats.total = data.byteLength;
        stats.bwEstimate = data.byteLength * 8000 / Math.max(1, payload.elapsedMs - payload.firstByteMs);
        // Match the standard XHR loader callback order. No Blob URL request,
        // no second Range transformation, and no false local-cache ABR sample.
        this.finishForeground();
        callbacks.onProgress?.(stats, routedContext, data, null);
        if (this.generation !== generation) return;
        callbacks.onSuccess({ url, data, code: context.rangeEnd ? 206 : 200 }, stats, routedContext, null);
      }, fallback);
    }
  };
}
