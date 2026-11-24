import { assertAllowedUrl, ProxyError, type ProxyEnv } from "./security.ts";

export function isDash(url: URL, contentType = ""): boolean {
  return (
    url.pathname.toLowerCase().endsWith(".mpd") ||
    contentType.toLowerCase().split(";")[0]?.trim() === "application/dash+xml"
  );
}
function xmlDecode(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const names: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (names[entity] !== undefined) return names[entity]!;
      const code = entity.startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : parseInt(entity.slice(2, -1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function resolveResource(raw: string, source: URL): URL {
  const resolved = new URL(xmlDecode(raw.trim()), source);
  if (
    !["http:", "https:"].includes(resolved.protocol) ||
    resolved.username ||
    resolved.password
  )
    throw new Error("Unsupported DASH resource URL");
  return resolved;
}
function encodeContext(value: object): string {
  return btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
type Context = { origin: string; query: string; key: string };
function decodeContext(value: string): Context {
  if (!/^[A-Za-z0-9_-]{1,16384}$/.test(value))
    throw new Error("Malformed DASH context");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const data = JSON.parse(
    new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))),
  ) as Context;
  if (
    typeof data.origin !== "string" ||
    typeof data.query !== "string" ||
    typeof data.key !== "string"
  )
    throw new Error("Malformed DASH context");
  const origin = new URL(data.origin);
  if (
    origin.origin !== data.origin ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw new Error("Invalid DASH origin");
  return data;
}
// The relay context MUST be in the path, not the query. Resolving a relative
// segment against BaseURL drops its query in all standards-compliant players.
function relayUrl(
  resolved: URL,
  workerBase: URL,
  token: string,
  inheritQuery: boolean,
): string {
  const context = encodeContext({
    origin: resolved.origin,
    query: inheritQuery ? resolved.search : "",
    key: token,
  });
  const result = new URL(
    `/dash-base/v1/${context}${resolved.pathname}`,
    workerBase,
  );
  if (!inheritQuery) result.search = resolved.search;
  // URL templates are interpreted by the DASH client, never by the Worker.
  return result.toString().replace(/%24/gi, "$");
}
function proxyResource(
  raw: string,
  source: URL,
  workerBase: URL,
  token: string,
): string {
  return xmlEscape(
    relayUrl(resolveResource(raw, source), workerBase, token, false),
  );
}
export function rewriteDash(
  mpd: string,
  source: URL,
  workerBase: URL,
  token = "",
): string {
  if (new TextEncoder().encode(mpd).byteLength > 8 * 1024 * 1024)
    throw new Error("DASH manifest too large");
  if (
    !/^\s*(?:\uFEFF)?\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?MPD(?:\s|>)/i.test(
      mpd,
    )
  )
    throw new Error("Response is not an MPEG-DASH MPD manifest");
  if (/<!DOCTYPE|<!ENTITY/i.test(mpd))
    throw new Error("DASH XML declarations with entities are not supported");
  type Scope = {
    name: string;
    prefix: string;
    inherited: URL;
    base: URL;
    hasBase: boolean;
  };
  const stack: Scope[] = [];
  let rootOpenEnd = 0,
    rootHasBase = false;
  const tokens =
    /<(?:[\w.-]+:)?BaseURL(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?BaseURL\s*>|<(?:[\w.-]+:)?Location(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?Location\s*>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[\w.:-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
  let output = "",
    last = 0;
  for (const match of mpd.matchAll(tokens)) {
    const raw = match[0],
      offset = match.index!;
    output += mpd.slice(last, offset);
    last = offset + raw.length;
    const nameMatch = raw.match(/^<(\/?)([\w.:-]+)/);
    if (!nameMatch) {
      output += raw;
      continue;
    }
    const full = nameMatch[2]!,
      name = full.split(":").at(-1)!,
      scope = stack.at(-1),
      base = scope?.base || source;
    if (nameMatch[1]) {
      stack.pop();
      output += raw;
      continue;
    }
    if (name === "BaseURL") {
      const parts = raw.match(/^(<[^>]+>)([^<]*)(<\/[^>]+>)$/s);
      if (!parts) throw new Error("Invalid DASH BaseURL");
      const resolved = resolveResource(parts[2]!, scope?.inherited || source);
      if (scope && !scope.hasBase) {
        scope.base = resolved;
        scope.hasBase = true;
        if (scope.name === "MPD") rootHasBase = true;
      }
      output +=
        parts[1] +
        xmlEscape(relayUrl(resolved, workerBase, token, true)) +
        parts[3];
      continue;
    }
    if (name === "Location") {
      const parts = raw.match(/^(<[^>]+>)([^<]*)(<\/[^>]+>)$/s);
      if (!parts) throw new Error("Invalid DASH Location");
      output +=
        parts[1] +
        proxyResource(parts[2]!, source, workerBase, token) +
        parts[3];
      continue;
    }
    let rewritten = raw;
    if (name === "UTCTiming" && /\bschemeIdUri=["'][^"']*http/i.test(raw))
      rewritten = rewritten.replace(
        /(\bvalue\s*=\s*)(["'])([^"']+)\2/i,
        (_m, p: string, q: string, v: string) =>
          `${p}${q}${proxyResource(v, source, workerBase, token)}${q}`,
      );
    if (
      [
        "SegmentTemplate",
        "SegmentURL",
        "Initialization",
        "RepresentationIndex",
        "BitstreamSwitching",
      ].includes(name)
    )
      rewritten = rewritten.replace(
        /(\b(?:media|initialization|sourceURL|index)\s*=\s*)(["'])([^"']+)\2/gi,
        (_m, p: string, q: string, v: string) => {
          // Normal relative references preserve alternate BaseURLs and inheritance.
          if (!/^(?:https?:|\/)/i.test(xmlDecode(v))) return _m;
          return `${p}${q}${proxyResource(v, base, workerBase, token)}${q}`;
        },
      );
    output += rewritten;
    if (name === "MPD") rootOpenEnd = output.length;
    if (!/\/\s*>$/.test(raw))
      stack.push({
        name,
        prefix: full.includes(":") ? full.split(":")[0] + ":" : "",
        inherited: base,
        base,
        hasBase: false,
      });
  }
  output += mpd.slice(last);
  if (!rootHasBase && rootOpenEnd) {
    const prefix = mpd.match(/<(?:([\w.-]+):)?MPD\b/)?.[1];
    const tag = prefix ? `${prefix}:BaseURL` : "BaseURL";
    const rootBase = xmlEscape(
      relayUrl(new URL(".", source), workerBase, token, true),
    );
    output =
      output.slice(0, rootOpenEnd) +
      `<${tag}>${rootBase}</${tag}>` +
      output.slice(rootOpenEnd);
  }
  return output;
}
export function dashRequestToken(requestUrl: URL): string | null {
  if (!requestUrl.pathname.startsWith("/dash-base/v1/"))
    return requestUrl.searchParams.get("key");
  try {
    return decodeContext(requestUrl.pathname.split("/")[3] || "").key;
  } catch {
    if (requestUrl.searchParams.has("base"))
      return requestUrl.searchParams.get("key");
    throw new ProxyError(
      400,
      "invalid_dash_context",
      "Invalid DASH relay context",
    );
  }
}
export function dashBaseTarget(requestUrl: URL, env: ProxyEnv): URL {
  if (requestUrl.pathname.startsWith("/dash-base/v1/")) {
    const parts = requestUrl.pathname.split("/");
    let context: Context | null;
    try {
      context = decodeContext(parts[3] || "");
    } catch {
      if (!requestUrl.searchParams.has("base"))
        throw new ProxyError(
          400,
          "invalid_dash_context",
          "Invalid DASH relay context",
        );
      context = null;
    }
    if (context) {
      const target = new URL(context.origin);
      target.pathname = "/" + parts.slice(4).join("/");
      target.search = requestUrl.search || context.query;
      return assertAllowedUrl(target.toString(), env);
    }
  }
  // Compatibility for previously generated manifests.
  const rawBase = requestUrl.searchParams.get("base");
  if (!rawBase)
    throw new ProxyError(400, "dash_base_missing", "DASH BaseURL is missing");
  const base = assertAllowedUrl(rawBase, env);
  const suffix = requestUrl.pathname.slice("/dash-base/".length);
  const target = suffix ? new URL("./" + suffix, base) : base;
  base.searchParams.forEach((value, key) => {
    if (!target.searchParams.has(key)) target.searchParams.set(key, value);
  });
  return assertAllowedUrl(target.toString(), env);
}
