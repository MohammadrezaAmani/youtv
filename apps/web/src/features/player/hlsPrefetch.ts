export type HlsPrefetchFragment = {
  url: string;
  start: number;
  duration: number;
  sn?: number | string;
  gap?: boolean;
  type?: string;
  level?: number;
  cc?: number;
  byteRangeStartOffset?: number;
  byteRangeEndOffset?: number;
};

type EntryState = "queued" | "loading" | "retry" | "ready";
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
  resolveCompletion?: () => void;
  deadline?: ReturnType<typeof setTimeout>;
  retryTimer?: ReturnType<typeof setTimeout>;
  attempts?: number;
  claimed?: boolean;
  loaded?: number;
  total?: number;
  observers?: Set<(loaded: number, total: number) => void>;
  claimTimer?: ReturnType<typeof setInterval>;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type HlsPrefetchOptions = {
  targetAheadSeconds?: number;
  maxConcurrent?: number;
  initialConcurrent?: number;
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
  maxConcurrent: 8,
  maxSegments: 96,
  maxSegmentBytes: 8 * 1024 * 1024,
  maxCacheBytes: 192 * 1024 * 1024,
  initialConcurrent: 2,
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

/** Scope token refreshes to a single HLS sequence, discontinuity and rendition.
 * The actual signed URL is never modified. All other query parameters remain
 * part of the key. Without complete fragment metadata use exact URL identity. */
export function hlsFragmentCacheKey(
  url: string, rangeStart?: number, rangeEnd?: number,
  frag?: Pick<HlsPrefetchFragment, "type" | "level" | "cc" | "sn">,
): string {
  if (!frag || !["main", "audio"].includes(frag.type ?? "") ||
      !Number.isInteger(frag.level) || !Number.isInteger(frag.cc) ||
      typeof frag.sn !== "number" || !Number.isSafeInteger(frag.sn)) {
    return hlsPrefetchKey(url, rangeStart, rangeEnd);
  }
  try {
    const outer = new URL(url);
    const target = outer.pathname.endsWith("/proxy") ? outer.searchParams.get("url") : null;
    const resource = target ? new URL(target) : outer;
    // A token is an authorization hint for this exact HLS sequence. Do not
    // merge duplicate token parameters or alter other signed query fields.
    if (resource.searchParams.getAll("token").length <= 1) resource.searchParams.delete("token");
    if (target) outer.searchParams.set("url", resource.href);
    return `${frag.type}:${frag.level}:${frag.cc}:${frag.sn}\n${hlsPrefetchKey(outer.href, rangeStart, rangeEnd)}`;
  } catch { return hlsPrefetchKey(url, rangeStart, rangeEnd); }
}

async function readBoundedBlob(
  response: Response,
  maximumBytes: number,
  onBytes: (loaded: number) => void,
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
    onBytes(blob.size);
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
      onBytes(total);
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

/**
 * Downloads upcoming HLS media fragments in parallel, nearest-first. The
 * player loader can claim a running download instead of restarting it.
 * Startup is gated until playable media has been appended.
 */
export class HlsFragmentPrefetcher {
  private readonly targetAheadSeconds: number;
  private readonly maxConcurrent: number;
  private readonly initialConcurrent: number;
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
  private position = 0;
  private estimatedRate = 0;
  private estimatedLatencyShare = 0;
  private samples = 0;
  private successesSinceIncrease = 0;
  private readonly renditions = new Map<string, string>();
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
    this.maxConcurrent = Math.max(1, Math.min(8, options.maxConcurrent ?? DEFAULTS.maxConcurrent));
    this.initialConcurrent = Math.max(1, Math.min(this.maxConcurrent, options.initialConcurrent ?? DEFAULTS.initialConcurrent));
    this.maxSegments = Math.max(1, Math.min(160, options.maxSegments ?? DEFAULTS.maxSegments));
    this.maxSegmentBytes = Math.max(256 * 1024, options.maxSegmentBytes ?? DEFAULTS.maxSegmentBytes);
    this.maxCacheBytes = Math.max(this.maxSegmentBytes, options.maxCacheBytes ?? DEFAULTS.maxCacheBytes);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 450);
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? HLS_LOAD_TIMEOUT_MS);
    this.adaptive = options.adaptive ?? true;
    this.started = !(options.waitForStartup ?? true);
    this.limit = this.adaptive ? (this.started ? this.initialConcurrent : 1) : this.maxConcurrent;
    this.routeUrl = routeUrl;
  }

  schedule(fragments: readonly HlsPrefetchFragment[], currentTime: number, scope = "main", rendition = scope, live = false): void {
    if (this.disposed || !this.started || !Number.isFinite(currentTime)) return;
    this.position = currentTime;
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
      // hls.js may represent an ordinary (unranged) fragment as [0, 0].
      // Keep this consistent with hlsPrefetchKey and the foreground loader.
      const emptyRange = rawStart === 0 && rawEnd === 0;
      const hasRange = !emptyRange && (rawStart !== undefined || rawEnd !== undefined);
      const rangeStart = hasRange ? rawStart : undefined;
      const rangeEnd = hasRange ? rawEnd : undefined;
      if (
        hasRange &&
        (!Number.isFinite(rangeStart) ||
          !Number.isFinite(rangeEnd) ||
          (rangeStart as number) < 0 ||
          (rangeEnd as number) <= (rangeStart as number))
      ) continue;
      prepared.push({ fragment, url, key: hlsFragmentCacheKey(url, rangeStart, rangeEnd, fragment), rangeStart, rangeEnd });
    }

    // A live playlist is a sliding window, not a replacement queue. Preserve
    // outstanding segments from the same rendition until played or expired.
    const previousRendition = this.renditions.get(scope);
    const switched = previousRendition !== undefined && previousRendition !== rendition;
    this.renditions.set(scope, rendition);
    const desired = new Set(prepared.map((item) => item.key));
    for (const entry of this.entries.values()) {
      // A normal sliding live playlist must not discard a claimed request.
      if (entry.scope === scope && !entry.claimed &&
          (switched || (!live && !desired.has(entry.key)) || entry.start >= horizon)) this.cancelEntry(entry);
    }

    let scheduled = 0;
    for (const item of prepared) {
      const existing = this.entries.get(item.key);
      if (existing?.state === "queued" || existing?.state === "retry") {
        existing.url = item.url; // use the newest signed URL when still queued
        existing.start = item.fragment.start;
        existing.end = item.fragment.start + item.fragment.duration;
      }
      if (this.entries.size >= this.maxSegments) continue;
      if (this.buffered.has(item.key) || existing || this.foreground.has(item.key) ||
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
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    if (this.adaptive) this.limit = this.initialConcurrent;
    this.pump();
  }

  updatePlayback(bufferAhead: number, position?: number): void {
    this.bufferAhead = Math.max(0, bufferAhead);
    if (position !== undefined && Number.isFinite(position)) this.position = position;
    this.pump();
  }

  /** Estimate delivered media-seconds/s per transfer and the latency share.
   * Increase slowly when there is a real backlog; avoid filling the connection
   * with speculative downloads when the transfer itself is the bottleneck. */
  observe(elapsedMs: number, firstByteMs: number, duration: number): void {
    if (!this.adaptive || !this.started || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || duration <= 0) return;
    const rate = duration * 1000 / elapsedMs;
    const share = Math.max(0, Math.min(1, firstByteMs / elapsedMs));
    const previous = this.estimatedRate;
    this.estimatedRate = this.samples ? .75 * previous + .25 * rate : rate;
    this.estimatedLatencyShare = this.samples ? .75 * this.estimatedLatencyShare + .25 * share : share;
    this.samples++;
    const min = Math.min(2, this.maxConcurrent);
    const latencyLimited = this.estimatedLatencyShare >= .35;
    // Transfer-dominated degradation is a signal to back off, not add requests.
    if (this.samples > 3 && !latencyLimited && rate < previous * .45 && this.bufferAhead < 12) {
      this.limit = Math.max(min, this.limit - 1);
      this.successesSinceIncrease = 0;
    } else if (this.queue.length && this.bufferAhead < this.targetAheadSeconds * .9) {
      const desired = latencyLimited
        ? Math.min(this.maxConcurrent, Math.max(min, Math.ceil(1.5 / this.estimatedRate)))
        : Math.min(this.maxConcurrent, this.estimatedRate >= 1.5 ? 4 : 2);
      if (this.limit < desired && ++this.successesSinceIncrease >= 2) {
        this.limit++;
        this.successesSinceIncrease = 0;
      }
    }
    this.pump();
  }

  private congested(): void {
    if (this.adaptive) {
      this.limit = Math.max(Math.min(2, this.maxConcurrent), Math.floor(this.limit / 2));
      this.successesSinceIncrease = 0;
    }
  }

  /** Prioritize the next missing media, not merely the next wall-clock URL.
   * Browser fetch priority is a hint; the hard protection is admission control. */
  private priority(entry: PrefetchEntry): "high" | "auto" | "low" {
    const distance = entry.start - (this.position + this.bufferAhead);
    const duration = entry.end - entry.start;
    if (entry.claimed || distance <= duration + .25) return "high";
    return distance <= 3 * duration ? "auto" : "low";
  }

  /** Reserve the foreground key so playlist refreshes cannot download it twice.
   * A queued item is promoted to the native loader; running work is joined. */
  reserveForeground(url: string, rangeStart?: number, rangeEnd?: number, frag?: HlsPrefetchFragment): () => void {
    const key = hlsFragmentCacheKey(url, rangeStart, rangeEnd, frag);
    this.foreground.add(key);
    const entry = this.entries.get(key);
    if (entry?.state === "queued" || entry?.state === "retry") this.cancelEntry(entry);
    else if (entry) entry.claimed = true;
    // Do not wait behind far-away transfers when the foreground is starving.
    // Abort at most zero-byte speculative downloads, so received bytes are not lost.
    if (this.started && this.adaptive && this.bufferAhead < 8) {
      const far = [...this.entries.values()].filter(e => e.state === "loading" && !e.claimed && !e.loaded && this.priority(e) === "low")
        .sort((a, b) => b.start - a.start);
      if (this.active >= this.limit && far[0]) this.cancelEntry(far[0]);
    }
    return () => {
      this.foreground.delete(key);
      if (entry) {
        entry.claimed = false;
        entry.observers?.clear();
        if (entry.claimTimer !== undefined) clearInterval(entry.claimTimer);
        entry.claimTimer = undefined;
      }
      this.pump();
    };
  }

  claim(url: string, rangeStart?: number, rangeEnd?: number, wanted = () => true, frag?: HlsPrefetchFragment, onBytes?: (loaded: number, total: number) => void): Promise<PrefetchPayload | null> | null {
    const key = hlsFragmentCacheKey(url, rangeStart, rangeEnd, frag);
    const entry = this.entries.get(key);
    if (!entry || (entry.state === "queued" && !entry.completion)) return null;
    if (entry.state === "loading") {
      if (onBytes) {
        entry.observers ??= new Set();
        entry.observers.add((loaded, total) => { if (wanted()) onBytes(loaded, total); });
        onBytes(entry.loaded ?? 0, entry.total ?? 0);
      }
      // A speculative request must not hold playback for its full five-minute
      // deadline when it has stopped delivering bytes. Hand it back to the
      // native loader after 30 seconds without progress, only while starving.
      if (entry.claimTimer === undefined) {
        let lastProgress = Date.now();
        let loaded = entry.loaded ?? 0;
        entry.claimTimer = setInterval(() => {
          if (entry.loaded !== undefined && entry.loaded !== loaded) { loaded = entry.loaded; lastProgress = Date.now(); }
          if (this.bufferAhead < 8 && Date.now() - lastProgress >= 30_000) {
            this.congested();
            this.fail(entry);
          }
        }, 1000);
      }
    }
    const consume = (): PrefetchPayload | null => {
      if (!wanted() || this.entries.get(key) !== entry || entry.state !== "ready" || !entry.blob) return null;
      const result = { blob: entry.blob, elapsedMs: entry.elapsedMs ?? 1000, firstByteMs: entry.firstByteMs ?? 0 };
      // Retain completed bytes until FRAG_BUFFERED confirms append. A refresh
      // or a loader retry in the meantime must not start another transfer.
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
      const key = hlsFragmentCacheKey(
        url,
        fragment.byteRangeStartOffset,
        fragment.byteRangeEndOffset,
        fragment,
      );
      this.buffered.set(key, fragment.start + fragment.duration);
      const entry = this.entries.get(key);
      if (entry) this.cancelEntry(entry);
      this.pump();
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
    this.cancelEntry(entry);
    this.pump();
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
    for (const entry of this.entries.values()) this.cancelEntry(entry);
    this.entries.clear();
    this.buffered.clear();
    this.foreground.clear();
    this.cooldown.clear();
    this.renditions.clear();
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
    if (entry.deadline !== undefined) clearTimeout(entry.deadline);
    if (entry.retryTimer !== undefined) clearTimeout(entry.retryTimer);
    if (entry.claimTimer !== undefined) clearInterval(entry.claimTimer);
    entry.observers?.clear();
    // Loading entries settle after their permit has actually been released.
    if (entry.state !== "loading") entry.resolveCompletion?.();
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
    // A claimed prefetch already owns a permit: do not count it twice.
    // Independent native foreground downloads count against the total cap.
    const nativeForeground = [...this.foreground].filter(key => !this.entries.has(key)).length;
    const urgent = this.foreground.size > 0 && this.bufferAhead < 8;
    const effective = this.adaptive && urgent ? Math.min(this.limit, 2) : this.limit;
    const budget = this.adaptive ? Math.max(0, effective - nativeForeground) : effective;
    while (this.active < budget && this.queue.length &&
        this.cachedBytes + (this.active + 1) * this.maxSegmentBytes <= this.maxCacheBytes) {
      // During starvation
      // only the nearby lookahead can compete with the foreground.
      if (this.adaptive && urgent && this.priority(this.queue[0]!) === "low") break;
      const entry = this.queue.shift()!;
      if (this.entries.get(entry.key) !== entry || entry.state !== "queued") continue;
      entry.state = "loading";
      this.active++;
      if (!entry.completion) {
        entry.completion = new Promise<void>(resolve => { entry.resolveCompletion = resolve; });
        // One deadline spans attempts, including time spent waiting to retry.
        entry.deadline = setTimeout(() => {
          this.congested();
          this.fail(entry);
          this.pump();
        }, this.timeoutMs);
      }
      void this.runAttempt(entry).finally(() => {
        this.active = Math.max(0, this.active - 1);
        if (entry.state === "ready" || this.entries.get(entry.key) !== entry) {
          entry.resolveCompletion?.();
        }
        this.pump(); // release -> immediately replace, never wait for a batch
      });
    }
  }

  private fail(entry: PrefetchEntry): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.cancelEntry(entry);
    this.cooldown.set(entry.key, Date.now() + 15_000);
  }

  private retry(entry: PrefetchEntry): void {
    if (this.entries.get(entry.key) !== entry || entry.controller.signal.aborted || this.disposed) return;
    this.congested();
    if (entry.claimed) { this.fail(entry); return; }
    if ((entry.attempts ?? 0) >= 3) { this.fail(entry); return; }
    entry.state = "retry";
    // Backoff belongs to the failed item, not to the semaphore slot.
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = undefined;
      if (this.disposed || this.entries.get(entry.key) !== entry || entry.controller.signal.aborted) return;
      entry.state = "queued";
      this.queue.push(entry);
      this.queue.sort((a, b) => a.start - b.start || a.sequence - b.sequence);
      this.pump();
    }, this.retryDelayMs * 2 ** ((entry.attempts ?? 1) - 1));
  }

  private async runAttempt(entry: PrefetchEntry): Promise<void> {
    entry.attempts = (entry.attempts ?? 0) + 1;
    entry.loaded = 0;
    entry.total = 0;
    const startedAt = performance.now();
    try {
      if (entry.controller.signal.aborted || this.disposed) return;
      const headers: Record<string, string> = {};
      if (entry.rangeStart !== undefined && entry.rangeEnd !== undefined) {
        headers.Range = `bytes=${entry.rangeStart}-${entry.rangeEnd - 1}`;
      }
      const init = {
        method: "GET", headers, credentials: "omit", cache: "no-store",
        redirect: "follow", signal: entry.controller.signal,
        priority: this.priority(entry),
      } as RequestInit & { priority: "auto" | "high" | "low" };
      const response = await this.fetcher(entry.url, init);
      const firstByteMs = performance.now() - startedAt;
      const ranged = entry.rangeStart !== undefined;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if ([408, 500, 502, 503, 504].includes(response.status)) this.retry(entry);
        else { if (response.status === 429) this.congested(); this.fail(entry); }
        return;
      }
      if ((ranged && response.status !== 206) || (!ranged && response.status !== 200)) {
        await response.body?.cancel().catch(() => undefined);
        this.fail(entry); return;
      }
      if (ranged) {
        const match = /^bytes\s+(\d+)-(\d+)\//i.exec(response.headers.get("content-range") || "");
        if (!match || Number(match[1]) !== entry.rangeStart || Number(match[2]) !== entry.rangeEnd! - 1) {
          await response.body?.cancel().catch(() => undefined);
          this.fail(entry); return;
        }
      }
      entry.total = Number(response.headers.get("content-length")) || 0;
      const blob = await readBoundedBlob(response, this.maxSegmentBytes, loaded => {
        entry.loaded = loaded;
        for (const observer of entry.observers ?? []) observer(loaded, entry.total ?? 0);
      });
      if (this.entries.get(entry.key) !== entry || entry.controller.signal.aborted || this.disposed) return;
      if (!blob || (ranged && blob.size !== entry.rangeEnd! - entry.rangeStart!) || !this.makeRoom(blob.size, entry)) {
        this.fail(entry); return;
      }
      entry.elapsedMs = performance.now() - startedAt;
      entry.firstByteMs = firstByteMs;
      entry.blob = blob;
      entry.state = "ready";
      if (entry.deadline !== undefined) clearTimeout(entry.deadline);
      if (entry.claimTimer !== undefined) clearInterval(entry.claimTimer);
      entry.claimTimer = undefined;
      this.cachedBytes += blob.size;
      this.observe(entry.elapsedMs, firstByteMs, entry.end - entry.start);
    } catch {
      if (this.entries.get(entry.key) === entry && !entry.controller.signal.aborted && !this.disposed) this.retry(entry);
    }
  }
}
