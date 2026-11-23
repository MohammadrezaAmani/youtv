/**
 * Rewrites ALL URI-bearing HLS lines that are standardized in RFC 8216,
 * including additional LL-HLS and image playlist URI attributes.
 * Never rewrites metadata or actual media payload bytes.
 */
export function rewriteHls(manifest: string, sourceUrl: URL, proxyUrl: URL, token: string, hints?:{userAgent?:string;referer?:string}): string {
  if (!/^\uFEFF?\s*#EXTM3U(?:\r?\n|$)/.test(manifest)) {
    throw new Error('Response is not an HLS playlist (#EXTM3U missing)');
  }
  // HLS metadata and keys may contain non-network URIs (e.g. inline
  // data: keys/session metadata, or skd: FairPlay identifiers). Those are
  // consumed by the player, not fetched through this Worker. Keep them
  // unchanged instead of rejecting the entire live playlist.
  const replace = (uri: string, attribute = false): string => {
    let resolved: URL;
    try { resolved = new URL(uri, sourceUrl); }
    catch { throw new Error('Invalid HLS URI'); }
    if (resolved.protocol === 'data:' || (attribute && (resolved.protocol === 'skd:' || resolved.protocol === 'urn:'))) {
      return uri;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      // Never emit dangerous or unsupported schemes (javascript:, file:,
      // ftp:, etc.) into the browser's playable playlist.
      throw new Error(`Unsupported HLS URI scheme: ${resolved.protocol}`);
    }
    const out = new URL(proxyUrl);
    out.searchParams.set('url', resolved.toString());
    if (token) out.searchParams.set('key', token);
    if(hints?.userAgent)out.searchParams.set('ua',hints.userAgent);
    if(hints?.referer)out.searchParams.set('ref',hints.referer);
    return out.toString();
  };
  return manifest.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    // Some IPTV origins omit '#' on HLS tags. Normalize only recognized HLS
    // directive shapes, never arbitrary strings or URL schemes.
    const bareTag = /^(?:EXTM3U$|EXTINF:|EXT-X-[A-Z0-9-]+(?::|$))/i.test(trimmed);
    const normalized = bareTag ? line.replace(trimmed, `#${trimmed}`) : line;
    if (!trimmed.startsWith('#') && !bareTag) return replace(trimmed);
    // e.g. #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
    // URI attributes can appear at any position, and may contain escaped quotes.
    if (!/^#EXT-X-[\w-]+:/i.test(normalized.trim())) return normalized;
    return normalized.replace(/(^|[,:])URI="((?:[^"\\]|\\.)*)"/g, (match: string, prefix: string, uri: string) => {
      const decoded = uri.replace(/\\"/g, '"');
      const updated = replace(decoded, true);
      // Do not alter quoting/escaping of inline data and DRM identifiers.
      return updated === decoded ? match : `${prefix}URI="${updated}"`;
    });
  }).join(manifest.includes('\r\n') ? '\r\n' : '\n');
}

export function isHls(url: URL, contentType: string): boolean {
  const path = url.pathname.toLowerCase();
  const mime = contentType.toLowerCase().split(';')[0]?.trim() || '';
  return path.endsWith('.m3u8') || path.endsWith('.m3u') ||
    ['application/vnd.apple.mpegurl','application/x-mpegurl','audio/mpegurl','audio/x-mpegurl'].includes(mime);
}

export async function readTextStream(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}
