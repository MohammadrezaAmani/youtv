/**
 * HLS-aware proxy rewriting. Preserve tag semantics and media bytes while
 * translating only network resources to the HTTPS Worker. RFC 8216 and the
 * 2nd-edition HLS extensions (DEFINE/LL-HLS/Content Steering) are supported.
 * This is intentionally a URL rewriter, not a lossy playlist serializer.
 */
export type HlsVariables = Record<string, string>;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const VARIABLE_PATTERN = /\{\$([A-Za-z_][A-Za-z0-9_-]{0,63})\}/g;
const MAX_VARIABLES = 32;
const MAX_VARIABLE_BYTES = 3072;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

// Tags that own network URI attributes. Never reinterpret unknown tag values
// as media URLs: this previously broke the Telewebion EXT-X-VERSION line.
const URI_ATTRIBUTES: Record<string, readonly string[]> = {
  "EXT-X-KEY": ["URI"],
  "EXT-X-SESSION-KEY": ["URI"],
  "EXT-X-SESSION-DATA": ["URI"],
  "EXT-X-MAP": ["URI"],
  "EXT-X-MEDIA": ["URI"],
  "EXT-X-I-FRAME-STREAM-INF": ["URI"],
  "EXT-X-IMAGE-STREAM-INF": ["URI"],
  "EXT-X-PART": ["URI"],
  "EXT-X-PRELOAD-HINT": ["URI"],
  "EXT-X-RENDITION-REPORT": ["URI"],
  "EXT-X-CONTENT-STEERING": ["SERVER-URI"],
  "EXT-X-DATERANGE": ["X-ASSET-URI", "X-ASSET-LIST"],
  "EXT-X-INTERSTITIAL": ["URI"],
};
const PLAYLIST_URI_TAGS = new Set([
  "EXT-X-MEDIA",
  "EXT-X-I-FRAME-STREAM-INF",
  "EXT-X-IMAGE-STREAM-INF",
  "EXT-X-RENDITION-REPORT",
]);
const SAFE_INLINE_TAGS = new Set([
  "EXT-X-KEY",
  "EXT-X-SESSION-KEY",
  "EXT-X-SESSION-DATA",
]);
// Inline media payloads are legal HLS resources and must not be fetched via the
// proxy. Other non-HTTP schemes (javascript:, file:, ftp:) remain forbidden.
const INLINE_MEDIA_TAGS = new Set([
  "EXT-X-MAP",
  "EXT-X-PART",
  "EXT-X-PRELOAD-HINT",
  "EXT-X-PREFETCH",
  "EXT-X-MEDIA",
  "EXT-X-I-FRAME-STREAM-INF",
  "EXT-X-IMAGE-STREAM-INF",
]);

/** Split HLS attribute lists at commas outside quotes, respecting escapes. */
function attributeParts(value: string): string[] {
  const parts: string[] = [];
  let start = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function attribute(
  part: string,
): { name: string; value: string; quoted: boolean } | null {
  const eq = part.indexOf("=");
  if (eq < 1) return null;
  const name = part.slice(0, eq).trim().toUpperCase();
  const raw = part.slice(eq + 1).trim();
  const quoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2;
  return {
    name,
    value: quoted ? raw.slice(1, -1).replace(/\\"/g, '"') : raw,
    quoted,
  };
}

function attributes(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of attributeParts(value)) {
    const item = attribute(part);
    if (item) result.set(item.name, item.value);
  }
  return result;
}

function safeVariables(vars: HlsVariables): HlsVariables {
  if (!vars || typeof vars !== "object" || Array.isArray(vars))
    throw new Error("Invalid HLS variable map");
  const result: HlsVariables = Object.create(null);
  for (const [name, value] of Object.entries(vars)) {
    if (
      !VARIABLE_NAME.test(name) ||
      typeof value !== "string" ||
      value.length > 1024
    )
      throw new Error("Invalid HLS variable definition");
    result[name] = value;
    if (
      Object.keys(result).length > MAX_VARIABLES ||
      JSON.stringify(result).length > MAX_VARIABLE_BYTES
    )
      throw new Error("Too many HLS variables");
  }
  return result;
}

export function parseHlsVariables(raw: string | null): HlsVariables {
  if (!raw) return Object.create(null);
  if (raw.length > MAX_VARIABLE_BYTES * 3)
    throw new Error("HLS variables are too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid HLS variables");
  }
  return safeVariables(value as HlsVariables);
}

