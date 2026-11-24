import type { WorkerProfile } from "@youtv/shared";
import { proxyUrl, workerEndpoint } from "@/lib/proxy";

function relayTarget(raw: string, worker: WorkerProfile): string | null {
  try {
    const source = new URL(raw);
    const endpoint = new URL(workerEndpoint(worker, "proxy"));
    if (source.origin !== endpoint.origin || source.pathname !== endpoint.pathname) return null;
    const target = source.searchParams.get("url");
    if (!target) return null;
    const upstream = new URL(target);
    return /^https?:$/.test(upstream.protocol) && !upstream.username && !upstream.password ? upstream.href : null;
  } catch { return null; }
}

/** A Worker hostname alone does not identify a relay. Only the actual /proxy
 * endpoint with a valid upstream URL is already routed. Keep signed parameters,
 * Range (in the loader context), and HLS delivery directives intact. */
export function hlsRequestRoute(raw: string, worker: WorkerProfile, initial: string, playlist = false): string {
  if (/^(?:data:|blob:)/i.test(raw)) return raw;
  if (relayTarget(raw, worker)) {
    const routed = new URL(raw);
    if (worker.token) routed.searchParams.set("key", worker.token);
    else routed.searchParams.delete("key");
    if (playlist) routed.searchParams.set("hls", "1");
    const first = relayTarget(initial, worker) ? new URL(initial) : null;
    for (const hint of ["ua", "ref"]) {
      const value = first?.searchParams.get(hint);
      if (value && !routed.searchParams.has(hint)) routed.searchParams.set(hint, value);
    }
    return routed.href;
  }
  const original = relayTarget(initial, worker) ? new URL(initial) : null;
  return proxyUrl(raw, worker, "proxy", playlist, {
    userAgent: original?.searchParams.get("ua") || undefined,
    referer: original?.searchParams.get("ref") || undefined,
  });
}

/** Normally the Worker emits absolute relay URLs. If a legacy or malformed
 * playlist escapes rewriting, give hls.js the real origin as its base so that
 * relative children are resolved before they pass through the relay loader. */
export function hlsResponseBase(text: string, requestUrl: string, worker: WorkerProfile, finalSource: string | null): string | undefined {
  const upstream = relayTarget(requestUrl, worker);
  if (!upstream || !/#?EXTM3U|#EXT-X-/i.test(text)) return undefined;
  const relative = (value: string) => !/^[a-z][a-z\d+.-]*:/i.test(value.trim());
  const hasRelative = text.split(/\r?\n|\r/).some(line => {
    const value = line.trim();
    if (!value) return false;
    if (!value.startsWith("#")) return relative(value);
    return [...value.matchAll(/(?:^|[:,])(?:[A-Z0-9-]*URI|X-ASSET-LIST)\s*=\s*(?:"([^"]+)"|([^,\s]+))/gi)]
      .some(match => relative(match[1] || match[2] || ""));
  });
  if (!hasRelative) return undefined;
  if (finalSource) {
    try {
      const url = new URL(finalSource);
      if (/^https?:$/.test(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* old Worker or invalid response metadata */ }
  }
  return upstream;
}

/** Resolve raw relative references before the player parses the manifest.
 * Some loaders derive the base from the network response URL rather than the
 * callback's URL. The latter is the Worker endpoint, never the CDN directory.
 * Keep HLS variable expressions untouched for hls.js to expand itself. */
export function normalizeRelayPlaylist(text: string, upstreamBase: string): string {
  const resolve = (value: string): string => {
    if (!value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.includes("{$")) return value;
    try {
      const url = new URL(value, upstreamBase);
      return /^https?:$/.test(url.protocol) ? url.href : value;
    } catch { return value; }
  };
  return text.split(/(\r\n|\r|\n)/).map(line => {
    const value = line.trim();
    if (!value) return line;
    if (!value.startsWith("#")) return line.replace(value, () => resolve(value));
    if (!/^#EXT-X-/i.test(value)) return line;
    // Consume whole attribute values, including quoted commas, so a URI-like
    // substring inside NAME or another metadata value is never rewritten.
    return line.replace(/([:,]\s*([A-Z0-9-]+)\s*=\s*)(?:"([^"]*)"|([^,\s]+))/gi,
      (full: string, prefix: string, name: string, quoted: string | undefined, plain: string | undefined) => {
        if (!/^(?:[A-Z0-9-]*URI|X-ASSET-LIST)$/i.test(name)) return full;
        const uri = quoted ?? plain ?? "";
        const resolved = resolve(uri);
        if (resolved === uri) return full;
        return prefix + (quoted !== undefined ? `"${resolved}"` : resolved);
      });
  }).join("");
}
