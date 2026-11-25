import {
  assertAllowedUrl,
  assertOrigin,
  assertToken,
  corsHeaders,
  ProxyError,
  type ProxyEnv,
} from "./security.ts";
import {
  isHls,
  hasHlsSyntax,
  parseHlsVariables,
  parseSteeringReplacement,
  applySteeringReplacement,
  rewriteSteeringJson,
  rewriteInterstitialAssetList,
  readTextStream,
  rewriteHls,
} from "./hls.ts";
import { cloudflareAdmin } from "./cloudflare.ts";
import {
  dashBaseTarget,
  dashRequestToken,
  isDash,
  rewriteDash,
} from "./dash.ts";

export interface Env extends ProxyEnv {}
const MAX_REDIRECTS = 4;
const MAX_SOURCE_REDIRECTS = 10;
const VERSION = "0.36.1";
const PROXY_USER_AGENT = `YouTV/${VERSION} (https://github.com/MohammadrezaAmani/youtv/issues)`;

function isWikimediaMediaHost(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host === "upload.wikimedia.org" || host === "thumb.wikimedia.org";
}

function json(
  request: Request,
  env: Env,
  value: object,
  status = 200,
): Response {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}

function sniffMediaKind(
  url: URL,
  contentType: string,
  prefix: Uint8Array = new Uint8Array(),
): string {
  const mime = contentType.toLowerCase().split(";")[0]?.trim() || "";
  if (isHls(url, mime)) return "hls";
  if (isDash(url, mime)) return "dash";
  if (
    mime.startsWith("video/") ||
    [
      "application/x-matroska",
      "application/x-msvideo",
      "application/x-shockwave-flash",
      "application/vnd.rn-realmedia",
      "application/vnd.ms-asf",
    ].includes(mime)
  )
    return "video";
  if (
    mime.startsWith("audio/") ||
    ["application/x-flac", "application/x-aiff", "application/x-wav"].includes(
      mime,
    )
  )
    return "audio";
  if (mime.startsWith("image/")) return "image";
  if (
    mime === "application/pdf" ||
    (prefix[0] === 0x25 &&
      prefix[1] === 0x50 &&
      prefix[2] === 0x44 &&
      prefix[3] === 0x46)
  )
    return "document";
  if (
    (prefix[0] === 0x89 &&
      prefix[1] === 0x50 &&
      prefix[2] === 0x4e &&
      prefix[3] === 0x47) ||
    (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) ||
    (prefix[0] === 0x47 && prefix[1] === 0x49 && prefix[2] === 0x46)
  )
    return "image";
  if (
    prefix[0] === 0x52 &&
    prefix[1] === 0x49 &&
    prefix[2] === 0x46 &&
    prefix[3] === 0x46 &&
    String.fromCharCode(...prefix.slice(8, 12)) === "WEBP"
  )
    return "image";
  const text = new TextDecoder()
    .decode(prefix)
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/^#EXTM3U(?:\s|$)/i.test(text)) return "hls";
  if (
    /^(?:<\?xml[^>]*>\s*)?<MPD(?:\s|>)/i.test(text) ||
    /<MPD(?:\s|>)/i.test(text.slice(0, 4096))
  )
    return "dash";
  if (prefix.length >= 12) {
    if (String.fromCharCode(...prefix.slice(4, 8)) === "ftyp") {
      const brand = String.fromCharCode(...prefix.slice(8, 12));
      return /^(?:M4A|M4B|M4P)/.test(brand) ? "audio" : "video";
    }
    if (
      prefix[0] === 0x1a &&
      prefix[1] === 0x45 &&
      prefix[2] === 0xdf &&
      prefix[3] === 0xa3
    )
      return "video";
    if (String.fromCharCode(...prefix.slice(0, 3)) === "FLV") return "video";
    if (
      String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...prefix.slice(8, 12)) === "AVI "
    )
      return "video";
    if (
      String.fromCharCode(...prefix.slice(0, 4)) === "fLaC" ||
      String.fromCharCode(...prefix.slice(0, 3)) === "ID3"
    )
      return "audio";
    if (
      String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...prefix.slice(8, 12)) === "WAVE"
    )
      return "audio";
    if (
      String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...prefix.slice(8, 12)) === "WEBP"
    )
      return "image";
    if (prefix[0] === 0xff && (prefix[1]! & 0xe0) === 0xe0) return "audio";
    if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)
      return "image";
    if (
      prefix[0] === 0x89 &&
      String.fromCharCode(...prefix.slice(1, 4)) === "PNG"
    )
      return "image";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "GIF8") return "image";
  }
  return "file";
}