function substitute(value: string, vars: HlsVariables): string {
  let result = value;
  for (let i = 0; i < 8; i++) {
    let replaced = false;
    result = result.replace(VARIABLE_PATTERN, (_match, name: string) => {
      if (!Object.hasOwn(vars, name))
        throw new Error(`Undefined HLS variable: ${name}`);
      replaced = true;
      return vars[name]!;
    });
    if (!replaced) return result;
  }
  if (result.includes("{$"))
    throw new Error("Recursive HLS variable definition");
  return result;
}

/** Validates resource URLs before allowing them into the generated manifest. */
function resourceUrl(
  uri: string,
  source: URL,
  tag: string,
  attributeName: string,
): URL | null {
  const input = uri.trim();
  let resolved: URL;
  try {
    resolved = new URL(input, source);
  } catch {
    throw new Error("Invalid HLS URI");
  }
  // Inline data: may occur on an ordinary media URI line (EXTINF followed by
  // data:...), in MAP/PART/PREFETCH resources, and in metadata or key tags.
  // Preserve it byte-for-byte rather than wrapping it in a Worker URL. The
  // whole manifest is already bounded by MAX_MANIFEST_BYTES.
  const inlineMedia =
    (tag === "" && attributeName === "") ||
    (INLINE_MEDIA_TAGS.has(tag) &&
      (attributeName === "URI" ||
        (tag === "EXT-X-PREFETCH" && attributeName === "")));
  if (
    resolved.protocol === "data:" &&
    ((SAFE_INLINE_TAGS.has(tag) && input.length <= 2048) ||
      (inlineMedia && input.length <= MAX_MANIFEST_BYTES))
  )
    return null;
  if (
    (resolved.protocol === "skd:" || resolved.protocol === "urn:") &&
    (tag === "EXT-X-KEY" || tag === "EXT-X-SESSION-KEY") &&
    attributeName === "URI"
  )
    return null;
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
    throw new Error(`Unsupported HLS URI scheme: ${resolved.protocol}`);
  if (resolved.username || resolved.password)
    throw new Error("Credentials in HLS URI are forbidden");
  return resolved;
}

function normalizeDirective(line: string): string {
  const trimmed = line.trim();
  // Providers sometimes omit the hash, use lowercase tags or add whitespace.
  const match = /^#?(EXTM3U|EXTINF|EXT-X-[A-Z0-9-]+)(?::(.*))?$/i.exec(trimmed);
  if (!match) return line;
  return `#${match[1]!.toUpperCase()}${match[2] === undefined ? "" : `:${match[2]}`}`;
}

