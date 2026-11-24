import {
  normalizeStreamUrl,
  type Channel,
  type Settings,
  type WorkerProfile,
} from "@youtv/shared";
export type ProxyResult = {
  url: string;
  mode: "direct" | "proxy";
  worker?: WorkerProfile;
};
/** 'default' means respect the saved global setting, unless this channel was
 * explicitly configured to use another route. It must never mean 'auto'. */
export type ConnectionOverride = "default" | "direct" | "proxy" | "auto";
export type ConnectionMode = "direct" | "proxy" | "auto";
/** On the HTTPS deployment, HTTP sources must be fetched server-side through an
 * HTTPS Worker. This is a browser mixed-content constraint, not a bad URL. */
export function needsHttpsRelay(
  sourceUrl: string,
  appProtocol = typeof window === "undefined"
    ? "https:"
    : window.location.protocol,
): boolean {
  return appProtocol === "https:" && /^http:\/\//i.test(sourceUrl);
}
const HTTP_WORKER_REQUIRED =
  "This HTTP source needs an active HTTPS Worker (Proxy settings). Keep the original http:// URL; do not change it to https://.";
function requireHttpsWorker(worker: WorkerProfile, appProtocol: string): void {
  if (appProtocol === "https:" && !/^https:\/\//i.test(worker.baseUrl))
    throw new Error(
      "The Worker endpoint must use HTTPS when YouTV is opened on GitHub Pages. The source may still use HTTP.",
    );
}

export function effectiveConnectionMode(
  channel: Pick<Channel, "proxyMode">,
  settings: Pick<Settings, "proxyMode">,
  override: ConnectionOverride = "default",
): ConnectionMode {
  return override === "default"
    ? channel.proxyMode === "inherit"
      ? settings.proxyMode
      : channel.proxyMode
    : override;
}

export function activeWorker(
  channel: Channel,
  settings: Settings,
  workers: WorkerProfile[],
): WorkerProfile | undefined {
  const id = channel.workerId || settings.defaultWorkerId;
  return workers.find((w) => w.id === id && w.enabled);
}
/** Accept a Worker base URL or a copied URL for a known Worker endpoint.
 * A saved endpoint is not a mount directory. Never reuse query credentials
 * from a copied request; the profile token is the sole authentication source.
 * Preserve explicit mount prefixes for reverse-proxied installations. */
export function normalizeWorkerBaseUrl(raw: string): string {
  const base = new URL(normalizeStreamUrl(raw));
  base.pathname = base.pathname.replace(/\/+$/, "").replace(
    /\/(?:youtube\/fetch|instagram\/fetch|admin\/cloudflare|proxy|probe|text|health|capabilities)$/,
    "",
  ) + "/";
  base.search = "";
  base.hash = "";
  return base.toString();
}

export function proxyUrl(
  url: string,
  worker: WorkerProfile,
  route: "proxy" | "text" | "probe" = "proxy",
  hls = false,
  hints?: { userAgent?: string; referer?: string },
): string {
  const base = normalizeWorkerBaseUrl(worker.baseUrl);
  const path = new URL(route, base.endsWith("/") ? base : base + "/");
  path.searchParams.set("url", normalizeStreamUrl(url));
  if (worker.token) path.searchParams.set("key", worker.token);
  if (route === "proxy" && hls) path.searchParams.set("hls", "1");
  if (hints?.userAgent) path.searchParams.set("ua", hints.userAgent);
  if (hints?.referer) path.searchParams.set("ref", hints.referer);
  return path.toString();
}
export function resolveStream(
  channel: Channel,
  settings: Settings,
  workers: WorkerProfile[],
  forceProxy = false,
  appProtocol = typeof window === "undefined"
    ? "https:"
    : window.location.protocol,
): ProxyResult {
  const mode = effectiveConnectionMode(channel, settings);
  const needsRelay = needsHttpsRelay(channel.url, appProtocol);
  if (!forceProxy && !needsRelay && mode === "direct")
    return { url: channel.url, mode: "direct" };
  const worker = activeWorker(channel, settings, workers);
  if (!worker) {
    if (needsRelay) throw new Error(HTTP_WORKER_REQUIRED);
    if (mode === "proxy")
      throw new Error("Proxy is enabled but no active Worker is configured");
    return { url: channel.url, mode: "direct" };
  }
  if (!needsRelay && mode === "auto" && !forceProxy)
    return { url: channel.url, mode: "direct" };
  requireHttpsWorker(worker, appProtocol);
  return {
    url: proxyUrl(
      channel.url,
      worker,
      "proxy",
      channel.format === "hls" ||
        (channel.format === "auto" && /\.m3u8?(?:[?#]|$)/i.test(channel.url)),
      { userAgent: channel.iptv.userAgent, referer: channel.iptv.referer },
    ),
    mode: "proxy",
    worker,
  };
}

/** Shared routing for URL-based IPTV playlists and Teletext. The saved URL
 * remains HTTP when necessary; only the browser's request goes to HTTPS. */
export function resolveTextSource(
  source: string,
  settings: Pick<Settings, "defaultWorkerId">,
  workers: WorkerProfile[],
  requestedWorkerId = "",
  useWorker = false,
  appProtocol = typeof window === "undefined"
    ? "https:"
    : window.location.protocol,
): { url: string; workerId: string } {
  const needsRelay = needsHttpsRelay(source, appProtocol);
  if (!needsRelay && !useWorker) return { url: source, workerId: "" };
  const worker =
    workers.find(
      (w) =>
        w.id === (requestedWorkerId || settings.defaultWorkerId) && w.enabled,
    ) ||
    (needsRelay
      ? workers.find((w) => w.id === settings.defaultWorkerId && w.enabled)
      : undefined);
  if (!worker)
    throw new Error(
      needsRelay ? HTTP_WORKER_REQUIRED : "Selected Worker is unavailable",
    );
  requireHttpsWorker(worker, appProtocol);
  return { url: proxyUrl(source, worker, "text"), workerId: worker.id };
}

/** The relay URL is not the base of the upstream playlist. A direct fetch can
 * use Response.url; a Worker must expose the last validated redirect target. */
export function playlistResponseBase(
  response: Pick<Response, "headers" | "url">,
  original: string,
  proxied: boolean,
): string {
  const candidate = proxied ? response.headers.get("X-YouTV-Source-URL") : response.url;
  if (candidate) {
    try { return normalizeStreamUrl(candidate); } catch { /* invalid metadata */ }
  }
  return original;
}

/** Build a first-party Worker endpoint while preserving subpath deployments. */
export function workerEndpoint(
  worker: WorkerProfile,
  route: string,
  params: Record<string, string> = {},
): string {
  const base = normalizeWorkerBaseUrl(worker.baseUrl);
  const endpoint = new URL(
    route.replace(/^\/+/, ""),
    base.endsWith("/") ? base : base + "/",
  );
  for (const [name, value] of Object.entries(params))
    endpoint.searchParams.set(name, value);
  if (worker.token) endpoint.searchParams.set("key", worker.token);
  return endpoint.toString();
}

/** A download request stays on the configured Worker so CORS and attachment headers are handled there. */
export function proxyDownloadUrl(
  url: string,
  worker: WorkerProfile,
  filename = "",
): string {
  const endpoint = new URL(proxyUrl(url, worker));
  endpoint.searchParams.set("download", "1");
  if (filename) endpoint.searchParams.set("filename", filename.slice(0, 180));
  return endpoint.toString();
}

const YOUTUBE_RELAY_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "range",
  "if-range",
  "x-youtube-client-name",
  "x-youtube-client-version",
  "x-goog-visitor-id",
  "x-goog-api-format-version",
];
/** youtubei.js runs in the browser; only its network requests are relayed by the existing Worker. */
export function createYoutubeFetch(worker: WorkerProfile): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const original = new Request(input, init);
    const target = new URL(original.url);
    const host = target.hostname.toLowerCase();
    const youtubeHost =
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtubei.googleapis.com";
    const videoHost =
      host === "googlevideo.com" || host.endsWith(".googlevideo.com");
    const pathAllowed = youtubeHost
      ? target.pathname.startsWith("/youtubei/v1/") ||
        target.pathname.startsWith("/s/player/") ||
        target.pathname === "/" ||
        target.pathname === "/sw.js_data" ||
        target.pathname === "/api/timedtext" ||
        target.pathname === "/iframe_api" ||
        target.pathname === "/watch" ||
        target.pathname === "/playlist" ||
        target.pathname.startsWith("/embed/")
      : videoHost && target.pathname === "/videoplayback";
    if (!pathAllowed)
      throw new TypeError(
        `YouTube request is outside the supported relay scope: ${host}${target.pathname}`,
      );
    const endpoint = workerEndpoint(worker, "youtube/fetch", {
      url: target.toString(),
    });
    const headers = new Headers();
    for (const name of YOUTUBE_RELAY_HEADERS) {
      const value = original.headers.get(name);
      if (value) headers.set(name, value);
    }
    const method = original.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await original.clone().arrayBuffer();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("YouTube relay timed out", "TimeoutError")), 15000);
    try {
      const response = await fetch(endpoint, {
        method, headers, body,
        signal: AbortSignal.any([original.signal, timeout.signal]),
        redirect: "error",
        credentials: "omit",
      });
      if (response.status === 404 && !response.headers.has("X-YouTV-Proxy")) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Worker ${worker.name} does not expose /youtube/fetch (HTTP 404); deploy the current Worker`);
      }
      return response;
    } finally { clearTimeout(timer); }
  };
}

export function instagramFetchUrl(
  worker: WorkerProfile,
  url: string,
  withJson = true,
): string {
  const target = new URL(url);
  if (
    !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
      target.hostname.toLowerCase(),
    )
  )
    throw new Error(
      "Only public Instagram post, Reel and TV URLs are supported",
    );
  if (!/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+(?:\/embed)?\/?$/.test(target.pathname))
    throw new Error("Invalid Instagram post URL");
  if (withJson) {
    target.searchParams.set("__a", "1");
    target.searchParams.set("__d", "dis");
  }
  return workerEndpoint(worker, "instagram/fetch", { url: target.toString() });
}
