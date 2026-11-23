/**
 * Rewrites ALL URI-bearing HLS lines that are standardized in RFC 8216,
 * including additional LL-HLS and image playlist URI attributes.
 * Never rewrites metadata or actual media payload bytes.
 */
export function rewriteHls(manifest: string, sourceUrl: URL, proxyUrl: URL, token: string, hints?:{userAgent?:string;referer?:string}): string {
  if (!/^\uFEFF?\s*#EXTM3U(?:\r?\n|$)/.test(manifest)) {
    throw new Error('Response is not an HLS playlist (#EXTM3U missing)');
  }
  const replace = (uri: string): string => {
    const resolved = new URL(uri, sourceUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') throw new Error('HLS URI must use HTTP(S)');
    const out = new URL(proxyUrl);
    out.searchParams.set('url', resolved.toString());
    out.searchParams.set('key', token);
    if(hints?.userAgent)out.searchParams.set('ua',hints.userAgent);
    if(hints?.referer)out.searchParams.set('ref',hints.referer);
    return out.toString();
  };
  return manifest.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return replace(trimmed);
    // e.g. #EXT-X-KEY:METHOD=AES-128,URI="key.bin"
    // URI attributes can appear at any position, and may contain escaped quotes.
    if (!/^#EXT-X-[\w-]+:/i.test(trimmed)) return line;
    return line.replace(/(^|[,:])URI="((?:[^"\\]|\\.)*)"/g, (_match, prefix: string, uri: string) => {
      const decoded = uri.replace(/\\"/g, '"');
      return `${prefix}URI="${replace(decoded)}"`;
    });
  }).join(manifest.includes('\r\n') ? '\r\n' : '\n');
}

export function isHls(url: URL, contentType: string): boolean {
  const path = url.pathname.toLowerCase();
  const mime = contentType.toLowerCase().split(';')[0]?.trim() || '';
  return path.endsWith('.m3u8') || path.endsWith('.m3u') ||
    ['application/vnd.apple.mpegurl','application/x-mpegurl','audio/mpegurl','audio/x-mpegurl'].includes(mime);
}

export async function readTextLimited(body: ReadableStream<Uint8Array> | null, maxBytes = 2_000_000): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('HLS playlist exceeds maximum size');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}