function safeFilename(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\/\\\u0000-\u001f\u007f<>:\"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || "download.bin";
}
function upstreamFilename(disposition: string | null): string {
  if (!disposition) return "";
  const extended = disposition
    .match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
    ?.trim();
  if (extended) {
    try {
      return decodeURIComponent(extended.replace(/^\"|\"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const quoted = disposition.match(/filename\s*=\s*\"([^\"]*)\"/i)?.[1];
  if (quoted) return quoted;
  return (
    disposition
      .match(/filename\s*=\s*([^;]+)/i)?.[1]
      ?.trim()
      .replace(/^\"|\"$/g, "") || ""
  );
}
async function peekStream(
  body: ReadableStream<Uint8Array> | null,
  limit = 4096,
): Promise<{
  prefix: Uint8Array<ArrayBuffer>;
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
}> {
  if (!body) return { prefix: new Uint8Array(new ArrayBuffer(0)), body: null };
  const reader = body.getReader();
  // Cloudflare's stream types allow ArrayBufferLike-backed chunks, while the
  // Response constructor expects ArrayBuffer-backed Uint8Arrays. Reuse normal
  // ArrayBuffer views and copy only SharedArrayBuffer-backed chunks, avoiding
  // an unnecessary second allocation for large upstream chunks.
  const copyChunk = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
    if (value.buffer instanceof ArrayBuffer)
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
    copy.set(value);
    return copy;
  };
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0,
    finished = false;
  try {
    while (total < limit) {
      const item = await reader.read();
      if (item.done) {
        finished = true;
        break;
      }
      if (item.value?.length) {
        const chunk = copyChunk(item.value);
        chunks.push(chunk);
        total += chunk.byteLength;
      }
    }
  } catch (error) {
    reader.releaseLock();
    throw error;
  }
  const prefix = new Uint8Array(new ArrayBuffer(Math.min(total, limit)));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, prefix.length - offset);
    prefix.set(part, offset);
    offset += part.length;
    if (offset === prefix.length) break;
  }
  let index = 0,
    released = false;
  const release = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]!);
        return;
      }
      try {
        if (finished) {
          controller.close();
          release();
          return;
        }
        const item = await reader.read();
        if (item.done) {
          controller.close();
          release();
        } else if (item.value) controller.enqueue(copyChunk(item.value));
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
  return { prefix, body: stream };
}

function setDownloadDisposition(
  headers: Headers,
  requestUrl: URL,
  response: Response,
  finalUrl: URL,
): void {
  const requested = requestUrl.searchParams.get("filename") || "";
  let pathName =
    finalUrl.pathname.split("/").filter(Boolean).at(-1) || "download.bin";
  try {
    pathName = decodeURIComponent(pathName);
  } catch {
    /* keep encoded path */
  }
  const name = safeFilename(
    requested ||
      upstreamFilename(response.headers.get("Content-Disposition")) ||
      pathName,
  );
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\"\\;]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename=\"${ascii}\"; filename*=UTF-8''${encoded}`,
  );
}

