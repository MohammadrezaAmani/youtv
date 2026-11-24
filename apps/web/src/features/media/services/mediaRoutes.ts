import type { WorkerProfile } from "@youtv/shared";
import { needsHttpsRelay, proxyDownloadUrl, proxyUrl, workerEndpoint } from "@/lib/proxy";

export type MediaCapability = "youtubeRelay" | "instagramPublicRelay" | "attachmentDownload";

export function orderedMediaWorkers(
  workers: WorkerProfile[], preferred: string, fallback: boolean,
  protocol = typeof window === "undefined" ? "https:" : window.location.protocol,
): WorkerProfile[] {
  const enabled = workers.filter(w => w.enabled && (protocol !== "https:" || /^https:\/\//i.test(w.baseUrl)));
  const first = enabled.find(w => w.id === preferred);
  const ordered = first ? [first, ...enabled.filter(w => w.id !== preferred)] : enabled;
  return fallback ? ordered : ordered.slice(0, 1);
}

/** Explicit Direct never selects a Worker, even if a default is configured. */
export function mediaRoutingPolicy(workers: WorkerProfile[], settings: {
  mediaRouteMode: "direct" | "proxy"; mediaWorkerId: string; defaultWorkerId: string;
  mediaWorkerFallback: boolean; mediaDirectFallback: boolean;
}, protocol?: string) {
  if (settings.mediaRouteMode === "direct") return { candidates: [], allowDirect: true };
  return {
    candidates: orderedMediaWorkers(workers, settings.mediaWorkerId || settings.defaultWorkerId, settings.mediaWorkerFallback, protocol),
    allowDirect: settings.mediaDirectFallback,
  };
}

// Errors can contain request URLs with query-token credentials. Never render those.
export function mediaError(error: unknown, worker?: WorkerProfile): string {
  let message = error instanceof Error ? error.message : String(error);
  message = message.replace(/https?:\/\/[^\s"'<>]+/gi, value => {
    try { const url = new URL(value); return `${url.origin}/${url.pathname.split("/").filter(Boolean)[0] || ""}`; }
    catch { return "[URL]"; }
  });
  if (worker?.token) message = message.split(worker.token).join("[redacted]");
  return message.slice(0, worker ? 300 : 1600);
}

export async function withMediaWorkers<T>(
  workers: WorkerProfile[],
  action: (worker: WorkerProfile) => Promise<T>,
  signal?: AbortSignal,
): Promise<{ worker: WorkerProfile; value: T }> {
  const failures: string[] = [];
  for (const worker of workers) {
    signal?.throwIfAborted();
    try {
      const value = await action(worker);
      signal?.throwIfAborted();
      return { worker, value };
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      failures.push(`${worker.name}: ${mediaError(error, worker)}`);
    }
  }
  throw new Error(failures.length ? failures.join(" | ") : "No compatible enabled Worker configured");
}

export async function requireMediaCapability(worker: WorkerProfile, capability: MediaCapability): Promise<void> {
  const response = await fetch(workerEndpoint(worker, "capabilities"), {
    credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Worker /capabilities HTTP ${response.status}; check the Worker base URL and deploy the current Worker from Proxy settings`);
  }
  const data = await response.json().catch(() => {
    throw new Error("Worker /capabilities did not return JSON; check the Worker base URL and deployment");
  }) as Record<string, unknown>;
  if (!data || typeof data !== "object") throw new Error("Invalid Worker capabilities response");
  if (data[capability] !== true)
    throw new Error(`Worker does not support ${capability}; deploy the current Worker from Proxy settings`);
  if (data.authentication === "query-token" && !worker.token)
    throw new Error("Worker requires PROXY_TOKEN; set it in Proxy settings");
}

export function mediaAssetUrls(url: string, workers: WorkerProfile[], allowDirect: boolean, filename?: string): string[] {
  if (!url) return [];
  return [...new Set([
    ...workers.map(worker => filename ? proxyDownloadUrl(url, worker, filename) : proxyUrl(url, worker)),
    ...(allowDirect && !needsHttpsRelay(url) ? [url] : []),
  ])];
}

// Only retry before the first response body is handed to the writer. Never
// concatenate data from separate responses or replay a partially written file.
export async function openMediaAsset(urls: string[], signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const failures: string[] = [];
  for (const url of urls) {
    signal?.throwIfAborted();
    try {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new DOMException("Media response timed out", "TimeoutError")), 15000);
      let response: Response;
      try {
        response = await fetch(url, {
          credentials: "omit", cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
        });
      } finally { clearTimeout(timer); }
      if (!response.ok || !response.body || /text\/html/i.test(response.headers.get("content-type") || "")) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`HTTP ${response.status} or non-media response`);
      }
      return response.body;
    } catch (error) {
      signal?.throwIfAborted();
      failures.push(mediaError(error));
    }
  }
  throw new Error(`Media download failed: ${failures.join(" | ") || "No usable route"}`);
}

// youtubei.js can return a lazy stream whose first HTTP error only occurs on read.
// Verify the first chunk before accepting a route, then replay it exactly once.
export async function primeMediaStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  let cleaned = false;
  const cleanup = () => { if (cleaned) return; cleaned = true; signal?.removeEventListener("abort", abort); reader.releaseLock(); };
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    signal?.throwIfAborted();
    do { first = await reader.read(); signal?.throwIfAborted(); } while (!first.done && !first.value.byteLength);
    if (first.done) throw new Error("Empty media stream");
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    cleanup();
    throw error;
  }
  let pending = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        if (pending) { pending = false; controller.enqueue(first.value!); return; }
        const next = await reader.read();
        signal?.throwIfAborted();
        if (next.done) { cleanup(); controller.close(); } else controller.enqueue(next.value);
      } catch (error) { await reader.cancel(error).catch(() => undefined); cleanup(); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { cleanup(); } },
  });
}

/** Re-route only URLs generated by the selected Worker, not arbitrary URLs
 * containing a `url` parameter. Preserve range request headers separately. */
export function archiveResourceRoutes(url: string, primary: WorkerProfile, fallbacks: WorkerProfile[]): string[] {
  const routes = [url];
  if (!fallbacks.length) return routes;
  try {
    const source = new URL(url);
    const proxy = new URL(workerEndpoint(primary, "proxy"));
    if (source.origin !== proxy.origin) return routes;
    let upstream: string | null = null;
    if (source.pathname === proxy.pathname) upstream = source.searchParams.get("url");
    else if (source.pathname.startsWith("/dash-base/v1/")) {
      const parts = source.pathname.split("/");
      const encoded = parts[3] || "";
      const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
      const context = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0)))) as { origin: string; query: string };
      const target = new URL(context.origin);
      if (target.origin !== context.origin) return routes;
      target.pathname = "/" + parts.slice(4).join("/");
      target.search = source.search || context.query;
      upstream = target.toString();
    }
    if (!upstream) return routes;
    for (const worker of fallbacks.filter(item => item.id !== primary.id)) {
      const alternate = new URL(proxyUrl(upstream, worker));
      if (source.pathname === proxy.pathname) for (const name of ["hls", "dash", "ua", "ref"]) {
        const value = source.searchParams.get(name);
        if (value !== null) alternate.searchParams.set(name, value);
      }
      routes.push(alternate.toString());
    }
  } catch { /* malformed relay URL is not eligible for fallback */ }
  return [...new Set(routes)];
}

export async function fetchArchiveResource(urls: string[], init: RequestInit, validate: (response: Response) => void): Promise<Response> {
  const failures: string[] = [];
  for (const url of urls) {
    init.signal?.throwIfAborted();
    let response: Response | undefined;
    try {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new DOMException("Archive response timed out", "TimeoutError")), 15000);
      try {
        response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal });
      } finally { clearTimeout(timer); }
      validate(response);
      if (!response.body) throw new Error("Media resource has no readable body");
      return response;
    } catch (error) {
      await response?.body?.cancel().catch(() => undefined);
      init.signal?.throwIfAborted();
      failures.push(mediaError(error));
    }
  }
  throw new Error(failures.join(" | ") || "No archive resource route");
}