/** A URL suffix/MIME is only a hint; require recognizable playlist syntax. */
export function hasHlsSyntax(text: string): boolean {
  for (const line of text.replace(/\uFEFF/g, "").split(/\r\n|\n|\r/)) {
    const value = normalizeDirective(line).trim();
    if (!value) continue;
    if (
      value === "#EXTM3U" ||
      /^#(?:EXTINF:|EXT-X-[A-Z0-9-]+(?::|$))/.test(value)
    ) return true;
    // Leading ordinary comments are allowed, not arbitrary HTML/JSON/URLs.
    if (value.startsWith("#") && !/^#EXT/i.test(value)) continue;
    return false;
  }
  return false;
}

/**
 * Rewrites a multivariant/media playlist without losing unknown tags.
 * `inherited` carries master-level DEFINE values into child playlists only;
 * the child may import them with EXT-X-DEFINE:IMPORT="name".
 */
export function rewriteHls(
  manifest: string,
  sourceUrl: URL,
  proxyUrl: URL,
  token: string,
  hints?: { userAgent?: string; referer?: string },
  inherited: HlsVariables = {},
): string {
  if (new TextEncoder().encode(manifest).byteLength > MAX_MANIFEST_BYTES)
    throw new Error("HLS manifest too large");
  const source = manifest.replace(/^[\s\uFEFF]+/, "");
  if (!hasHlsSyntax(source))
    throw new Error("Response is not an HLS playlist (#EXTM3U missing)");
  const originalLines = source.split(/\r\n|\n|\r/);
  // Emit a canonical header first even for a missing/misplaced/lowercase header.
  const header = originalLines.findIndex(line => normalizeDirective(line).trim() === "#EXTM3U");
  if (header >= 0) originalLines.splice(header, 1);
  originalLines.unshift("#EXTM3U");

  const parent = safeVariables(inherited);
  const vars: HlsVariables = Object.create(null);
  const newline = manifest.includes("\r\n") ? "\r\n" : "\n";

  const rewriteUrl = (
    raw: string,
    tag: string,
    attrName = "",
    isPlaylist = false,
  ): string => {
    const expanded = substitute(raw, vars);
    const resolved = resourceUrl(expanded, sourceUrl, tag, attrName);
    if (!resolved) return expanded;
    const out = new URL(proxyUrl);
    out.searchParams.set("url", resolved.toString());
    if (token) out.searchParams.set("key", token);
    if (hints?.userAgent) out.searchParams.set("ua", hints.userAgent);
    if (hints?.referer) out.searchParams.set("ref", hints.referer);
    if (tag === "EXT-X-CONTENT-STEERING") out.searchParams.set("steer", "1");
    if (tag === "EXT-X-DATERANGE" && attrName === "X-ASSET-LIST")
      out.searchParams.set("asset", "1");
    if (isPlaylist) {
      out.searchParams.set("hls", "1");
      if (Object.keys(vars).length)
        out.searchParams.set("vars", JSON.stringify(safeVariables(vars)));
    }
    return out.toString();
  };

  let pendingPlaylistUri = false;
  const output = originalLines.map((original) => {
    const normalized = normalizeDirective(original);
    const trimmed = normalized.trim();
    if (!trimmed) return original;
    if (!trimmed.startsWith("#")) {
      const isPlaylist =
        pendingPlaylistUri || /\.m3u8?(?:[?#]|$)/i.test(trimmed);
      pendingPlaylistUri = false;
      const uri = rewriteUrl(trimmed, "", "", isPlaylist);
      return normalized.replace(trimmed, uri);
    }
    if (trimmed.startsWith("#EXT-X-STREAM-INF:")) pendingPlaylistUri = true;
    if (trimmed.startsWith("#EXTM3U")) return normalized;

    const tagged = /^#([A-Z0-9-]+)(?::(.*))?$/i.exec(trimmed);
    if (!tagged) return normalized;
    const tag = tagged[1]!.toUpperCase();
    const parameter = tagged[2] ?? "";

    if (tag === "EXT-X-DEFINE") {
      const defs = attributes(parameter);
      const importName = defs.get("IMPORT");
      const declaredName = defs.get("NAME");
      const queryName = defs.get("QUERYPARAM");
      const name = declaredName || importName || queryName;
      if (!name || !VARIABLE_NAME.test(name))
        throw new Error("Invalid EXT-X-DEFINE variable name");
      let value: string | undefined;
      if (importName) value = parent[importName];
      else if (queryName)
        value = sourceUrl.searchParams.get(queryName) ?? undefined;
      else value = defs.get("VALUE");
      if (value === undefined) throw new Error(`Missing HLS variable: ${name}`);
      if (
        !Object.hasOwn(vars, name) &&
        Object.keys(vars).length >= MAX_VARIABLES
      )
        throw new Error("Too many HLS variables");
      vars[name] = value;
      safeVariables(vars);
      // The browser sees the Worker URL, not the upstream URL query string.
      // Materialize QUERYPARAM into NAME/VALUE so hls.js agrees with the proxy.
      if (queryName) {
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return normalized.replace(
          trimmed,
          `#EXT-X-DEFINE:NAME="${name}",VALUE="${escapedValue}"`,
        );
      }
      return normalized;
    }

    if (tag === "EXT-X-PREFETCH") {
      const uri = rewriteUrl(parameter.trim(), tag);
      return normalized.replace(parameter, uri);
    }
    const names = URI_ATTRIBUTES[tag];
    if (!names || !parameter) return normalized;
    const parts = attributeParts(parameter);
    const kind = attributes(parameter).get("TYPE") || "";
    const rewritten = parts.map((part) => {
      const attr = attribute(part);
      if (!attr || !names.includes(attr.name)) return part;
      const playlist =
        (PLAYLIST_URI_TAGS.has(tag) &&
          (tag !== "EXT-X-MEDIA" ||
            kind !== "SUBTITLES" ||
            /\.m3u8?(?:[?#]|$)/i.test(attr.value))) ||
        (tag === "EXT-X-DATERANGE" && attr.name === "X-ASSET-URI");
      const uri = rewriteUrl(attr.value, tag, attr.name, playlist);
      const value = attr.quoted ? `"${uri.replace(/"/g, '\\"')}"` : uri;
      return part.replace(/^\s*[^=]+\s*=\s*.*$/, `${attr.name}=${value}`);
    });
    const next = `${trimmed.slice(0, trimmed.indexOf(":") + 1)}${rewritten.join(",")}`;
    return normalized.replace(trimmed, next);
  });
  return output.join(newline);
}

/**
 * Content Steering operates on the URL visible to the player (the Worker),
 * not the upstream URL inside its `url` query. Translate CDN pathway clone
 * replacements to a *single* bounded `_youtv_steer` query parameter instead.
 * This preserves the HTTPS Worker host for every alternate CDN pathway.
 */
export type SteeringReplacement = {
  host?: string;
  pathPrefix?: string;
  params?: Record<string, string>;
};

export function parseSteeringReplacement(
  raw: string | null,
): SteeringReplacement | null {
  if (!raw) return null;
  if (raw.length > 3000) throw new Error("Steering replacement too large");
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Invalid steering replacement");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new Error("Invalid steering replacement");
  const data = obj as SteeringReplacement;
  if (
    data.host !== undefined &&
    (typeof data.host !== "string" ||
      data.host.length > 255 ||
      !/^[A-Za-z0-9.-]+$/.test(data.host))
  )
    throw new Error("Invalid steering host");
  if (
    data.pathPrefix !== undefined &&
    (typeof data.pathPrefix !== "string" ||
      data.pathPrefix.length > 512 ||
      !data.pathPrefix.startsWith("/") ||
      /[?#\\]/.test(data.pathPrefix))
  )
    throw new Error("Invalid steering path prefix");
  if (data.params !== undefined) {
    if (
      typeof data.params !== "object" ||
      !data.params ||
      Array.isArray(data.params) ||
      Object.keys(data.params).length > 16
    )
      throw new Error("Invalid steering parameters");
    for (const [k, v] of Object.entries(data.params)) {
      if (
        !/^[A-Za-z0-9_.~-]{1,64}$/.test(k) ||
        typeof v !== "string" ||
        v.length > 512
      )
        throw new Error("Invalid steering parameter");
    }
  }
  return data;
}

export function applySteeringReplacement(
  upstream: URL,
  replacement: SteeringReplacement | null,
): URL {
  if (!replacement) return upstream;
  const result = new URL(upstream);
  if (replacement.host) result.hostname = replacement.host;
  if (replacement.pathPrefix)
    result.pathname =
      replacement.pathPrefix.replace(/\/$/, "") +
      "/" +
      result.pathname.replace(/^\//, "");
  for (const [name, value] of Object.entries(replacement.params || {}))
    result.searchParams.set(name, value);
  return result;
}

/** Translate the steering JSON response without changing playlist metadata. */
export function rewriteSteeringJson(
  text: string,
  upstream: URL,
  proxy: URL,
  token: string,
  hints: { userAgent?: string; referer?: string } = {},
): string {
  if (text.length > 512_000) throw new Error("Steering manifest too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid Content Steering JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Content Steering JSON");
  const steering = parsed as Record<string, unknown>;
  if (typeof steering["RELOAD-URI"] === "string") {
    const target = resourceUrl(
      steering["RELOAD-URI"],
      upstream,
      "EXT-X-CONTENT-STEERING",
      "SERVER-URI",
    );
    if (!target) throw new Error("Invalid steering reload URL");
    const reload = new URL(proxy);
    reload.searchParams.set("url", target.href);
    reload.searchParams.set("steer", "1");
    if (token) reload.searchParams.set("key", token);
    if (hints.userAgent) reload.searchParams.set("ua", hints.userAgent);
    if (hints.referer) reload.searchParams.set("ref", hints.referer);
    steering["RELOAD-URI"] = reload.href;
  }
  if (Array.isArray(steering["PATHWAY-CLONES"])) {
    steering["PATHWAY-CLONES"] = steering["PATHWAY-CLONES"].map(
      (unknownClone: unknown) => {
        if (
          !unknownClone ||
          typeof unknownClone !== "object" ||
          Array.isArray(unknownClone)
        )
          return unknownClone;
        const clone = { ...(unknownClone as Record<string, unknown>) };
        const original = clone["URI-REPLACEMENT"];
        if (
          !original ||
          typeof original !== "object" ||
          Array.isArray(original)
        )
          return clone;
        const value = original as Record<string, unknown>;
        const translated: SteeringReplacement = {};
        if (typeof value.HOST === "string") translated.host = value.HOST;
        if (typeof value["PATH-PREFIX"] === "string")
          translated.pathPrefix = value["PATH-PREFIX"];
        if (
          value.PARAMS &&
          typeof value.PARAMS === "object" &&
          !Array.isArray(value.PARAMS)
        )
          translated.params = value.PARAMS as Record<string, string>;
        parseSteeringReplacement(JSON.stringify(translated));
        // Only change the *outer* Worker query, never workers.dev's HOST/PATH.
        clone["URI-REPLACEMENT"] = {
          PARAMS: { _youtv_steer: JSON.stringify(translated) },
        };
        return clone;
      },
    );
  }
  return JSON.stringify(steering);
}

/** Rewrites HLS interstitial asset-list JSON into this same HTTPS Worker. */
export function rewriteInterstitialAssetList(
  text: string,
  upstream: URL,
  proxy: URL,
  token: string,
  hints: { userAgent?: string; referer?: string } = {},
): string {
  if (text.length > 512_000) throw new Error("HLS asset list too large");
  let object: unknown;
  try {
    object = JSON.parse(text);
  } catch {
    throw new Error("Invalid HLS asset list JSON");
  }
  if (!object || typeof object !== "object" || Array.isArray(object))
    throw new Error("Invalid HLS asset list JSON");
  const list = object as Record<string, unknown>;
  if (!Array.isArray(list.ASSETS))
    throw new Error("Missing HLS interstitial ASSETS");
  list.ASSETS = list.ASSETS.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const asset = { ...(item as Record<string, unknown>) };
    if (typeof asset.URI !== "string") return asset;
    const resolved = resourceUrl(
      asset.URI,
      upstream,
      "EXT-X-DATERANGE",
      "X-ASSET-URI",
    );
    if (!resolved) throw new Error("Invalid interstitial asset URL");
    const target = new URL(proxy);
    target.searchParams.set("url", resolved.href);
    target.searchParams.set("hls", "1");
    if (token) target.searchParams.set("key", token);
    if (hints.userAgent) target.searchParams.set("ua", hints.userAgent);
    if (hints.referer) target.searchParams.set("ref", hints.referer);
    asset.URI = target.href;
    return asset;
  });
  return JSON.stringify(list);
}

export function isHls(url: URL, contentType: string): boolean {
  const path = url.pathname.toLowerCase();
  const mime = contentType.toLowerCase().split(";")[0]?.trim() || "";
  return (
    path.endsWith(".m3u8") ||
    path.endsWith(".m3u") ||
    [
      "application/vnd.apple.mpegurl",
      "application/x-mpegurl",
      "audio/mpegurl",
      "audio/x-mpegurl",
    ].includes(mime)
  );
}

export async function readTextStream(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = MAX_MANIFEST_BYTES,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("HLS manifest too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