const YOUTUBE_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "range",
  "if-range",
  "x-youtube-client-name",
  "x-youtube-client-version",
  "x-goog-visitor-id",
  "x-goog-api-format-version",
  "x-youtube-bootstrap-logged-in",
  "x-youtube-identity-token",
]);
function isYoutubeRelayTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const videoHost =
    host === "googlevideo.com" || host.endsWith(".googlevideo.com");
  const hostAllowed =
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtubei.googleapis.com" ||
    videoHost;
  const pathAllowed = videoHost
    ? url.pathname === "/videoplayback"
    : url.pathname.startsWith("/youtubei/v1/") ||
      url.pathname.startsWith("/s/player/") ||
      url.pathname === "/" ||
      url.pathname === "/sw.js_data" ||
      url.pathname === "/api/timedtext" ||
      url.pathname === "/iframe_api" ||
      url.pathname === "/watch" ||
      url.pathname === "/playlist" ||
      url.pathname.startsWith("/embed/");
  return hostAllowed && pathAllowed;
}
function isInstagramRelayTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!(host === "instagram.com" || host.endsWith(".instagram.com")))
    return false;
  return (
    /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
    /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/embed\/?$/.test(url.pathname)
  );
}
async function platformRelay(
  request: Request,
  env: Env,
  requestUrl: URL,
  platform: "youtube" | "instagram",
): Promise<Response> {
  assertToken(requestUrl.searchParams.get("key"), env);
  const raw = requestUrl.searchParams.get("url");
  if (!raw)
    throw new ProxyError(400, "missing_url", "url query parameter is required");
  if (!["GET", "HEAD", "POST"].includes(request.method))
    throw new ProxyError(405, "method_not_allowed", "GET/HEAD/POST only");
  let current = assertAllowedUrl(raw, env);
  const permitted =
    platform === "youtube" ? isYoutubeRelayTarget : isInstagramRelayTarget;
  if (!permitted(current))
    throw new ProxyError(
      403,
      "platform_url_not_allowed",
      `URL is not an allowed ${platform} endpoint`,
    );
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    const declared = Number(request.headers.get("content-length") || "0");
    if (declared > 1_500_000)
      throw new ProxyError(
        413,
        "platform_request_too_large",
        "Platform request body exceeds 1.5 MB",
      );
    body = await request.arrayBuffer();
    if (body.byteLength > 1_500_000)
      throw new ProxyError(
        413,
        "platform_request_too_large",
        "Platform request body exceeds 1.5 MB",
      );
  }
  let response: Response | undefined;
  let method = request.method;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    current = assertAllowedUrl(current.toString(), env);
    if (!permitted(current))
      throw new ProxyError(
        403,
        "platform_redirect_blocked",
        "Platform redirect left the permitted endpoint set",
      );
    const headers = new Headers();
    if (platform === "youtube") {
      request.headers.forEach((value, name) => {
        if (YOUTUBE_REQUEST_HEADERS.has(name.toLowerCase()))
          headers.set(name, value);
      });
      headers.set("Origin", "https://www.youtube.com");
      headers.set("Referer", "https://www.youtube.com/");
      headers.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      );
    } else {
      headers.set(
        "Accept",
        "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      );
      headers.set("Accept-Language", "en-US,en;q=0.9");
      headers.set("Referer", "https://www.instagram.com/");
      headers.set("X-IG-App-ID", "936619743392459");
      headers.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      );
    }
    response = await fetch(current.toString(), {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      redirect: "manual",
      signal: request.signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("Location");
    if (!location)
      throw new ProxyError(
        502,
        "bad_redirect",
        "Platform redirect lacks Location",
      );
    const next = assertAllowedUrl(new URL(location, current).toString(), env);
    if (!permitted(next))
      throw new ProxyError(
        403,
        "platform_redirect_blocked",
        "Platform redirect left the permitted endpoint set",
      );
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method === "POST")
    ) {
      body = undefined;
      method = "GET";
    }
    current = next;
  }
  if (!response || [301, 302, 303, 307, 308].includes(response.status))
    throw new ProxyError(502, "redirect_limit", "Too many platform redirects");
  const headers = corsHeaders(request, env);
  const responseHeaders = [
    "Content-Type",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
    "Cache-Control",
  ];
  if (
    current.hostname === "googlevideo.com" ||
    current.hostname.endsWith(".googlevideo.com")
  )
    responseHeaders.push("Content-Length");
  for (const name of responseHeaders) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "no-store");
  headers.set("X-YouTV-Proxy", VERSION);
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Only the specified Low-Latency HLS delivery directives may be forwarded. */
function deliveryDirectives(query: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const name of ["_HLS_msn", "_HLS_part", "_HLS_skip"]) {
    const value = query.get(name);
    if (value === null) continue;
    const valid =
      name === "_HLS_skip"
        ? /^(?:YES|v2)$/i.test(value)
        : /^\d{1,15}$/.test(value);
    if (!valid)
      throw new ProxyError(
        400,
        "invalid_hls_directive",
        `Invalid ${name} delivery directive`,
      );
    result.set(name, value);
  }
  if (result.has("_HLS_part") && !result.has("_HLS_msn"))
    throw new ProxyError(
      400,
      "invalid_hls_directive",
      "_HLS_part requires _HLS_msn",
    );
  return result;
}

