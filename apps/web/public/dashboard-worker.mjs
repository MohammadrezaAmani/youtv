// YouTV Worker bundle version: v0.36.1
// apps/worker/src/security.ts
class ProxyError extends Error {
  status;
  code;
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function entries(csv) {
  return (csv || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function blockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".onion"))
    return true;
  if (host.includes(":")) {
    return true;
  }
  if (/^\d+(\.\d+){3}$/.test(host)) {
    return true;
  }
  if (/^\d+$/.test(host) || /^0x/i.test(host))
    return true;
  return false;
}
function assertAllowedUrl(raw, env) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ProxyError(400, "invalid_url", "Invalid source URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new ProxyError(400, "invalid_url", "Only HTTP(S) without embedded credentials is supported");
  if (blockedHost(url.hostname))
    throw new ProxyError(403, "blocked_host", "Cloudflare Workers cannot fetch IP-literal URLs directly; private and local hosts are also blocked. Use a public DNS hostname.");
  const allowed = entries(env.ALLOWED_HOSTS);
  if (!allowed.length)
    allowed.push("*");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!allowed.some((pattern) => pattern === "*" || (pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern))) {
    throw new ProxyError(403, "host_not_allowed", "Source host is not in ALLOWED_HOSTS");
  }
  return url;
}
var DEFAULT_WEB_ORIGIN = "https://mohammadrezaamani.github.io";
var LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origin === "null")
    return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin.toLowerCase() !== origin.toLowerCase())
    return null;
  const list = entries(env.ALLOWED_ORIGINS);
  if (list.includes("*") || origin.toLowerCase() === DEFAULT_WEB_ORIGIN || LOCAL_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase()) || list.includes(origin.toLowerCase()))
    return origin;
  return null;
}
function assertOrigin(request, env) {
  if (request.headers.has("Origin") && !allowedOrigin(request, env))
    throw new ProxyError(403, "origin_not_allowed", "Browser origin is not allowed");
}
function assertToken(token, env) {
  const expected = env.PROXY_TOKEN?.trim() || "";
  if (!expected)
    return;
  const candidate = token || "";
  let mismatch = candidate.length ^ expected.length;
  const length = Math.max(candidate.length, expected.length);
  for (let i = 0;i < length; i++)
    mismatch |= (candidate.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (mismatch !== 0)
    throw new ProxyError(401, "unauthorized", "Invalid proxy access token");
}
function corsHeaders(request, env) {
  const h = new Headers({
    Vary: "Origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'"
  });
  const origin = allowedOrigin(request, env);
  if (origin)
    h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Range, If-Range, Accept, Content-Type, Authorization, X-YouTV-Admin-Token, X-YouTube-Client-Name, X-YouTube-Client-Version, X-Goog-Visitor-Id, X-Goog-Api-Format-Version");
  h.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Content-Disposition, Accept-Ranges, ETag, Last-Modified, Retry-After, X-YouTV-Proxy, X-YouTV-Source-URL, X-YouTV-Upstream-Status, X-YouTV-HLS-Result");
  h.set("Access-Control-Max-Age", "3600");
  return h;
}

// apps/worker/src/hls.ts
var VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
var VARIABLE_PATTERN = /\{\$([A-Za-z_][A-Za-z0-9_-]{0,63})\}/g;
var MAX_VARIABLES = 32;
var MAX_VARIABLE_BYTES = 3072;
var MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
var URI_ATTRIBUTES = {
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
  "EXT-X-INTERSTITIAL": ["URI"]
};
var PLAYLIST_URI_TAGS = new Set([
  "EXT-X-MEDIA",
  "EXT-X-I-FRAME-STREAM-INF",
  "EXT-X-IMAGE-STREAM-INF",
  "EXT-X-RENDITION-REPORT"
]);
var SAFE_INLINE_TAGS = new Set([
  "EXT-X-KEY",
  "EXT-X-SESSION-KEY",
  "EXT-X-SESSION-DATA"
]);
var INLINE_MEDIA_TAGS = new Set([
  "EXT-X-MAP",
  "EXT-X-PART",
  "EXT-X-PRELOAD-HINT",
  "EXT-X-PREFETCH",
  "EXT-X-MEDIA",
  "EXT-X-I-FRAME-STREAM-INF",
  "EXT-X-IMAGE-STREAM-INF"
]);
function attributeParts(value) {
  const parts = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0;i < value.length; i++) {
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
function attribute(part) {
  const eq = part.indexOf("=");
  if (eq < 1)
    return null;
  const name = part.slice(0, eq).trim().toUpperCase();
  const raw = part.slice(eq + 1).trim();
  const quoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2;
  return {
    name,
    value: quoted ? raw.slice(1, -1).replace(/\\"/g, '"') : raw,
    quoted
  };
}
function attributes(value) {
  const result = new Map;
  for (const part of attributeParts(value)) {
    const item = attribute(part);
    if (item)
      result.set(item.name, item.value);
  }
  return result;
}
function safeVariables(vars) {
  if (!vars || typeof vars !== "object" || Array.isArray(vars))
    throw new Error("Invalid HLS variable map");
  const result = Object.create(null);
  for (const [name, value] of Object.entries(vars)) {
    if (!VARIABLE_NAME.test(name) || typeof value !== "string" || value.length > 1024)
      throw new Error("Invalid HLS variable definition");
    result[name] = value;
    if (Object.keys(result).length > MAX_VARIABLES || JSON.stringify(result).length > MAX_VARIABLE_BYTES)
      throw new Error("Too many HLS variables");
  }
  return result;
}
function parseHlsVariables(raw) {
  if (!raw)
    return Object.create(null);
  if (raw.length > MAX_VARIABLE_BYTES * 3)
    throw new Error("HLS variables are too large");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid HLS variables");
  }
  return safeVariables(value);
}
function substitute(value, vars) {
  let result = value;
  for (let i = 0;i < 8; i++) {
    let replaced = false;
    result = result.replace(VARIABLE_PATTERN, (_match, name) => {
      if (!Object.hasOwn(vars, name))
        throw new Error(`Undefined HLS variable: ${name}`);
      replaced = true;
      return vars[name];
    });
    if (!replaced)
      return result;
  }
  if (result.includes("{$"))
    throw new Error("Recursive HLS variable definition");
  return result;
}
function resourceUrl(uri, source, tag, attributeName) {
  const input = uri.trim();
  let resolved;
  try {
    resolved = new URL(input, source);
  } catch {
    throw new Error("Invalid HLS URI");
  }
  const inlineMedia = tag === "" && attributeName === "" || INLINE_MEDIA_TAGS.has(tag) && (attributeName === "URI" || tag === "EXT-X-PREFETCH" && attributeName === "");
  if (resolved.protocol === "data:" && (SAFE_INLINE_TAGS.has(tag) && input.length <= 2048 || inlineMedia && input.length <= MAX_MANIFEST_BYTES))
    return null;
  if ((resolved.protocol === "skd:" || resolved.protocol === "urn:") && (tag === "EXT-X-KEY" || tag === "EXT-X-SESSION-KEY") && attributeName === "URI")
    return null;
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
    throw new Error(`Unsupported HLS URI scheme: ${resolved.protocol}`);
  if (resolved.username || resolved.password)
    throw new Error("Credentials in HLS URI are forbidden");
  return resolved;
}
function normalizeDirective(line) {
  const trimmed = line.replace(/^\s*\uFEFF/, "").trim();
  if (/^#?EXTM3U(?:\s|:|$)/i.test(trimmed))
    return "#EXTM3U";
  const match = /^#?(EXTM3U|EXTINF|EXT-X-[A-Z0-9-]+)(?::(.*))?$/i.exec(trimmed);
  if (!match)
    return line;
  return `#${match[1].toUpperCase()}${match[2] === undefined ? "" : `:${match[2]}`}`;
}
function hasHlsSyntax(text) {
  for (const line of text.replace(/\uFEFF/g, "").split(/\r\n|\n|\r/)) {
    const value = normalizeDirective(line).trim();
    if (!value)
      continue;
    if (value === "#EXTM3U" || /^#(?:EXTINF:|EXT-X-[A-Z0-9-]+(?::|$))/.test(value))
      return true;
    if (value.startsWith("#") && !/^#EXT/i.test(value))
      continue;
    return false;
  }
  return false;
}
function rewriteHls(manifest, sourceUrl, proxyUrl, token, hints, inherited = {}) {
  if (new TextEncoder().encode(manifest).byteLength > MAX_MANIFEST_BYTES)
    throw new Error("HLS manifest too large");
  const source = manifest.replace(/^[\s\uFEFF]+/, "");
  if (!hasHlsSyntax(source))
    throw new Error("Response is not an HLS playlist (#EXTM3U missing)");
  const originalLines = source.split(/\r\n|\n|\r/);
  const header = originalLines.findIndex((line) => normalizeDirective(line).trim() === "#EXTM3U");
  if (header >= 0)
    originalLines.splice(header, 1);
  originalLines.unshift("#EXTM3U");
  const parent = safeVariables(inherited);
  const vars = Object.create(null);
  const newline = manifest.includes(`\r
`) ? `\r
` : `
`;
  const rewriteUrl = (raw, tag, attrName = "", isPlaylist = false) => {
    const expanded = substitute(raw, vars);
    const resolved = resourceUrl(expanded, sourceUrl, tag, attrName);
    if (!resolved)
      return expanded;
    const out = new URL(proxyUrl);
    out.searchParams.set("url", resolved.toString());
    if (token)
      out.searchParams.set("key", token);
    if (hints?.userAgent)
      out.searchParams.set("ua", hints.userAgent);
    if (hints?.referer)
      out.searchParams.set("ref", hints.referer);
    if (tag === "EXT-X-CONTENT-STEERING")
      out.searchParams.set("steer", "1");
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
    if (!trimmed)
      return original;
    if (!trimmed.startsWith("#")) {
      const isPlaylist = pendingPlaylistUri || /\.m3u8?(?:[?#]|$)/i.test(trimmed);
      pendingPlaylistUri = false;
      const uri = rewriteUrl(trimmed, "", "", isPlaylist);
      return normalized.replace(trimmed, () => uri);
    }
    if (trimmed.startsWith("#EXT-X-STREAM-INF:"))
      pendingPlaylistUri = true;
    if (trimmed.startsWith("#EXTM3U"))
      return normalized;
    const tagged = /^#([A-Z0-9-]+)(?::(.*))?$/i.exec(trimmed);
    if (!tagged)
      return normalized;
    const tag = tagged[1].toUpperCase();
    const parameter = tagged[2] ?? "";
    if (tag === "EXT-X-DEFINE") {
      const defs = attributes(parameter);
      const importName = defs.get("IMPORT");
      const declaredName = defs.get("NAME");
      const queryName = defs.get("QUERYPARAM");
      const name = declaredName || importName || queryName;
      if (!name || !VARIABLE_NAME.test(name))
        throw new Error("Invalid EXT-X-DEFINE variable name");
      let value;
      if (importName)
        value = parent[importName];
      else if (queryName)
        value = sourceUrl.searchParams.get(queryName) ?? undefined;
      else
        value = defs.get("VALUE");
      if (value === undefined)
        throw new Error(`Missing HLS variable: ${name}`);
      if (!Object.hasOwn(vars, name) && Object.keys(vars).length >= MAX_VARIABLES)
        throw new Error("Too many HLS variables");
      vars[name] = value;
      safeVariables(vars);
      if (queryName) {
        const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
        return normalized.replace(trimmed, `#EXT-X-DEFINE:NAME="${name}",VALUE="${escapedValue}"`);
      }
      return normalized;
    }
    if (tag === "EXT-X-PREFETCH") {
      const uri = rewriteUrl(parameter.trim(), tag);
      return normalized.replace(parameter, () => uri);
    }
    const names = URI_ATTRIBUTES[tag];
    if (!names || !parameter)
      return normalized;
    const parts = attributeParts(parameter);
    const kind = attributes(parameter).get("TYPE") || "";
    const rewritten = parts.map((part) => {
      const attr = attribute(part);
      if (!attr || !names.includes(attr.name))
        return part;
      const playlist = PLAYLIST_URI_TAGS.has(tag) && (tag !== "EXT-X-MEDIA" || kind !== "SUBTITLES" || /\.m3u8?(?:[?#]|$)/i.test(attr.value)) || tag === "EXT-X-DATERANGE" && attr.name === "X-ASSET-URI";
      const uri = rewriteUrl(attr.value, tag, attr.name, playlist);
      const value = attr.quoted ? `"${uri.replace(/"/g, "\\\"")}"` : uri;
      return part.replace(/^\s*[^=]+\s*=\s*.*$/, `${attr.name}=${value}`);
    });
    const next = `${trimmed.slice(0, trimmed.indexOf(":") + 1)}${rewritten.join(",")}`;
    return normalized.replace(trimmed, () => next);
  });
  return output.join(newline);
}
function parseSteeringReplacement(raw) {
  if (!raw)
    return null;
  if (raw.length > 3000)
    throw new Error("Steering replacement too large");
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Invalid steering replacement");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new Error("Invalid steering replacement");
  const data = obj;
  if (data.host !== undefined && (typeof data.host !== "string" || data.host.length > 255 || !/^[A-Za-z0-9.-]+$/.test(data.host)))
    throw new Error("Invalid steering host");
  if (data.pathPrefix !== undefined && (typeof data.pathPrefix !== "string" || data.pathPrefix.length > 512 || !data.pathPrefix.startsWith("/") || /[?#\\]/.test(data.pathPrefix)))
    throw new Error("Invalid steering path prefix");
  if (data.params !== undefined) {
    if (typeof data.params !== "object" || !data.params || Array.isArray(data.params) || Object.keys(data.params).length > 16)
      throw new Error("Invalid steering parameters");
    for (const [k, v] of Object.entries(data.params)) {
      if (!/^[A-Za-z0-9_.~-]{1,64}$/.test(k) || typeof v !== "string" || v.length > 512)
        throw new Error("Invalid steering parameter");
    }
  }
  return data;
}
function applySteeringReplacement(upstream, replacement) {
  if (!replacement)
    return upstream;
  const result = new URL(upstream);
  if (replacement.host)
    result.hostname = replacement.host;
  if (replacement.pathPrefix)
    result.pathname = replacement.pathPrefix.replace(/\/$/, "") + "/" + result.pathname.replace(/^\//, "");
  for (const [name, value] of Object.entries(replacement.params || {}))
    result.searchParams.set(name, value);
  return result;
}
function rewriteSteeringJson(text, upstream, proxy, token, hints = {}) {
  if (text.length > 512000)
    throw new Error("Steering manifest too large");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid Content Steering JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid Content Steering JSON");
  const steering = parsed;
  if (typeof steering["RELOAD-URI"] === "string") {
    const target = resourceUrl(steering["RELOAD-URI"], upstream, "EXT-X-CONTENT-STEERING", "SERVER-URI");
    if (!target)
      throw new Error("Invalid steering reload URL");
    const reload = new URL(proxy);
    reload.searchParams.set("url", target.href);
    reload.searchParams.set("steer", "1");
    if (token)
      reload.searchParams.set("key", token);
    if (hints.userAgent)
      reload.searchParams.set("ua", hints.userAgent);
    if (hints.referer)
      reload.searchParams.set("ref", hints.referer);
    steering["RELOAD-URI"] = reload.href;
  }
  if (Array.isArray(steering["PATHWAY-CLONES"])) {
    steering["PATHWAY-CLONES"] = steering["PATHWAY-CLONES"].map((unknownClone) => {
      if (!unknownClone || typeof unknownClone !== "object" || Array.isArray(unknownClone))
        return unknownClone;
      const clone = { ...unknownClone };
      const original = clone["URI-REPLACEMENT"];
      if (!original || typeof original !== "object" || Array.isArray(original))
        return clone;
      const value = original;
      const translated = {};
      if (typeof value.HOST === "string")
        translated.host = value.HOST;
      if (typeof value["PATH-PREFIX"] === "string")
        translated.pathPrefix = value["PATH-PREFIX"];
      if (value.PARAMS && typeof value.PARAMS === "object" && !Array.isArray(value.PARAMS))
        translated.params = value.PARAMS;
      parseSteeringReplacement(JSON.stringify(translated));
      clone["URI-REPLACEMENT"] = {
        PARAMS: { _youtv_steer: JSON.stringify(translated) }
      };
      return clone;
    });
  }
  return JSON.stringify(steering);
}
function rewriteInterstitialAssetList(text, upstream, proxy, token, hints = {}) {
  if (text.length > 512000)
    throw new Error("HLS asset list too large");
  let object;
  try {
    object = JSON.parse(text);
  } catch {
    throw new Error("Invalid HLS asset list JSON");
  }
  if (!object || typeof object !== "object" || Array.isArray(object))
    throw new Error("Invalid HLS asset list JSON");
  const list = object;
  if (!Array.isArray(list.ASSETS))
    throw new Error("Missing HLS interstitial ASSETS");
  list.ASSETS = list.ASSETS.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return item;
    const asset = { ...item };
    if (typeof asset.URI !== "string")
      return asset;
    const resolved = resourceUrl(asset.URI, upstream, "EXT-X-DATERANGE", "X-ASSET-URI");
    if (!resolved)
      throw new Error("Invalid interstitial asset URL");
    const target = new URL(proxy);
    target.searchParams.set("url", resolved.href);
    target.searchParams.set("hls", "1");
    if (token)
      target.searchParams.set("key", token);
    if (hints.userAgent)
      target.searchParams.set("ua", hints.userAgent);
    if (hints.referer)
      target.searchParams.set("ref", hints.referer);
    asset.URI = target.href;
    return asset;
  });
  return JSON.stringify(list);
}
function isHls(url, contentType) {
  const path = url.pathname.toLowerCase();
  const mime = contentType.toLowerCase().split(";")[0]?.trim() || "";
  return path.endsWith(".m3u8") || path.endsWith(".m3u") || [
    "application/vnd.apple.mpegurl",
    "application/x-mpegurl",
    "audio/mpegurl",
    "audio/x-mpegurl"
  ].includes(mime);
}
async function readTextStream(body, maxBytes = MAX_MANIFEST_BYTES) {
  if (!body)
    return "";
  const reader = body.getReader();
  const decoder = new TextDecoder;
  let text = "", bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error("HLS manifest too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {
      return;
    });
  }
}

// apps/worker/src/cloudflare.ts
function validateName(value) {
  if (!value || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))
    throw new ProxyError(400, "invalid_script", "Invalid Worker script name");
  return value;
}
function validateAccount(value) {
  if (!value || !/^[a-f0-9]{32}$/i.test(value))
    throw new ProxyError(400, "invalid_account", "Account ID must be a 32-character hexadecimal ID");
  return value;
}
function equalsToken(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0;i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function cloudflareAdmin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigin(request, env) || (env.ALLOWED_ORIGINS || "").split(",").some((x) => x.trim() === "*"))
    throw new ProxyError(403, "admin_origin", "Use the built-in YouTV origin or an explicitly allowed origin; wildcard admin origins are forbidden");
  const adminSecret = env.ADMIN_TOKEN || "";
  const candidate = request.headers.get("X-YouTV-Admin-Token") || "";
  if (adminSecret.length < 32 || !equalsToken(candidate, adminSecret) || equalsToken(adminSecret, env.PROXY_TOKEN || ""))
    throw new ProxyError(401, "admin_unauthorized", "Admin authorization failed");
  const cfToken = request.headers.get("Authorization")?.match(/^Bearer\s+([\w.-]{20,})$/)?.[1];
  if (!cfToken)
    throw new ProxyError(401, "cloudflare_token_missing", "A scoped Cloudflare API Token is required");
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 4000)
    throw new ProxyError(413, "admin_request_too_large", "Admin request too large");
  let body;
  try {
    const data = await request.text();
    if (data.length > 4000)
      throw new ProxyError(413, "admin_request_too_large", "Admin request too large");
    body = JSON.parse(data);
    if (!body || typeof body !== "object")
      throw Error("Body must be an object");
  } catch (error) {
    if (error instanceof ProxyError)
      throw error;
    throw new ProxyError(400, "invalid_json", "Invalid admin JSON");
  }
  const { operation } = body;
  let path, method = "GET", data;
  if (operation === "verify") {
    path = "/user/tokens/verify";
  } else {
    const account = validateAccount(body.accountId);
    const root = `/accounts/${account}/workers/scripts`;
    switch (operation) {
      case "list":
        path = root;
        break;
      case "getSubdomain":
        path = `${root}/${encodeURIComponent(validateName(body.scriptName))}/subdomain`;
        break;
      case "getSettings":
        path = `${root}/${encodeURIComponent(validateName(body.scriptName))}/settings`;
        break;
      case "setSecret": {
        if (body.secretName !== "PROXY_TOKEN" && body.secretName !== "ADMIN_TOKEN")
          throw new ProxyError(400, "invalid_secret_name", "Only YouTV PROXY_TOKEN and ADMIN_TOKEN can be changed");
        const min = body.secretName === "ADMIN_TOKEN" ? 32 : 24;
        if (typeof body.secretValue !== "string" || body.secretValue.length < min || body.secretValue.length > 256)
          throw new ProxyError(400, "invalid_secret_value", `Secret must be ${min}-256 characters`);
        if (equalsToken(body.secretValue, env.ADMIN_TOKEN || "") && body.secretName === "PROXY_TOKEN")
          throw new ProxyError(400, "same_secret", "PROXY_TOKEN must be different from ADMIN_TOKEN");
        if (equalsToken(body.secretValue, env.PROXY_TOKEN || "") && body.secretName === "ADMIN_TOKEN")
          throw new ProxyError(400, "same_secret", "ADMIN_TOKEN must be different from PROXY_TOKEN");
        path = `${root}/${encodeURIComponent(validateName(body.scriptName))}/secrets`;
        method = "PUT";
        data = {
          name: body.secretName,
          type: "secret_text",
          text: body.secretValue
        };
        break;
      }
      case "setSubdomain":
        if (typeof body.enabled !== "boolean")
          throw new ProxyError(400, "invalid_enabled", "enabled must be boolean");
        path = `${root}/${encodeURIComponent(validateName(body.scriptName))}/subdomain`;
        method = "POST";
        data = { enabled: body.enabled };
        break;
      default:
        throw new ProxyError(400, "invalid_operation", "Operation not allowed");
    }
  }
  const timeout = AbortSignal.timeout(12000);
  let response;
  try {
    response = await fetch("https://api.cloudflare.com/client/v4" + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfToken}`,
        Accept: "application/json",
        ...data ? { "Content-Type": "application/json" } : {}
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: timeout,
      redirect: "error"
    });
  } catch {
    throw new ProxyError(502, "cloudflare_unreachable", "Cloudflare API could not be reached");
  }
  const responseText = (await response.text()).slice(0, 600000);
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new ProxyError(502, "cloudflare_invalid_response", "Unexpected Cloudflare API response");
  }
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  });
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  if (operation === "setSecret") {
    const serialized = JSON.stringify(result);
    result = JSON.parse(serialized.replaceAll(body.secretValue || "", "[REDACTED]"));
  }
  return new Response(JSON.stringify(result), {
    status: response.ok ? 200 : response.status,
    headers
  });
}

// apps/worker/src/dash.ts
function isDash(url, contentType = "") {
  return url.pathname.toLowerCase().endsWith(".mpd") || contentType.toLowerCase().split(";")[0]?.trim() === "application/dash+xml";
}
function xmlDecode(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const names = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'"
    };
    if (names[entity] !== undefined)
      return names[entity];
    const code = entity.startsWith("&#x") ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isInteger(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : entity;
  });
}
function xmlEscape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function resolveResource(raw, source) {
  const resolved = new URL(xmlDecode(raw.trim()), source);
  if (!["http:", "https:"].includes(resolved.protocol) || resolved.username || resolved.password)
    throw new Error("Unsupported DASH resource URL");
  return resolved;
}
function encodeContext(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeContext(value) {
  if (!/^[A-Za-z0-9_-]{1,16384}$/.test(value))
    throw new Error("Malformed DASH context");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
  if (typeof data.origin !== "string" || typeof data.query !== "string" || typeof data.key !== "string")
    throw new Error("Malformed DASH context");
  const origin = new URL(data.origin);
  if (origin.origin !== data.origin || !["http:", "https:"].includes(origin.protocol))
    throw new Error("Invalid DASH origin");
  return data;
}
function relayUrl(resolved, workerBase, token, inheritQuery) {
  const context = encodeContext({
    origin: resolved.origin,
    query: inheritQuery ? resolved.search : "",
    key: token
  });
  const result = new URL(`/dash-base/v1/${context}${resolved.pathname}`, workerBase);
  if (!inheritQuery)
    result.search = resolved.search;
  return result.toString().replace(/%24/gi, "$");
}
function proxyResource(raw, source, workerBase, token) {
  return xmlEscape(relayUrl(resolveResource(raw, source), workerBase, token, false));
}
function rewriteDash(mpd, source, workerBase, token = "") {
  if (new TextEncoder().encode(mpd).byteLength > 8 * 1024 * 1024)
    throw new Error("DASH manifest too large");
  if (!/^\s*(?:\uFEFF)?\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/i.test(mpd))
    throw new Error("Response is not an MPEG-DASH MPD manifest");
  if (/<!DOCTYPE|<!ENTITY/i.test(mpd))
    throw new Error("DASH XML declarations with entities are not supported");
  const stack = [];
  let rootOpenEnd = 0, rootHasBase = false;
  const tokens = /<(?:[\w.-]+:)?BaseURL(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?BaseURL\s*>|<(?:[\w.-]+:)?Location(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?Location\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[\w.:-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  let output = "", last = 0;
  for (const match of mpd.matchAll(tokens)) {
    const raw = match[0], offset = match.index;
    output += mpd.slice(last, offset);
    last = offset + raw.length;
    const nameMatch = raw.match(/^<(\/?)([\w.:-]+)/);
    if (!nameMatch) {
      output += raw;
      continue;
    }
    const full = nameMatch[2], name = full.split(":").at(-1), scope = stack.at(-1), base = scope?.base || source;
    if (nameMatch[1]) {
      stack.pop();
      output += raw;
      continue;
    }
    if (name === "BaseURL") {
      const parts = raw.match(/^(<[^>]+>)([^<]*)(<\/[^>]+>)$/s);
      if (!parts)
        throw new Error("Invalid DASH BaseURL");
      const resolved = resolveResource(parts[2], scope?.inherited || source);
      if (scope && !scope.hasBase) {
        scope.base = resolved;
        scope.hasBase = true;
        if (scope.name === "MPD")
          rootHasBase = true;
      }
      output += parts[1] + xmlEscape(relayUrl(resolved, workerBase, token, true)) + parts[3];
      continue;
    }
    if (name === "Location") {
      const parts = raw.match(/^(<[^>]+>)([^<]*)(<\/[^>]+>)$/s);
      if (!parts)
        throw new Error("Invalid DASH Location");
      output += parts[1] + proxyResource(parts[2], source, workerBase, token) + parts[3];
      continue;
    }
    let rewritten = raw;
    if (name === "UTCTiming" && /\bschemeIdUri=["'][^"']*http/i.test(raw))
      rewritten = rewritten.replace(/(\bvalue\s*=\s*)(["'])([^"']+)\2/i, (_m, p, q, v) => `${p}${q}${proxyResource(v, source, workerBase, token)}${q}`);
    if ([
      "SegmentTemplate",
      "SegmentURL",
      "Initialization",
      "RepresentationIndex",
      "BitstreamSwitching"
    ].includes(name))
      rewritten = rewritten.replace(/(\b(?:media|initialization|sourceURL|index)\s*=\s*)(["'])([^"']+)\2/gi, (_m, p, q, v) => {
        if (!/^(?:https?:|\/)/i.test(xmlDecode(v)))
          return _m;
        return `${p}${q}${proxyResource(v, base, workerBase, token)}${q}`;
      });
    output += rewritten;
    if (name === "MPD")
      rootOpenEnd = output.length;
    if (!/\/\s*>$/.test(raw))
      stack.push({
        name,
        prefix: full.includes(":") ? full.split(":")[0] + ":" : "",
        inherited: base,
        base,
        hasBase: false
      });
  }
  output += mpd.slice(last);
  if (!rootHasBase && rootOpenEnd) {
    const prefix = mpd.match(/<(?:([\w.-]+):)?MPD\b/)?.[1];
    const tag = prefix ? `${prefix}:BaseURL` : "BaseURL";
    const rootBase = xmlEscape(relayUrl(new URL(".", source), workerBase, token, true));
    output = output.slice(0, rootOpenEnd) + `<${tag}>${rootBase}</${tag}>` + output.slice(rootOpenEnd);
  }
  return output;
}
function dashRequestToken(requestUrl) {
  if (!requestUrl.pathname.startsWith("/dash-base/v1/"))
    return requestUrl.searchParams.get("key");
  try {
    return decodeContext(requestUrl.pathname.split("/")[3] || "").key;
  } catch {
    if (requestUrl.searchParams.has("base"))
      return requestUrl.searchParams.get("key");
    throw new ProxyError(400, "invalid_dash_context", "Invalid DASH relay context");
  }
}
function dashBaseTarget(requestUrl, env) {
  if (requestUrl.pathname.startsWith("/dash-base/v1/")) {
    const parts = requestUrl.pathname.split("/");
    let context;
    try {
      context = decodeContext(parts[3] || "");
    } catch {
      if (!requestUrl.searchParams.has("base"))
        throw new ProxyError(400, "invalid_dash_context", "Invalid DASH relay context");
      context = null;
    }
    if (context) {
      const target = new URL(context.origin);
      target.pathname = "/" + parts.slice(4).join("/");
      target.search = requestUrl.search || context.query;
      return assertAllowedUrl(target.toString(), env);
    }
  }
  const rawBase = requestUrl.searchParams.get("base");
  if (!rawBase)
    throw new ProxyError(400, "dash_base_missing", "DASH BaseURL is missing");
  const base = assertAllowedUrl(rawBase, env);
  const suffix = requestUrl.pathname.slice("/dash-base/".length);
  const target = suffix ? new URL("./" + suffix, base) : base;
  base.searchParams.forEach((value, key) => {
    if (!target.searchParams.has(key))
      target.searchParams.set(key, value);
  });
  return assertAllowedUrl(target.toString(), env);
}

// apps/worker/src/index.ts
var MAX_REDIRECTS = 4;
var MAX_SOURCE_REDIRECTS = 10;
var VERSION = "0.36.1";
var PROXY_USER_AGENT = `YouTV/${VERSION} (https://github.com/MohammadrezaAmani/youtv/issues)`;
function isWikimediaMediaHost(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return host === "upload.wikimedia.org" || host === "thumb.wikimedia.org";
}
function json(request, env, value, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}
function sniffMediaKind(url, contentType, prefix = new Uint8Array) {
  const mime = contentType.toLowerCase().split(";")[0]?.trim() || "";
  if (isHls(url, mime))
    return "hls";
  if (isDash(url, mime))
    return "dash";
  if (mime.startsWith("video/") || [
    "application/x-matroska",
    "application/x-msvideo",
    "application/x-shockwave-flash",
    "application/vnd.rn-realmedia",
    "application/vnd.ms-asf"
  ].includes(mime))
    return "video";
  if (mime.startsWith("audio/") || ["application/x-flac", "application/x-aiff", "application/x-wav"].includes(mime))
    return "audio";
  if (mime.startsWith("image/"))
    return "image";
  if (mime === "application/pdf" || prefix[0] === 37 && prefix[1] === 80 && prefix[2] === 68 && prefix[3] === 70)
    return "document";
  if (prefix[0] === 137 && prefix[1] === 80 && prefix[2] === 78 && prefix[3] === 71 || prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 || prefix[0] === 71 && prefix[1] === 73 && prefix[2] === 70)
    return "image";
  if (prefix[0] === 82 && prefix[1] === 73 && prefix[2] === 70 && prefix[3] === 70 && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP")
    return "image";
  const text = new TextDecoder().decode(prefix).replace(/^\uFEFF/, "").trimStart();
  if (/^#EXTM3U(?:\s|$)/i.test(text))
    return "hls";
  if (/^(?:<\?xml[^>]*>\s*)?<MPD(?:\s|>)/i.test(text) || /<MPD(?:\s|>)/i.test(text.slice(0, 4096)))
    return "dash";
  if (prefix.length >= 12) {
    if (String.fromCharCode(...prefix.slice(4, 8)) === "ftyp") {
      const brand = String.fromCharCode(...prefix.slice(8, 12));
      return /^(?:M4A|M4B|M4P)/.test(brand) ? "audio" : "video";
    }
    if (prefix[0] === 26 && prefix[1] === 69 && prefix[2] === 223 && prefix[3] === 163)
      return "video";
    if (String.fromCharCode(...prefix.slice(0, 3)) === "FLV")
      return "video";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" && String.fromCharCode(...prefix.slice(8, 12)) === "AVI ")
      return "video";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "fLaC" || String.fromCharCode(...prefix.slice(0, 3)) === "ID3")
      return "audio";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" && String.fromCharCode(...prefix.slice(8, 12)) === "WAVE")
      return "audio";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" && String.fromCharCode(...prefix.slice(8, 12)) === "WEBP")
      return "image";
    if (prefix[0] === 255 && (prefix[1] & 224) === 224)
      return "audio";
    if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
      return "image";
    if (prefix[0] === 137 && String.fromCharCode(...prefix.slice(1, 4)) === "PNG")
      return "image";
    if (String.fromCharCode(...prefix.slice(0, 4)) === "GIF8")
      return "image";
  }
  return "file";
}
function safeFilename(value) {
  const cleaned = value.normalize("NFKC").replace(/[\/\\\u0000-\u001f\u007f<>:\"|?*]/g, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 180);
  return cleaned || "download.bin";
}
function upstreamFilename(disposition) {
  if (!disposition)
    return "";
  const extended = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]?.trim();
  if (extended) {
    try {
      return decodeURIComponent(extended.replace(/^\"|\"$/g, ""));
    } catch {}
  }
  const quoted = disposition.match(/filename\s*=\s*\"([^\"]*)\"/i)?.[1];
  if (quoted)
    return quoted;
  return disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim().replace(/^\"|\"$/g, "") || "";
}
async function peekStream(body, limit = 4096) {
  if (!body)
    return { prefix: new Uint8Array(new ArrayBuffer(0)), body: null };
  const reader = body.getReader();
  const copyChunk = (value) => {
    if (value.buffer instanceof ArrayBuffer)
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
    copy.set(value);
    return copy;
  };
  const chunks = [];
  let total = 0, finished = false;
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
    if (offset === prefix.length)
      break;
  }
  let index = 0, released = false;
  const release = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  const stream = new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
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
        } else if (item.value)
          controller.enqueue(copyChunk(item.value));
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
    }
  });
  return { prefix, body: stream };
}
function setDownloadDisposition(headers, requestUrl, response, finalUrl) {
  const requested = requestUrl.searchParams.get("filename") || "";
  let pathName = finalUrl.pathname.split("/").filter(Boolean).at(-1) || "download.bin";
  try {
    pathName = decodeURIComponent(pathName);
  } catch {}
  const name = safeFilename(requested || upstreamFilename(response.headers.get("Content-Disposition")) || pathName);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/[\"\\;]/g, "_");
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  headers.set("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
}
var YOUTUBE_REQUEST_HEADERS = new Set([
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
  "x-youtube-identity-token"
]);
function isYoutubeRelayTarget(url) {
  const host = url.hostname.toLowerCase();
  const videoHost = host === "googlevideo.com" || host.endsWith(".googlevideo.com");
  const hostAllowed = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtubei.googleapis.com" || videoHost;
  const pathAllowed = videoHost ? url.pathname === "/videoplayback" : url.pathname.startsWith("/youtubei/v1/") || url.pathname.startsWith("/s/player/") || url.pathname === "/" || url.pathname === "/sw.js_data" || url.pathname === "/api/timedtext" || url.pathname === "/iframe_api" || url.pathname === "/watch" || url.pathname === "/playlist" || url.pathname.startsWith("/embed/");
  return hostAllowed && pathAllowed;
}
function isInstagramRelayTarget(url) {
  const host = url.hostname.toLowerCase();
  if (!(host === "instagram.com" || host.endsWith(".instagram.com")))
    return false;
  return /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/embed\/?$/.test(url.pathname);
}
async function platformRelay(request, env, requestUrl, platform) {
  assertToken(requestUrl.searchParams.get("key"), env);
  const raw = requestUrl.searchParams.get("url");
  if (!raw)
    throw new ProxyError(400, "missing_url", "url query parameter is required");
  if (!["GET", "HEAD", "POST"].includes(request.method))
    throw new ProxyError(405, "method_not_allowed", "GET/HEAD/POST only");
  let current = assertAllowedUrl(raw, env);
  const permitted = platform === "youtube" ? isYoutubeRelayTarget : isInstagramRelayTarget;
  if (!permitted(current))
    throw new ProxyError(403, "platform_url_not_allowed", `URL is not an allowed ${platform} endpoint`);
  let body;
  if (request.method === "POST") {
    const declared = Number(request.headers.get("content-length") || "0");
    if (declared > 1500000)
      throw new ProxyError(413, "platform_request_too_large", "Platform request body exceeds 1.5 MB");
    body = await request.arrayBuffer();
    if (body.byteLength > 1500000)
      throw new ProxyError(413, "platform_request_too_large", "Platform request body exceeds 1.5 MB");
  }
  let response;
  let method = request.method;
  for (let attempt = 0;attempt <= MAX_REDIRECTS; attempt++) {
    current = assertAllowedUrl(current.toString(), env);
    if (!permitted(current))
      throw new ProxyError(403, "platform_redirect_blocked", "Platform redirect left the permitted endpoint set");
    const headers = new Headers;
    if (platform === "youtube") {
      request.headers.forEach((value, name) => {
        if (YOUTUBE_REQUEST_HEADERS.has(name.toLowerCase()))
          headers.set(name, value);
      });
      headers.set("Origin", "https://www.youtube.com");
      headers.set("Referer", "https://www.youtube.com/");
      headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
    } else {
      headers.set("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
      headers.set("Accept-Language", "en-US,en;q=0.9");
      headers.set("Referer", "https://www.instagram.com/");
      headers.set("X-IG-App-ID", "936619743392459");
      headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
    }
    response = await fetch(current.toString(), {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      redirect: "manual",
      signal: request.signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      break;
    const location = response.headers.get("Location");
    if (!location)
      throw new ProxyError(502, "bad_redirect", "Platform redirect lacks Location");
    const next = assertAllowedUrl(new URL(location, current).toString(), env);
    if (!permitted(next))
      throw new ProxyError(403, "platform_redirect_blocked", "Platform redirect left the permitted endpoint set");
    if (response.status === 303 || (response.status === 301 || response.status === 302) && method === "POST") {
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
    "Cache-Control"
  ];
  if (current.hostname === "googlevideo.com" || current.hostname.endsWith(".googlevideo.com"))
    responseHeaders.push("Content-Length");
  for (const name of responseHeaders) {
    const value = response.headers.get(name);
    if (value)
      headers.set(name, value);
  }
  headers.set("Cache-Control", "no-store");
  headers.set("X-YouTV-Proxy", VERSION);
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
function deliveryDirectives(query) {
  const result = new URLSearchParams;
  for (const name of ["_HLS_msn", "_HLS_part", "_HLS_skip"]) {
    const value = query.get(name);
    if (value === null)
      continue;
    const valid = name === "_HLS_skip" ? /^(?:YES|v2)$/i.test(value) : /^\d{1,15}$/.test(value);
    if (!valid)
      throw new ProxyError(400, "invalid_hls_directive", `Invalid ${name} delivery directive`);
    result.set(name, value);
  }
  if (result.has("_HLS_part") && !result.has("_HLS_msn"))
    throw new ProxyError(400, "invalid_hls_directive", "_HLS_part requires _HLS_msn");
  return result;
}
async function fetchSource(url, request, env, directives = new URLSearchParams) {
  let current = url;
  const expectsHls = new URL(request.url).searchParams.get("hls") === "1" || isHls(url, "");
  for (let i = 0;i <= MAX_SOURCE_REDIRECTS; i++) {
    current = assertAllowedUrl(current.toString(), env);
    directives.forEach((value, name) => current.searchParams.set(name, value));
    const headers = new Headers;
    for (const key of ["Range", "If-Range", "Accept", "Accept-Language"]) {
      const v = request.headers.get(key);
      if (v)
        headers.set(key, v);
    }
    if ((expectsHls || isHls(current, "")) && !headers.has("Range"))
      headers.set("Accept", "application/vnd.apple.mpegurl, application/x-mpegURL, audio/mpegurl, */*;q=0.8");
    const query = new URL(request.url).searchParams;
    const agent = query.get("ua") || "";
    const referer = query.get("ref") || env.UPSTREAM_REFERER || "";
    if (agent.length > 512 || /[\r\n\x00-\x1f]/.test(agent))
      throw new ProxyError(400, "invalid_user_agent", "Invalid User-Agent hint");
    if (referer) {
      if (referer.length > 2048 || /[\r\n\x00-\x1f]/.test(referer))
        throw new ProxyError(400, "invalid_referer", "Invalid Referer hint");
      let ref;
      try {
        ref = new URL(referer);
      } catch {
        throw new ProxyError(400, "invalid_referer", "Invalid Referer URL");
      }
      if (!["http:", "https:"].includes(ref.protocol) || ref.username || ref.password)
        throw new ProxyError(400, "invalid_referer", "Referer must be HTTP(S)");
      headers.set("Referer", ref.toString());
    }
    const incomingAgent = request.headers.get("User-Agent")?.trim() || "";
    const clientAgent = incomingAgent.length <= 512 && !/[\r\n\x00-\x1f]/.test(incomingAgent) ? incomingAgent : "";
    if (isWikimediaMediaHost(current)) {
      headers.set("User-Agent", PROXY_USER_AGENT + (clientAgent ? ` ${clientAgent}` : ""));
    } else {
      headers.set("User-Agent", agent || clientAgent || PROXY_USER_AGENT);
    }
    const response = await fetch(current.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "manual",
      signal: request.signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status))
      return { response, finalUrl: current };
    const location = response.headers.get("Location");
    if (!location)
      throw new ProxyError(502, "bad_redirect", "Upstream redirect lacks Location");
    await response.body?.cancel().catch(() => {
      return;
    });
    current = assertAllowedUrl(new URL(location, current).toString(), env);
  }
  throw new ProxyError(502, "redirect_limit", "Too many upstream redirects");
}
async function proxy(request, env, reqUrl) {
  const key = reqUrl.searchParams.get("key");
  assertToken(key, env);
  const rawUrl = reqUrl.searchParams.get("url");
  if (!rawUrl)
    throw new ProxyError(400, "missing_url", "url query parameter is required");
  const sourceUrl = assertAllowedUrl(rawUrl, env);
  let replacement;
  try {
    replacement = parseSteeringReplacement(reqUrl.searchParams.get("_youtv_steer"));
  } catch (error) {
    throw new ProxyError(400, "invalid_steering_replacement", error instanceof Error ? error.message : "Invalid steering replacement");
  }
  const upstream = assertAllowedUrl(applySteeringReplacement(sourceUrl, replacement).toString(), env);
  const hlsHint = reqUrl.searchParams.get("hls") === "1" || isHls(upstream, "");
  const directives = hlsHint ? deliveryDirectives(reqUrl.searchParams) : new URLSearchParams;
  const variables = parseHlsVariables(reqUrl.searchParams.get("vars"));
  const { response, finalUrl } = await fetchSource(upstream, request, env, directives);
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
    "Retry-After"
  ]) {
    const v = response.headers.get(name);
    if (v)
      headers.set(name, v);
  }
  const upstreamLength = response.headers.get("Content-Length");
  if (upstreamLength && !response.headers.has("Content-Encoding"))
    headers.set("Content-Length", upstreamLength);
  if (reqUrl.searchParams.get("download") === "1" && response.ok)
    setDownloadDisposition(headers, reqUrl, response, finalUrl);
  if (reqUrl.searchParams.get("steer") === "1" && request.method !== "HEAD" && response.ok) {
    const original = await readTextStream(response.body, 512000);
    let data;
    try {
      data = rewriteSteeringJson(original, finalUrl, new URL("/proxy", request.url), key || "", {
        userAgent: reqUrl.searchParams.get("ua") || "",
        referer: reqUrl.searchParams.get("ref") || ""
      });
    } catch (error) {
      throw new ProxyError(502, "invalid_steering_manifest", error instanceof Error ? error.message : "Bad steering manifest");
    }
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Content-Type", "application/vnd.apple.steering-list; charset=utf-8");
    return new Response(data, { status: 200, headers });
  }
  if (reqUrl.searchParams.get("asset") === "1" && request.method !== "HEAD" && response.ok) {
    const original = await readTextStream(response.body, 512000);
    let data;
    try {
      data = rewriteInterstitialAssetList(original, finalUrl, new URL("/proxy", request.url), key || "", {
        userAgent: reqUrl.searchParams.get("ua") || "",
        referer: reqUrl.searchParams.get("ref") || ""
      });
    } catch (error) {
      throw new ProxyError(502, "invalid_asset_list", error instanceof Error ? error.message : "Invalid HLS asset list");
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
  let dashManifest = reqUrl.searchParams.get("dash") === "1" || isDash(finalUrl, responseType);
  if (request.method !== "HEAD" && response.ok && response.status !== 206) {
    const peeked = await peekStream(responseBody, 4096);
    responseBody = peeked.body;
    const sample = new TextDecoder().decode(peeked.prefix).replace(/^\uFEFF/, "").trimStart();
    if (hasHlsSyntax(sample)) {
      hlsManifest = true;
      dashManifest = false;
    } else if (/^(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/i.test(sample)) {
      dashManifest = true;
      hlsManifest = false;
    } else {
      hlsManifest = false;
      dashManifest = false;
    }
  }
  if (hlsHint && request.method !== "HEAD")
    headers.set("X-YouTV-HLS-Result", !response.ok ? "upstream-error" : response.status === 206 ? "partial" : dashManifest ? "dash" : hlsManifest ? "rewritten" : "not-playlist");
  if (dashManifest && request.method !== "HEAD" && response.ok && response.status !== 206) {
    const source = await readTextStream(responseBody);
    let rewritten;
    try {
      rewritten = rewriteDash(source, finalUrl, new URL("/", request.url), key || "");
    } catch (error) {
      throw new ProxyError(502, "invalid_dash_manifest", error instanceof Error ? error.message : "Invalid DASH MPD");
    }
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.delete("Last-Modified");
    headers.set("Content-Type", "application/dash+xml; charset=utf-8");
    return new Response(rewritten, { status: 200, headers });
  }
  if (request.method === "GET" && response.status === 200 && !hlsHint && !hlsManifest && !dashManifest && /^image\/[a-z0-9.+-]+(?:\s*;|$)/i.test(responseType) && !key && !env.PROXY_TOKEN?.trim() && !request.headers.has("Authorization") && !request.headers.has("Range") && !request.headers.has("Cookie") && !response.headers.has("Set-Cookie") && [...reqUrl.searchParams.keys()].every((name) => name === "url") && !sourceUrl.search && !finalUrl.search && !/\b(?:cookie|authorization)\b|\*/i.test(response.headers.get("Vary") || "")) {
    const policy = response.headers.get("Cache-Control") || "";
    if (!/\b(?:no-store|no-cache|private)\b/i.test(policy) && !/no-cache/i.test(response.headers.get("Pragma") || "")) {
      const match = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(policy);
      const seconds = match ? Math.min(86400, Number(match[1])) : !policy && !response.headers.has("Expires") ? 86400 : 0;
      const age = Number(response.headers.get("Age") || 0);
      const remaining = Math.max(0, seconds - (Number.isFinite(age) ? age : seconds));
      if (remaining > 0)
        headers.set("Cache-Control", `public, max-age=${Math.floor(remaining)}`);
    }
  }
  if (request.method === "HEAD" || !response.ok || response.status === 206 || !hlsManifest) {
    return new Response(request.method === "HEAD" ? null : responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  const source = await readTextStream(responseBody);
  let rewritten;
  try {
    const proxyUrl = new URL("/proxy", request.url);
    rewritten = rewriteHls(source, finalUrl, proxyUrl, key || "", {
      userAgent: reqUrl.searchParams.get("ua") || "",
      referer: reqUrl.searchParams.get("ref") || ""
    }, variables);
  } catch (error) {
    throw new ProxyError(502, "invalid_manifest", error instanceof Error ? error.message : "Invalid HLS manifest");
  }
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.delete("Last-Modified");
  headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  return new Response(rewritten, { status: 200, headers });
}
var src_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      assertOrigin(request, env);
      if (request.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request, env)
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
        const relay = new URL("/proxy", url);
        relay.searchParams.set("url", target.toString());
        if (token)
          relay.searchParams.set("key", token);
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
        let result = await fetchSource(upstream, new Request(request.url, {
          method: "HEAD",
          signal: AbortSignal.timeout(9000)
        }), env);
        let prefix = new Uint8Array;
        const initialType = result.response.headers.get("Content-Type") || "";
        let kind = sniffMediaKind(result.finalUrl, initialType);
        if ([403, 405, 501].includes(result.response.status) || kind === "file") {
          await result.response.body?.cancel().catch(() => {
            return;
          });
          result = await fetchSource(upstream, new Request(request.url, {
            headers: { Range: "bytes=0-4095" },
            signal: AbortSignal.timeout(9000)
          }), env);
          const peeked = await peekStream(result.response.body, 4096);
          prefix = peeked.prefix;
          await peeked.body?.cancel().catch(() => {
            return;
          });
          kind = sniffMediaKind(result.finalUrl, result.response.headers.get("Content-Type") || initialType, prefix);
        } else
          await result.response.body?.cancel().catch(() => {
            return;
          });
        const disposition = result.response.headers.get("Content-Disposition") || "";
        const contentRange = result.response.headers.get("Content-Range") || "";
        const contentLength = Number(contentRange.match(/\/(\d+)$/)?.[1] || (result.response.status === 206 ? "" : result.response.headers.get("Content-Length"))) || null;
        return json(request, env, {
          ok: result.response.status >= 200 && result.response.status < 400,
          status: result.response.status,
          elapsedMs: Math.max(0, Date.now() - start),
          contentType: result.response.headers.get("Content-Type") || initialType,
          contentLength,
          acceptRanges: result.response.headers.get("Accept-Ranges") || "",
          filename: upstreamFilename(disposition),
          kind
        });
      }
      if (url.pathname === "/health" && request.method === "GET")
        return json(request, env, {
          name: "YouTV Proxy",
          version: VERSION,
          ok: true
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
          authentication: env.PROXY_TOKEN?.trim() ? "query-token" : "none"
        });
      if (url.pathname === "/text") {
        if (request.method !== "GET")
          throw new ProxyError(405, "method_not_allowed", "GET only");
        const key = url.searchParams.get("key");
        assertToken(key, env);
        const raw = url.searchParams.get("url");
        if (!raw)
          throw new ProxyError(400, "missing_url", "url query parameter is required");
        const { response, finalUrl } = await fetchSource(assertAllowedUrl(raw, env), request, env);
        if (!response.ok)
          throw new ProxyError(502, "upstream_error", `Playlist source returned HTTP ${response.status}`);
        const headers = corsHeaders(request, env);
        headers.set("Content-Type", "text/plain; charset=utf-8");
        headers.set("X-YouTV-Source-URL", finalUrl.href);
        headers.set("Cache-Control", "no-store");
        return new Response(response.body, { status: 200, headers });
      }
      if (url.pathname !== "/proxy")
        return json(request, env, { code: "not_found", error: "Not found" }, 404);
      if (!["GET", "HEAD"].includes(request.method))
        throw new ProxyError(405, "method_not_allowed", "GET/HEAD only");
      return await proxy(request, env, url);
    } catch (error) {
      if (error instanceof ProxyError)
        return json(request, env, { code: error.code, error: error.message }, error.status);
      return json(request, env, { code: "upstream_error", error: "Upstream request failed" }, 502);
    }
  }
};
export {
  src_default as default
};
