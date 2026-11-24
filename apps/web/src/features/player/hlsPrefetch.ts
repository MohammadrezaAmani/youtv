export type HlsPrefetchFragment = {
  url: string;
  start: number;
  duration: number;
  sn?: number | string;
  gap?: boolean;
  byteRangeStartOffset?: number;
  byteRangeEndOffset?: number;
};

type EntryState = "queued" | "loading" | "ready";
type PrefetchEntry = {
  key: string;
  url: string;
  start: number;
  end: number;
  rangeStart?: number;
  rangeEnd?: number;
  sequence: number;
  scope: string;
  state: EntryState;
  controller: AbortController;
  blob?: Blob;
  elapsedMs?: number;
  firstByteMs?: number;
  completion?: Promise<void>;
  claimed?: boolean;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HlsPrefetchOptions = {
  targetAheadSeconds?: number;
  maxConcurrent?: number;
  maxSegments?: number;
  maxSegmentBytes?: number;
  maxCacheBytes?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  adaptive?: boolean;
  waitForStartup?: boolean;
  fetcher?: Fetcher;
};

const DEFAULTS = {
  targetAheadSeconds: 90,
  maxConcurrent: 16,
  maxSegments: 96,
  maxSegmentBytes: 8 * 1024 * 1024,
  maxCacheBytes: 128 * 1024 * 1024,
} as const;

export const HLS_LOAD_TIMEOUT_MS = 300_000;
export type PrefetchPayload = { blob: Blob; elapsedMs: number; firstByteMs: number };

/** hls.js byte-range end offsets are exclusive; HTTP Range ends are inclusive. */
export function hlsPrefetchKey(
  url: string,
  rangeStart?: number,
  rangeEnd?: number,
): string {
  const range =
    Number.isFinite(rangeStart) && Number.isFinite(rangeEnd) && rangeStart! >= 0 && rangeEnd! > rangeStart!
      ? `${rangeStart}:${rangeEnd}`
      : "";
  return `${url}\n${range}`;
}

async function readBoundedBlob(
  response: Response,
  maximumBytes: number,
): Promise<Blob | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  if (/^(?:text\/html|application\/(?:json|problem\+json))/i.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  if (!response.body) {
    const blob = await response.blob();
    return blob.size > 0 && blob.size <= maximumBytes ? blob : null;
  }

  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } finally {
    reader.releaseLock();
  }
  return total > 0
    ? new Blob(chunks, { type: contentType })
    : null;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Downloads upcoming HLS media fragments in parallel, nearest-first. The
 * player loader can claim a running download instead of restarting it.
 * Startup is gated until playable media has been appended.
 */
export class HlsFragmentPrefetcher {
  private readonly targetAheadSeconds: number;
  private readonly maxConcurrent: number;
  private readonly maxSegments: number;
  private readonly maxSegmentBytes: number;
  private readonly maxCacheBytes: number;
  private readonly retryDelayMs: number;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly adaptive: boolean;
  private started: boolean;
  private limit: number;
  private bufferAhead = 0;
  private elapsedEwma = 0;
  private latencyEwma = 0;
  private successCount = 0;
  private lastIncrease = 0;
  private readonly foreground = new Set<string>();
  private readonly cooldown = new Map<string, number>();
  private readonly routeUrl: (url: string) => string;
  private readonly entries = new Map<string, PrefetchEntry>();
  private readonly buffered = new Map<string, number>();
  private queue: PrefetchEntry[] = [];
  private active = 0;
  private cachedBytes = 0;
  private sequence = 0;
  private disposed = false;

  constructor(
    routeUrl: (url: string) => string,
    options: HlsPrefetchOptions = {},
  ) {
    this.targetAheadSeconds = Math.max(15, options.targetAheadSeconds ?? DEFAULTS.targetAheadSeconds);
    this.maxConcurrent = Math.max(1, Math.min(16, options.maxConcurrent ?? DEFAULTS.maxConcurrent));
    this.maxSegments = Math.max(1, Math.min(160, options.maxSegments ?? DEFAULTS.maxSegments));
    this.maxSegmentBytes = Math.max(256 * 1024, options.maxSegmentBytes ?? DEFAULTS.maxSegmentBytes);
    this.maxCacheBytes = Math.max(this.maxSegmentBytes, options.maxCacheBytes ?? DEFAULTS.maxCacheBytes);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 450);
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? HLS_LOAD_TIMEOUT_MS);
    this.adaptive = options.adaptive ?? true;
    this.started = !(options.waitForStartup ?? true);
    this.limit = this.adaptive ? 1 : this.maxConcurrent;
    this.routeUrl = routeUrl;
  }

  schedule(fragments: readonly HlsPrefetchFragment[], currentTime: number, scope = "main"): void {
    if (this.disposed || !this.started || !Number.isFinite(currentTime)) return;
    this.prune(currentTime);
    const horizon = currentTime + this.targetAheadSeconds;
    const candidates = fragments
      .filter((fragment) =>
        fragment &&
        typeof fragment.url === "string" &&
        /^https?:\/\//i.test(fragment.url) &&
        Number.isFinite(fragment.start) &&
        Number.isFinite(fragment.duration) &&
        fragment.duration > 0 &&
        !fragment.gap &&
        fragment.sn !== "initSegment" &&
        fragment.start > currentTime + 0.15 &&
        fragment.start < horizon,
      )
      .sort((a, b) => a.start - b.start);
    const prepared: Array<{ fragment: HlsPrefetchFragment; url: string; key: string; rangeStart?: number; rangeEnd?: number }> = [];
    for (const fragment of candidates) {
      let url: string;
      try {
        url = this.routeUrl(fragment.url);
      } catch {
        continue;
      }
      const rawStart = fragment.byteRangeStartOffset;
      const rawEnd = fragment.byteRangeEndOffset;
      const hasRange = Number.isFinite(rawStart) || Number.isFinite(rawEnd);
      const rangeStart = hasRange ? rawStart : undefined;
      const rangeEnd = hasRange ? rawEnd : undefined;
      if (
        hasRange &&
        (!Number.isFinite(rangeStart) ||
          !Number.isFinite(rangeEnd) ||
          (rangeStart as number) < 0 ||
          (rangeEnd as number) <= (rangeStart as number))
      ) continue;
      prepared.push({ fragment, url, key: hlsPrefetchKey(url, rangeStart, rangeEnd), rangeStart, rangeEnd });
    }

    // Cancel speculative work from a superseded playlist/quality level. This
    // prevents old-rendition downloads from competing with the selected one.
    const desired = new Set(prepared.map((item) => item.key));
    for (const entry of this.entries.values()) {
      // A normal sliding live playlist must not discard a claimed request.
      if (entry.scope === scope && !desired.has(entry.key) && !entry.claimed) this.cancelEntry(entry);
    }

    let scheduled = 0;
    for (const item of prepared) {
      if (this.entries.size >= this.maxSegments) break;
      if (this.buffered.has(item.key) || this.entries.has(item.key) || this.foreground.has(item.key) ||
          (this.cooldown.get(item.key) ?? 0) > Date.now()) continue;
      const entry: PrefetchEntry = {
        key: item.key,
        url: item.url,
        start: item.fragment.start,
        end: item.fragment.start + item.fragment.duration,
        rangeStart: item.rangeStart,
        rangeEnd: item.rangeEnd,
        sequence: this.sequence++,
        scope,
        state: "queued",
        controller: new AbortController(),
      };
      this.entries.set(item.key, entry);
      this.queue.push(entry);
      scheduled++;
      if (scheduled >= this.maxSegments) break;
    }

    // Newer playlist updates may introduce a closer segment. Always start
    // the nearest available work first; already-running requests are not preempted.
    this.queue.sort((a, b) => a.start - b.start || a.sequence - b.sequence);
    this.pump();
  }

  /** Only start speculative I/O after first playable main fragment. */
  start(): void { this.started = true; this.pump(); }

  updatePlayback(bufferAhead: number): void {
    this.bufferAhead = Math.max(0, bufferAhead);
    this.pump();
  }

  /** AIMD with EWMA of request duration and latency fraction. High RTT can
   * benefit from concurrency; transfer-limited links should not be flooded. */
  observe(elapsedMs: number, firstByteMs: number, duration: number): void {
    if (!this.adaptive || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || duration <= 0) return;
    const ratio = elapsedMs / (duration * 1000);
    const latency = Math.min(1, Math.max(0, firstByteMs / elapsedMs));
    this.elapsedEwma = this.elapsedEwma ? .75 * this.elapsedEwma + .25 * ratio : ratio;
    this.latencyEwma = this.successCount ? .75 * this.latencyEwma + .25 * latency : latency;
    this.successCount++;
    const desired = Math.min(this.maxConcurrent, Math.max(1, Math.ceil(this.elapsedEwma * 1.5)));
    const now = Date.now();
    // Do not treat slow payload transfer as proof more connections will help.
    const ceiling = this.latencyEwma >= .35 ? desired : Math.min(3, desired);
    if (this.bufferAhead >= this.targetAheadSeconds * .75 || this.limit > ceiling + 1) {
      this.limit = Math.max(1, this.limit - 1);
    } else if (this.limit < ceiling && (this.successCount === 1 ||
        (this.successCount % 2 === 0 && now - this.lastIncrease >= 1000))) {
      this.limit++;
      this.lastIncrease = now;
    }
    this.pump();
  }

  private congested(): void {
    if (this.adaptive) this.limit = Math.max(1, Math.floor(this.limit / 2));
  }

  /** Reserve the foreground key so playlist refreshes cannot download it twice.
   * A queued item is promoted to the native loader; running work is joined. */
  reserveForeground(url: string, rangeStart?: number, rangeEnd?: number): () => void {
    const key = hlsPrefetchKey(url, rangeStart, rangeEnd);
    this.foreground.add(key);
    const entry = this.entries.get(key);
    if (entry?.state === "queued") this.cancelEntry(entry);
    else if (entry) entry.claimed = true;
    return () => { this.foreground.delete(key); if (entry) entry.claimed = false; this.pump(); };
  }

  claim(url: string, rangeStart?: number, rangeEnd?: number, wanted = () => true): Promise<PrefetchPayload | null> | null {
    const key = hlsPrefetchKey(url, rangeStart, rangeEnd);
    const entry = this.entries.get(key);
    if (!entry || entry.state === "queued") return null;
    const consume = (): PrefetchPayload | null => {
      if (!wanted() || this.entries.get(key) !== entry || entry.state !== "ready" || !entry.blob) return null;
      const result = { blob: entry.blob, elapsedMs: entry.elapsedMs ?? 1000, firstByteMs: entry.firstByteMs ?? 0 };
      this.take(url, rangeStart, rangeEnd);
      return result;
    };
    return entry.state === "ready" ? Promise.resolve(consume()) :
      entry.completion?.then(consume) ?? null;
  }

  /** Called when hls.js has appended a fragment to MediaSource. */
  markBuffered(fragment: HlsPrefetchFragment): void {
    if (this.disposed || !fragment?.url) return;
    try {
      const url = this.routeUrl(fragment.url);
      const key = hlsPrefetchKey(
        url,
        fragment.byteRangeStartOffset,
        fragment.byteRangeEndOffset,
      );
      this.buffered.set(key, fragment.start + fragment.duration);
      const entry = this.entries.get(key);
      if (entry) this.cancelEntry(entry);
    } catch {
      // A malformed playlist entry must not affect playback.
    }
  }

  /** Returns only completed prefetches. Pending work is cancelled so the
   * foreground hls.js request is never forced to wait behind speculative I/O. */
  take(url: string, rangeStart?: number, rangeEnd?: number): Blob | null {
    const key = hlsPrefetchKey(url, rangeStart, rangeEnd);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.state !== "ready" || !entry.blob) {
      this.cancelEntry(entry);
      return null;
    }
    this.entries.delete(key);
    this.cachedBytes = Math.max(0, this.cachedBytes - entry.blob.size);
    return entry.blob;
  }

  getStats(): { queued: number; active: number; cached: number; cachedBytes: number; concurrency: number } {
    let cached = 0;
    for (const entry of this.entries.values()) if (entry.state === "ready") cached++;
    return { queued: this.queue.length, active: this.active, cached, cachedBytes: this.cachedBytes, concurrency: this.limit };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
    this.buffered.clear();
    this.foreground.clear();
    this.cooldown.clear();
    this.queue = [];
    this.cachedBytes = 0;
  }

  private prune(currentTime: number): void {
    for (const [key, until] of this.cooldown) if (until <= Date.now()) this.cooldown.delete(key);
    for (const [key, end] of this.buffered) {
      if (end < currentTime - 30) this.buffered.delete(key);
    }
    for (const entry of this.entries.values()) {
      if (entry.end < currentTime - 3 && !entry.claimed) this.cancelEntry(entry);
    }
  }

  private cancelEntry(entry: PrefetchEntry): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    entry.controller.abort();
    if (entry.blob) this.cachedBytes = Math.max(0, this.cachedBytes - entry.blob.size);
    this.queue = this.queue.filter((queued) => queued !== entry);
  }

  private makeRoom(requiredBytes: number, incoming: PrefetchEntry): boolean {
    if (requiredBytes > this.maxCacheBytes) return false;
    if (this.cachedBytes + requiredBytes <= this.maxCacheBytes) return true;
    const ready = [...this.entries.values()]
      .filter((entry) => entry.state === "ready" && entry.blob && !entry.claimed && entry.start > incoming.start)
      .sort((a, b) => b.start - a.start);
    for (const entry of ready) {
      this.cancelEntry(entry);
      if (this.cachedBytes + requiredBytes <= this.maxCacheBytes) return true;
    }
    return this.cachedBytes + requiredBytes <= this.maxCacheBytes;
  }

  private pump(): void {
    if (this.disposed || !this.started) return;
    // Leave a slot for foreground media, plus room for manifest/key requests.
    const budget = this.adaptive ? Math.max(0, Math.min(this.limit, this.maxConcurrent - this.foreground.size)) : this.limit;
    while (this.active < budget && this.queue.length &&
        this.cachedBytes + (this.active + 1) * this.maxSegmentBytes <= this.maxCacheBytes) {
      const entry = this.queue.shift()!;
      if (this.entries.get(entry.key) !== entry || entry.state !== "queued") continue;
      entry.state = "loading";
      this.active++;
      entry.completion = this.run(entry).finally(() => {
        this.active = Math.max(0, this.active - 1);
        this.pump();
      });
    }
  }

  private async run(entry: PrefetchEntry): Promise<void> {
    try {
      // A single overall five-minute deadline includes retries and body reads.
      const deadline = setTimeout(() => { this.congested(); entry.controller.abort(); }, this.timeoutMs);
      const startedAt = performance.now();
      try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (entry.controller.signal.aborted || this.disposed) return;
        try {
          const headers = new Headers();
          if (entry.rangeStart !== undefined && entry.rangeEnd !== undefined) {
            headers.set("Range", `bytes=${entry.rangeStart}-${entry.rangeEnd - 1}`);
          }
          const init = {
            method: "GET",
            headers,
            credentials: "omit",
            cache: "no-store",
            redirect: "follow",
            signal: entry.controller.signal,
            priority: entry.claimed ? "high" : "low",
          } as RequestInit & { priority: "low" | "high" };
          const response = await this.fetcher(entry.url, init);
          const firstByteMs = performance.now() - startedAt;
          const ranged = entry.rangeStart !== undefined;
          if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            const retryable = [408, 500, 502, 503, 504].includes(response.status);
            if (retryable && attempt < 2 && !entry.controller.signal.aborted) {
              this.congested();
              await abortableDelay(this.retryDelayMs * 2 ** attempt, entry.controller.signal);
              continue;
            }
            return;
          }
          if (
            (ranged && response.status !== 206) ||
            (!ranged && response.status !== 200)
          ) {
            await response.body?.cancel().catch(() => undefined);
            return;
          }
          if (ranged) {
            const contentRange = response.headers.get("content-range") || "";
            const match = /^bytes\s+(\d+)-(\d+)\//i.exec(contentRange);
            if (
              !match ||
              Number(match[1]) !== entry.rangeStart ||
              Number(match[2]) !== (entry.rangeEnd as number) - 1
            ) {
              await response.body?.cancel().catch(() => undefined);
              return;
            }
          }
          const blob = await readBoundedBlob(response, this.maxSegmentBytes);
          if (!blob || entry.controller.signal.aborted || this.disposed || (ranged && blob.size !== entry.rangeEnd! - entry.rangeStart!)) return;
          if (this.entries.get(entry.key) !== entry || !this.makeRoom(blob.size, entry)) return;
          entry.elapsedMs = performance.now() - startedAt;
          entry.firstByteMs = firstByteMs;
          entry.blob = blob;
          entry.state = "ready";
          this.cachedBytes += blob.size;
          this.observe(entry.elapsedMs, firstByteMs, entry.end - entry.start);
          return;
        } catch {
          if (entry.controller.signal.aborted || this.disposed || attempt >= 2) return;
          this.congested();
          await abortableDelay(this.retryDelayMs * 2 ** attempt, entry.controller.signal);
        }
      }
      } finally { clearTimeout(deadline); }
    } finally {
      if (this.entries.get(entry.key) === entry && entry.state !== "ready") {
        this.entries.delete(entry.key);
        this.cooldown.set(entry.key, Date.now() + 15000);
        this.queue = this.queue.filter((queued) => queued !== entry);
      }
    }
  }
}
