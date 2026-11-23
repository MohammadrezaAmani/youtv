export type ProxyEnv = {
  ALLOWED_HOSTS?: string;
  ALLOWED_ORIGINS?: string;
  PROXY_TOKEN?: string;
  ADMIN_TOKEN?: string;
  UPSTREAM_REFERER?: string;
};

export class ProxyError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function entries(csv?: string): string[] {
  return (csv || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.onion')) return true;
  if (host.includes(':')) { // IPv6 literals: block all to avoid private ranges and ambiguity.
    return true;
  }
  if (/^\d+(\.\d+){3}$/.test(host)) { // Do not allow literal IPv4, even if public.
    return true;
  }
  if (/^\d+$/.test(host) || /^0x/i.test(host)) return true;
  return false;
}

/**
 * '*' permits any public DNS hostname, including domains used by HLS redirects.
 * Missing/empty ALLOWED_HOSTS intentionally behaves like '*'. Explicit lists
 * and '*.domain.tld' are still supported for users wanting a restricted proxy.
 * The SSRF denylist is applied *before* the wildcard and on every redirect.
 */
export function assertAllowedUrl(raw: string, env: ProxyEnv): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProxyError(400, 'invalid_url', 'Invalid source URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new ProxyError(400, 'invalid_url', 'Only HTTP(S) without embedded credentials is supported');
  if (blockedHost(url.hostname)) throw new ProxyError(403, 'blocked_host', 'IP literals and private/local hostnames are blocked');
  const allowed = entries(env.ALLOWED_HOSTS);
  if (!allowed.length) allowed.push('*');
  const host = url.hostname.toLowerCase().replace(/\.$/,'');
  if (!allowed.some(pattern => pattern === '*' || (pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
    : host === pattern))) {
    throw new ProxyError(403, 'host_not_allowed', 'Source host is not in ALLOWED_HOSTS');
  }
  return url;
}

const DEFAULT_WEB_ORIGIN = 'https://mohammadrezaamani.github.io';
const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Default YouTV site + loopback development origins; extra origins are additive. */
export function allowedOrigin(request: Request, env: ProxyEnv): string | null {
  const origin = request.headers.get('Origin');
  if (!origin || origin === 'null') return null;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin.toLowerCase() !== origin.toLowerCase()) return null;
  const list = entries(env.ALLOWED_ORIGINS);
  if (list.includes('*') || origin.toLowerCase() === DEFAULT_WEB_ORIGIN ||
      LOCAL_ORIGIN_HOSTS.has(parsed.hostname.toLowerCase()) || list.includes(origin.toLowerCase())) return origin;
  return null;
}

export function assertOrigin(request: Request, env: ProxyEnv): void {
  if (request.headers.has('Origin') && !allowedOrigin(request, env))
    throw new ProxyError(403, 'origin_not_allowed', 'Browser origin is not allowed');
}

/** A missing/blank secret makes the personal Worker passwordless. */
export function assertToken(token: string | null, env: ProxyEnv): void {
  const expected = env.PROXY_TOKEN?.trim() || '';
  if (!expected) return;
  const candidate = token || '';
  let mismatch = candidate.length ^ expected.length;
  const length = Math.max(candidate.length, expected.length);
  for (let i=0; i<length; i++) mismatch |= (candidate.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (mismatch !== 0) throw new ProxyError(401, 'unauthorized', 'Invalid proxy access token');
}

export function corsHeaders(request: Request, env: ProxyEnv): Headers {
  const h = new Headers({ 'Vary': 'Origin', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  const origin = allowedOrigin(request, env);
  if (origin) h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Range, If-Range, Accept, Content-Type, Authorization, X-YouTV-Admin-Token');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, X-YouTV-Proxy');
  h.set('Access-Control-Max-Age', '3600');
  return h;
}
