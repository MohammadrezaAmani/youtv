import Hls from "hls.js";
import type { WorkerProfile } from "@youtv/shared";
import { hlsRequestRoute, hlsResponseBase, normalizeRelayPlaylist } from "./hlsRelayRoutes";
import type { HlsFragmentPrefetcher, HlsPrefetchFragment } from "./hlsPrefetch";
import type { StartupTransfer } from "./hlsAutoRoute";

/** Keep the installed HLS.js network loader as the fallback. Cache delivery uses
 * its binary callback contract, including context, progress and terminal state.
 * This also works directly: routing and speculative downloading are independent. */
export function hlsRelayLoader(
  worker: WorkerProfile | undefined,
  initial: string,
  prefetcher?: HlsFragmentPrefetcher,
  startup?: Map<string, StartupTransfer>,
): typeof Hls.DefaultConfig.loader {
  const BaseLoader = Hls.DefaultConfig.loader;
  type LoadArgs = Parameters<InstanceType<typeof BaseLoader>["load"]>;
  return class RelayLoader extends BaseLoader {
    private generation = 0;
    private terminal = false;
    private suppressAbort = false;
    private destroyed = false;
    private releaseForeground: (() => void) | null = null;
    private abortPending: (() => void) | null = null;
    private cancelStartup: (() => void) | null = null;
    private watchdog: ReturnType<typeof setInterval> | undefined;

    private finish(): void {
      if (this.watchdog !== undefined) clearInterval(this.watchdog);
      this.watchdog = undefined;
      this.releaseForeground?.();
      this.releaseForeground = null;
      this.abortPending = null;
      this.cancelStartup = null;
    }

    abort(): void {
      if (this.destroyed || this.terminal) return;
      this.terminal = true;
      this.generation++;
      const abortPending = this.abortPending;
      this.finish();
      if (abortPending) abortPending();
      else super.abort();
    }

    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = this.terminal = true;
      this.generation++;
      this.cancelStartup?.();
      this.finish();
      super.destroy();
    }

    load(context: LoadArgs[0], config: LoadArgs[1], callbacks: LoadArgs[2]): void {
      const playlist = ["manifest", "level", "audioTrack", "subtitleTrack"].includes(String(context.type));
      const url = worker ? hlsRequestRoute(context.url, worker, initial, playlist) : context.url;
      const routedContext = { ...context, url };
      const generation = ++this.generation;
      const frag = (context as typeof context & { frag?: HlsPrefetchFragment }).frag;
      const fragmentContext = context as typeof context & { part?: unknown; resetIV?: boolean };
      // Keys also have a frag! Only the MEDIA_FRAGMENT context is cacheable.
      // Custom headers and adjusted encrypted ranges require the normal loader.
      const media = String(context.type) === "media-fragment" && context.responseType === "arraybuffer" &&
        !fragmentContext.part && !fragmentContext.resetIV && !Object.keys(context.headers ?? {}).length &&
        typeof frag?.sn === "number" && (frag.type === "main" || frag.type === "audio");
      if (prefetcher) this.releaseForeground = media
        ? prefetcher.reserveForeground(url, context.rangeStart, context.rangeEnd, frag)
        : prefetcher.reserveEssential();
      const alive = () => !this.destroyed && !this.terminal && this.generation === generation;
      const terminal = (action: () => void) => {
        if (!alive()) return;
        this.terminal = true;
        this.finish();
        action(); // HLS.js may synchronously destroy this loader here.
      };
      const wrapped: LoadArgs[2] = {
        ...callbacks,
        onSuccess: (response, stats, loadedContext, networkDetails) => terminal(() => {
          if (media && frag?.duration) prefetcher?.observe(stats.loading.end - stats.loading.start, stats.loading.first - stats.loading.start, frag.duration, stats.loaded);
          const base = worker && typeof response.data === "string"
            ? hlsResponseBase(response.data, response.url || url, worker, this.getResponseHeader?.("X-YouTV-Source-URL") ?? null)
            : undefined;
          callbacks.onSuccess(base && typeof response.data === "string"
            ? { ...response, url: base, data: normalizeRelayPlaylist(response.data, base) }
            : response, stats, loadedContext, networkDetails);
        }),
        onProgress: (stats, loadedContext, data, networkDetails) => {
          if (alive()) callbacks.onProgress?.(stats, loadedContext, data, networkDetails);
        },
        onError: (...args) => terminal(() => callbacks.onError(...args)),
        onTimeout: (...args) => terminal(() => callbacks.onTimeout(...args)),
        // abort() has already marked the request terminal.
        onAbort: (...args) => { if (!this.suppressAbort) { this.finish(); callbacks.onAbort?.(...args); } },
      };
      const normalLoad = () => {
        if (!alive()) return;
        this.abortPending = null;
        this.stats.loading.start = this.stats.loading.first = this.stats.loading.end = 0;
        this.stats.loaded = this.stats.total = 0;
        super.load(routedContext, config, wrapped);
        if (!alive()) return;
        // An overall 300s deadline tolerates slow delivery. Detect *inactivity*
        // separately, so a stuck HTTP/2 stream cannot hold an empty player for 5m.
        let lastBytes = 0, lastProgress = performance.now();
        this.watchdog = setInterval(() => {
          if (!alive()) return;
          const now = performance.now();
          if (this.stats.loaded !== lastBytes) { lastBytes = this.stats.loaded; lastProgress = now; }
          const threatened = !media || !prefetcher || prefetcher.getStats().bufferAhead < 12;
          if (threatened && now - lastProgress >= 30_000) {
            const stats = this.stats;
            // Silence the base abort callback: this terminal result is a timeout.
            this.terminal = true;
            this.finish();
            this.suppressAbort = true;
            super.abort();
            callbacks.onTimeout(stats, routedContext, null);
          }
        }, 1000);
      };
      const onBytes = (loaded: number, total: number) => {
        if (!alive()) return;
        this.stats.loaded = loaded;
        this.stats.total = Math.max(0, total);
        const timing = prefetcher?.getTransferTiming(url, context.rangeStart, context.rangeEnd, frag);
        if (timing) {
          this.stats.loading.start = timing.start;
          this.stats.loading.first = timing.first;
        }
      };
      this.context = routedContext;
      this.stats.loading.start = performance.now();
      // Exact session URL only; ranged/custom/encrypted-adjusted loads retain
      // the installed loader contract. A decision timeout can hand us a live
      // request, so keep its progress and bytes instead of downloading again.
      const warm = !context.rangeStart && !context.rangeEnd && !fragmentContext.resetIV && !fragmentContext.part &&
        !Object.keys(context.headers ?? {}).length ? startup?.get(url) : undefined;
      if (warm) {
        startup?.delete(url);
        this.cancelStartup = warm.abort;
        this.abortPending = () => { warm.abort(); this.stats.aborted = true; callbacks.onAbort?.(this.stats, routedContext, null); };
        const progress = () => {
          this.stats.loading.start = warm.start;
          this.stats.loading.first = warm.first;
          this.stats.loaded = warm.loaded;
          this.stats.total = warm.total;
        };
        progress();
        this.watchdog = setInterval(() => {
          if (!alive()) return;
          progress();
          if ((!media || !prefetcher || prefetcher.getStats().bufferAhead < 12) && performance.now() - warm.lastProgress >= 30_000) {
            warm.abort();
            terminal(() => callbacks.onTimeout(this.stats, routedContext, null));
          }
        }, 1000);
        void warm.completion.then(async payload => {
          if (!alive()) return;
          if ((context.responseType === "arraybuffer") !== (typeof payload.data !== "string")) throw new Error("Incompatible startup response");
          const data = typeof payload.data === "string" ? payload.data : await payload.data.arrayBuffer();
          if (!alive()) return;
          const end = performance.now(), stats = this.stats;
          stats.loading.start = Math.max(.001, end - Math.max(1, payload.elapsedMs));
          stats.loading.first = Math.min(end, stats.loading.start + payload.firstByteMs);
          stats.loading.end = end;
          stats.loaded = stats.total = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
          stats.bwEstimate = stats.loaded * 8000 / Math.max(1, payload.elapsedMs - payload.firstByteMs);
          if (typeof data !== "string") wrapped.onProgress?.(stats, routedContext, data, null);
          wrapped.onSuccess({ url: payload.url, data, code: 200 }, stats, routedContext, null);
        }).catch(() => {
          if (!alive()) return;
          this.finish();
          if (prefetcher) this.releaseForeground = media
            ? prefetcher.reserveForeground(url, context.rangeStart, context.rangeEnd, frag)
            : prefetcher.reserveEssential();
          normalLoad();
        });
        return;
      }
      const claimed = media && prefetcher && frag
        ? prefetcher.loadRequired(url, context.rangeStart, context.rangeEnd, frag, alive, onBytes)
        : null;
      if (!claimed) { normalLoad(); return; }
      this.abortPending = () => {
        this.stats.aborted = true;
        callbacks.onAbort?.(this.stats, routedContext, null);
      };
      void claimed.then(async payload => {
        if (!alive()) return;
        if (!payload) { normalLoad(); return; }
        let data: ArrayBuffer;
        try { data = await payload.blob.arrayBuffer(); }
        catch { normalLoad(); return; }
        if (!alive()) return;
        const stats = this.stats;
        const end = performance.now();
        // Replay the actual network cost for ABR, never local memory speed.
        stats.loading.start = Math.max(0.001, end - Math.max(1, payload.elapsedMs));
        stats.loading.first = Math.min(end, stats.loading.start + Math.min(payload.firstByteMs, payload.elapsedMs));
        stats.loading.end = end;
        stats.loaded = stats.total = data.byteLength;
        stats.bwEstimate = data.byteLength * 8000 / Math.max(1, payload.elapsedMs - payload.firstByteMs);
        wrapped.onProgress?.(stats, routedContext, data, null);
        if (!alive()) return;
        terminal(() => callbacks.onSuccess({ url, data, code: context.rangeEnd ? 206 : 200 }, stats, routedContext, null));
      }, normalLoad);
    }
  };
}