async function fetchSource(
  url: URL,
  request: Request,
  env: Env,
  directives = new URLSearchParams(),
): Promise<{ response: Response; finalUrl: URL }> {
  let current = url;
  const expectsHls =
    new URL(request.url).searchParams.get("hls") === "1" || isHls(url, "");
  for (let i = 0; i <= MAX_SOURCE_REDIRECTS; i++) {
    current = assertAllowedUrl(current.toString(), env);
    // hls.js appends _HLS_* to the outer /proxy URL. The origin must receive
    // these as query parameters on its playlist URL, not on workers.dev.
    directives.forEach((value, name) => current.searchParams.set(name, value));
    const headers = new Headers();
    for (const key of ["Range", "If-Range", "Accept", "Accept-Language"]) {
      const v = request.headers.get(key);
      if (v) headers.set(key, v);
    }
    // A manifest request should negotiate a playlist, not an HTML document.
    // Keep Range requests and non-HLS resources on their original headers.
    if ((expectsHls || isHls(current, "")) && !headers.has("Range"))
      headers.set(
        "Accept",
        "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*;q=0.8",
      );
    // IPTV-specific HTTP hints are token-protected and restricted to approved
    // upstream hosts. Never accept arbitrary headers such as Cookie/Auth.
    const query = new URL(request.url).searchParams;
    const agent = query.get("ua") || "";
    const referer = query.get("ref") || env.UPSTREAM_REFERER || "";
    if (agent.length > 512 || /[\r\n\x00-\x1f]/.test(agent))
      throw new ProxyError(
        400,
        "invalid_user_agent",
        "Invalid User-Agent hint",
      );
    if (referer) {
      if (referer.length > 2048 || /[\r\n\x00-\x1f]/.test(referer))
        throw new ProxyError(400, "invalid_referer", "Invalid Referer hint");
      let ref: URL;
      try {
        ref = new URL(referer);
      } catch {
        throw new ProxyError(400, "invalid_referer", "Invalid Referer URL");
      }
      if (
        !["http:", "https:"].includes(ref.protocol) ||
        ref.username ||
        ref.password
      )
        throw new ProxyError(400, "invalid_referer", "Referer must be HTTP(S)");
      headers.set("Referer", ref.toString());
    }
    // Relay the real client agent, not a fabricated Chrome fingerprint.
    // Bound untrusted input; keep explicit IPTV hints for non-Wikimedia hosts.
    const incomingAgent = request.headers.get("User-Agent")?.trim() || "";
    const clientAgent = incomingAgent.length <= 512 &&
      !/[\r\n\x00-\x1f]/.test(incomingAgent) ? incomingAgent : "";
    if (isWikimediaMediaHost(current)) {
      // Identify the actual relay first, even if the user provides a UA hint.
      // The optional suffix describes the original client, not our runtime.
      headers.set("User-Agent", PROXY_USER_AGENT + (clientAgent ? ` ${clientAgent}` : ""));
    } else {
      headers.set("User-Agent", agent || clientAgent || PROXY_USER_AGENT);
    }
    // Deliberately omit client cookies and authorization headers.
    const response = await fetch(current.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual",
      signal: request.signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      return { response, finalUrl: current };
    const location = response.headers.get("Location");
    if (!location)
      throw new ProxyError(
        502,
        "bad_redirect",
        "Upstream redirect lacks Location",
      );
    await response.body?.cancel().catch(() => undefined);
    current = assertAllowedUrl(new URL(location, current).toString(), env);
  }
  throw new ProxyError(502, "redirect_limit", "Too many upstream redirects");
}

async function proxy(
  request: Request,
  env: Env,
  reqUrl: URL,
): Promise<Response> {
  const key = reqUrl.searchParams.get("key");
  assertToken(key, env);
  const rawUrl = reqUrl.searchParams.get("url");
  if (!rawUrl)
    throw new ProxyError(400, "missing_url", "url query parameter is required");
  // Content Steering pathway substitution happens on the outer Worker URL;
  // turn that back into an upstream CDN URL and reapply the SSRF checks.
  const sourceUrl = assertAllowedUrl(rawUrl, env);
  let replacement: ReturnType<typeof parseSteeringReplacement>;
  try {
    replacement = parseSteeringReplacement(
      reqUrl.searchParams.get("_youtv_steer"),
    );
  } catch (error) {
    throw new ProxyError(
      400,
      "invalid_steering_replacement",
      error instanceof Error ? error.message : "Invalid steering replacement",
    );
  }
  const upstream = assertAllowedUrl(
    applySteeringReplacement(sourceUrl, replacement).toString(),
    env,
  );
  const hlsHint = reqUrl.searchParams.get("hls") === "1" || isHls(upstream, "");
  const directives = hlsHint
    ? deliveryDirectives(reqUrl.searchParams)
    : new URLSearchParams();
  const variables = parseHlsVariables(reqUrl.searchParams.get("vars"));
  const { response, finalUrl } = await fetchSource(
    upstream,
    request,
    env,
    directives,
  );
  const headers = corsHeaders(request, env);
  headers.set("Cache-Control", "no-store");
  headers.set("X-YouTV-Proxy", VERSION);
  headers.set("X-YouTV-Source-URL", finalUrl.href);
  headers.set("X-YouTV-Upstream-Status", String(response.status));
  for (const name of [
    "Content-Type",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
    "Retry-After",
  ]) {
    const v = response.headers.get(name);
    if (v) headers.set(name, v);
  }
  const upstreamLength = response.headers.get("Content-Length");
  if (upstreamLength && !response.headers.has("Content-Encoding"))
    headers.set("Content-Length", upstreamLength);
  if (reqUrl.searchParams.get("download") === "1" && response.ok)
    setDownloadDisposition(headers, reqUrl, response, finalUrl);
  // Content Steering JSON includes cloned CDN host/path replacements. Rewrite
  // these as Worker-query replacements before handing the response to hls.js.
  if (
    reqUrl.searchParams.get("steer") === "1" &&
    request.method !== "HEAD" &&
    response.ok
  ) {
    const original = await readTextStream(response.body, 512_000);
    let data: string;
    try {
      data = rewriteSteeringJson(
        original,
        finalUrl,
        new URL("/proxy", request.url),
        key || "",
        {
          userAgent: reqUrl.searchParams.get("ua") || "",
          referer: reqUrl.searchParams.get("ref") || "",
        },
      );
    } catch (error) {
      throw new ProxyError(
        502,
        "invalid_steering_manifest",
        error instanceof Error ? error.message : "Bad steering manifest",
      );
    }
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set(
      "Content-Type",
      "application/vnd.apple.steering-list; charset=utf-8",
    );
    return new Response(data, { status: 200, headers });
  }
  if (
    reqUrl.searchParams.get("asset") === "1" &&
    request.method !== "HEAD" &&
    response.ok
  ) {
    const original = await readTextStream(response.body, 512_000);
    let data: string;
    try {
      data = rewriteInterstitialAssetList(
        original,
        finalUrl,
        new URL("/proxy", request.url),
        key || "",
        {
          userAgent: reqUrl.searchParams.get("ua") || "",
          referer: reqUrl.searchParams.get("ref") || "",
        },
      );
    } catch (error) {
      throw new ProxyError(
        502,
        "invalid_asset_list",
        error instanceof Error ? error.message : "Invalid HLS asset list",
      );
    }
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(data, { status: 200, headers });
  }
  const responseType = response.headers.get("Content-Type") || "";
  let responseBody = response.body;
  let hlsManifest = hlsHint || isHls(finalUrl, responseType);
  let dashManifest =
    reqUrl.searchParams.get("dash") === "1" || isDash(finalUrl, responseType);
  if (
    request.method !== "HEAD" &&
    response.ok &&
    response.status !== 206
  ) {
    const peeked = await peekStream(responseBody, 4096);
    responseBody = peeked.body;
    const sample = new TextDecoder()
      .decode(peeked.prefix)
      .replace(/^\uFEFF/, "")
      .trimStart();
    if (hasHlsSyntax(sample)) {
      hlsManifest = true;
      dashManifest = false;
    } else if (
      /^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/i.test(
        sample,
      )
    ) {
      dashManifest = true;
      hlsManifest = false;
    } else {
      // Hints, extensions and MIME types can all be wrong. Relay the original
      // response intact instead of treating binary media, HTML or JSON as HLS.
      // CSP sandbox/nosniff and upstream URL checks remain in effect.
      hlsManifest = false;
      dashManifest = false;
    }
  }
  if (hlsHint && request.method !== "HEAD")
    headers.set(
      "X-YouTV-HLS-Result",
      !response.ok ? "upstream-error"
        : response.status === 206 ? "partial"
        : dashManifest ? "dash"
        : hlsManifest ? "rewritten" : "not-playlist",
    );
  if (
    dashManifest &&
    request.method !== "HEAD" &&
    response.ok &&
    response.status !== 206
  ) {
    const source = await readTextStream(responseBody);
    let rewritten: string;
    try {
      rewritten = rewriteDash(
        source,
        finalUrl,
        new URL("/", request.url),
        key || "",
      );
    } catch (error) {
      throw new ProxyError(
        502,
        "invalid_dash_manifest",
        error instanceof Error ? error.message : "Invalid DASH MPD",
      );
    }
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Content-Type", "application/dash+xml; charset=utf-8");
    return new Response(rewritten, { status: 200, headers });
  }
  // Public, uncredentialed images may be reused by the browser. Do not turn
  // a private/signed URL, a range, or an upstream no-store response into a
  // cacheable resource. Media and manifests retain the default no-store.
  if (
    request.method === "GET" && response.status === 200 &&
    !hlsHint && !hlsManifest && !dashManifest &&
    /^image\/[a-z0-9.+-]+(?:\s*;|$)/i.test(responseType) &&
    !key && !env.PROXY_TOKEN?.trim() &&
    !request.headers.has("Authorization") && !request.headers.has("Range") &&
    !request.headers.has("Cookie") && !response.headers.has("Set-Cookie") &&
    [...reqUrl.searchParams.keys()].every(name => name === "url") &&
    !sourceUrl.search && !finalUrl.search &&
    !/\b(?:cookie|authorization)\b|\*/i.test(response.headers.get("Vary") || "")
  ) {
    const policy = response.headers.get("Cache-Control") || "";
    if (!/\b(?:no-store|no-cache|private)\b/i.test(policy) &&
        !/no-cache/i.test(response.headers.get("Pragma") || "")) {
      const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(policy);
      // Default only if the origin has not supplied its own freshness policy.
      const seconds = match ? Math.min(86400, Number(match[1])) :
        (!policy && !response.headers.has("Expires") ? 86400 : 0);
      const age = Number(response.headers.get("Age") || 0);
      const remaining = Math.max(0, seconds - (Number.isFinite(age) ? age : seconds));
      if (remaining > 0) headers.set("Cache-Control", `public, max-age=${Math.floor(remaining)}`);
    }
  }
  // Avoid stale Content-Length when fetch has decompressed or playlist was rewritten.
  if (
    request.method === "HEAD" ||
    !response.ok ||
    response.status === 206 ||
    !hlsManifest
  ) {
    return new Response(request.method === "HEAD" ? null : responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const source = await readTextStream(responseBody);
  let rewritten: string;
  try {
    const proxyUrl = new URL("/proxy", request.url);
    rewritten = rewriteHls(
      source,
      finalUrl,
      proxyUrl,
      key || "",
      {
        userAgent: reqUrl.searchParams.get("ua") || "",
        referer: reqUrl.searchParams.get("ref") || "",
      },
      variables,
    );
  } catch (error) {
    throw new ProxyError(
      502,
      "invalid_manifest",
      error instanceof Error ? error.message : "Invalid HLS manifest",
    );
  }
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  return new Response(rewritten, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      assertOrigin(request, env);
      if (request.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request, env),
        });
      if (url.pathname === "/admin/cloudflare") {
        if (request.method !== "POST")
          throw new ProxyError(405, "method_not_allowed", "POST required");
        return await cloudflareAdmin(request, env);
      }
      if (url.pathname === "/youtube/fetch")
        return await platformRelay(request, env, url, "youtube");
      if (url.pathname === "/instagram/fetch")
        return await platformRelay(request, env, url, "instagram");
      if (url.pathname.startsWith("/dash-base/")) {
        const token = dashRequestToken(url);
        assertToken(token, env);
        if (request.method !== "GET" && request.method !== "HEAD")
          throw new ProxyError(405, "method_not_allowed", "GET/HEAD only");
        const target = dashBaseTarget(url, env);
        // Location updates can return a new MPD; run the normal detection and rewrite.
        const relay = new URL("/proxy", url);
        relay.searchParams.set("url", target.toString());
        if (token) relay.searchParams.set("key", token);
        return await proxy(request, env, relay);
      }
      if (url.pathname === "/probe") {
        if (request.method !== "GET")
          throw new ProxyError(405, "method_not_allowed", "GET required");
        assertToken(url.searchParams.get("key"), env);
        const source = url.searchParams.get("url");
        if (!source)
          throw new ProxyError(400, "missing_url", "Source URL required");
        const upstream = assertAllowedUrl(source, env);
        const start = Date.now();
        let result = await fetchSource(
          upstream,
          new Request(request.url, {
            method: "HEAD",
            signal: AbortSignal.timeout(9000),
          }),
          env,
        );
        let prefix = new Uint8Array();
        const initialType = result.response.headers.get("Content-Type") || "";
        let kind = sniffMediaKind(result.finalUrl, initialType);
        if (
          [403, 405, 501].includes(result.response.status) ||
          kind === "file"
        ) {
          await result.response.body?.cancel().catch(() => undefined);
          result = await fetchSource(
            upstream,
            new Request(request.url, {
              headers: { Range: "bytes=0-4095" },
              signal: AbortSignal.timeout(9000),
            }),
            env,
          );
          const peeked = await peekStream(result.response.body, 4096);
          prefix = peeked.prefix;
          await peeked.body?.cancel().catch(() => undefined);
          kind = sniffMediaKind(
            result.finalUrl,
            result.response.headers.get("Content-Type") || initialType,
            prefix,
          );
        } else await result.response.body?.cancel().catch(() => undefined);
        const disposition =
          result.response.headers.get("Content-Disposition") || "";
        const contentRange = result.response.headers.get("Content-Range") || "";
        const contentLength =
          Number(
            contentRange.match(/\/(\d+)$/)?.[1] ||
              (result.response.status === 206
                ? ""
                : result.response.headers.get("Content-Length")),
          ) || null;
        return json(request, env, {
          ok: result.response.status >= 200 && result.response.status < 400,
          status: result.response.status,
          elapsedMs: Math.max(0, Date.now() - start),
          contentType:
            result.response.headers.get("Content-Type") || initialType,
          contentLength,
          acceptRanges: result.response.headers.get("Accept-Ranges") || "",
          filename: upstreamFilename(disposition),
          kind,
        });
      }
      if (url.pathname === "/health" && request.method === "GET")
        return json(request, env, {
          name: "YouTV Proxy",
          version: VERSION,
          ok: true,
        });
      if (url.pathname === "/capabilities" && request.method === "GET")
        return json(request, env, {
          protocol: 2,
          hls: true,
          dash: true,
          hlsVariables: true,
          llHlsDirectives: true,
          contentSteeringProxy: true,
          range: true,
          binaryStreaming: true,
          attachmentDownload: true,
          youtubeRelay: true,
          instagramPublicRelay: true,
          mediaCenter: true,
          playlistImport: true,
          authentication: env.PROXY_TOKEN?.trim() ? "query-token" : "none",
        });
      if (url.pathname === "/text") {
        if (request.method !== "GET")
          throw new ProxyError(405, "method_not_allowed", "GET only");
        const key = url.searchParams.get("key");
        assertToken(key, env);
        const raw = url.searchParams.get("url");
        if (!raw)
          throw new ProxyError(
            400,
            "missing_url",
            "url query parameter is required",
          );
        const { response, finalUrl } = await fetchSource(
          assertAllowedUrl(raw, env),
          request,
          env,
        );
        if (!response.ok)
          throw new ProxyError(
            502,
            "upstream_error",
            `Playlist source returned HTTP ${response.status}`,
          );
        // Playlist/text responses do not need rewriting: stream them to the
        // browser instead of buffering the entire file or rejecting large lists.
        const headers = corsHeaders(request, env);
        headers.set("Content-Type", "text/plain; charset=utf-8");
        headers.set("X-YouTV-Source-URL", finalUrl.href);
        headers.set("Cache-Control", "no-store");
        return new Response(response.body, { status: 200, headers });
      }
      if (url.pathname !== "/proxy")
        return json(
          request,
          env,
          { code: "not_found", error: "Not found" },
          404,
        );
      if (!["GET", "HEAD"].includes(request.method))
        throw new ProxyError(405, "method_not_allowed", "GET/HEAD only");
      return await proxy(request, env, url);
    } catch (error) {
      if (error instanceof ProxyError)
        return json(
          request,
          env,
          { code: error.code, error: error.message },
          error.status,
        );
      // Never expose secret-bearing upstream URLs or request tokens in errors.
      return json(
        request,
        env,
        { code: "upstream_error", error: "Upstream request failed" },
        502,
      );
    }
  },
} satisfies ExportedHandler<Env>;
