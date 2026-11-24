import type { WorkerProfile } from "@youtv/shared";
import { instagramFetchUrl, proxyDownloadUrl } from "@/lib/proxy";

export type InstagramAsset = {
  id: string;
  kind: "image" | "video";
  url: string;
  thumbnail: string;
  filename: string;
  width: number;
  height: number;
};
export type InstagramPost = {
  url: string;
  caption: string;
  author: string;
  thumbnail: string;
  assets: InstagramAsset[];
};

function safeName(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "instagram-media"
  );
}
function parseBalancedJson(source: string, start: number): unknown | null {
  if (source[start] !== "{") return null;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
function jsonCandidates(html: string): unknown[] {
  const candidates: unknown[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent?.trim() || "";
    if (!text) continue;
    if (text.startsWith("{")) {
      try {
        candidates.push(JSON.parse(text));
        continue;
      } catch {
        /* scan embedded wrapper */
      }
    }
    const markers = [
      "window._sharedData =",
      "window.__additionalDataLoaded(",
      '"xdt_shortcode_media":',
    ];
    for (const marker of markers) {
      const index = text.indexOf(marker);
      if (index < 0) continue;
      const start = text.indexOf("{", index + marker.length);
      if (start >= 0) {
        const parsed = parseBalancedJson(text, start);
        if (parsed) candidates.push(parsed);
      }
    }
  }
  return candidates;
}
function bestImage(candidates: any[]): any | null {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return (
    [...candidates].sort(
      (a, b) =>
        (Number(b.width) || 0) * (Number(b.height) || 0) -
        (Number(a.width) || 0) * (Number(a.height) || 0),
    )[0] || null
  );
}
function bestVideo(candidates: any[]): any | null {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return (
    [...candidates].sort(
      (a, b) =>
        (Number(b.width) || 0) * (Number(b.height) || 0) -
          (Number(a.width) || 0) * (Number(a.height) || 0) ||
        Number(b.bandwidth || 0) - Number(a.bandwidth || 0),
    )[0] || null
  );
}
function extractAssets(
  payloads: unknown[],
  html: string,
  postUrl: string,
): InstagramAsset[] {
  const assets: InstagramAsset[] = [];
  const seen = new Set<string>();
  const add = (
    urlValue: unknown,
    kind: "image" | "video",
    width = 0,
    height = 0,
    thumbnail = "",
  ) => {
    if (typeof urlValue !== "string" || !urlValue.startsWith("https://"))
      return;
    let url: string;
    try {
      url = new URL(urlValue).toString();
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    assets.push({
      id: `ig-${assets.length + 1}`,
      kind,
      url,
      thumbnail: thumbnail || url,
      width: Number(width) || 0,
      height: Number(height) || 0,
      filename: `instagram-${assets.length + 1}.${kind === "video" ? "mp4" : "jpg"}`,
    });
  };
  const visited = new WeakSet<object>();
  const walk = (value: unknown, depth = 0) => {
    if (depth > 32 || !value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, any>;
    const carousel = Array.isArray(node.carousel_media)
      ? node.carousel_media
      : Array.isArray(node.edge_sidecar_to_children?.edges)
        ? node.edge_sidecar_to_children.edges
            .map((edge: any) => edge?.node)
            .filter(Boolean)
        : null;
    if (carousel) {
      for (const child of carousel) walk(child, depth + 1);
      return;
    }
    const video = bestVideo(node.video_versions || node.video_resources);
    if (video?.url) {
      add(
        video.url,
        "video",
        video.width,
        video.height,
        node.display_url || node.thumbnail_src || "",
      );
      return;
    }
    if (typeof node.video_url === "string") {
      add(
        node.video_url,
        "video",
        node.original_width,
        node.original_height,
        node.display_url || "",
      );
      return;
    }
    const image = bestImage(
      node.image_versions2?.candidates ||
        node.display_resources ||
        node.thumbnail_resources,
    );
    if (image?.url) {
      add(image.url, "image", image.width, image.height);
      return;
    }
    if (
      typeof node.display_url === "string" &&
      node.display_url.startsWith("https://")
    ) {
      add(
        node.display_url,
        "image",
        node.dimensions?.width,
        node.dimensions?.height,
      );
      return;
    }
    if (
      typeof node.src === "string" &&
      node.src.startsWith("https://") &&
      /image/i.test(String(node.mime_type || ""))
    )
      add(node.src, "image");
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  for (const payload of payloads) walk(payload);
  if (!assets.length) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const video = doc
      .querySelector(
        'meta[property="og:video:secure_url"],meta[property="og:video"]',
      )
      ?.getAttribute("content");
    const image = doc
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content");
    if (video) add(video, "video", 0, 0, image || "");
    else if (image) add(image, "image");
  }
  return assets;
}

function extractCaptionFromPayloads(payloads: unknown[]): string {
  const visited = new WeakSet<object>();
  let caption = "";
  const walk = (value: unknown, depth = 0) => {
    if (caption || depth > 32 || !value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, any>;
    const candidates = [
      node.caption?.text,
      node.edge_media_to_caption?.edges?.[0]?.node?.text,
      node.caption?.edges?.[0]?.node?.text,
      node.accessibility_caption,
    ];
    const found = candidates.find(
      (item) => typeof item === "string" && item.trim(),
    );
    if (found) {
      caption = String(found).trim();
      return;
    }
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  for (const payload of payloads) walk(payload);
  return caption;
}
function extractAuthorFromPayloads(payloads: unknown[]): string {
  const visited = new WeakSet<object>();
  let author = "";
  const walk = (value: unknown, depth = 0) => {
    if (author || depth > 32 || !value || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, any>;
    const candidate =
      node.owner?.username ||
      node.user?.username ||
      node.owner?.full_name ||
      node.user?.full_name;
    if (typeof candidate === "string" && candidate.trim()) {
      author = candidate.trim();
      return;
    }
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  for (const payload of payloads) walk(payload);
  return author;
}
export function extractInstagramPostHtml(
  html: string,
  canonical = "https://www.instagram.com/p/unknown/",
): InstagramPost | null {
  const payloads = jsonCandidates(html);
  const assets = extractAssets(payloads, html, canonical);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const caption =
    extractCaptionFromPayloads(payloads) ||
    doc
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") ||
    "";
  const thumbnail =
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ||
    assets[0]?.thumbnail ||
    "";
  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    "";
  if (
    !assets.length &&
    (/log\s*in|sign\s*up/i.test(title) || (!caption && !thumbnail))
  )
    return null;
  const author =
    extractAuthorFromPayloads(payloads) ||
    caption.match(/(?:by|from)\s+([^·]+)/i)?.[1]?.trim() ||
    title.match(/^([^(:]+)/)?.[1]?.trim() ||
    "";
  return { url: canonical, caption, author, thumbnail, assets };
}

export async function resolveInstagramPost(
  worker: WorkerProfile,
  rawUrl: string,
  signal?: AbortSignal,
): Promise<InstagramPost> {
  const normalized = new URL(rawUrl);
  const path = normalized.pathname.match(
    /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/,
  );
  if (!path)
    throw new Error("آدرس باید مربوط به Post، Reel یا IGTV عمومی باشد");
  const canonical = `https://www.instagram.com/${path[1]}/${path[2]}/`;
  let html = "",
    lastError = "";
  for (const variant of ["json", "html", "embed"] as const) {
    try {
      const response = await fetch(
        instagramFetchUrl(worker, variant === "embed" ? `${canonical}embed/` : canonical, variant === "json"),
        { credentials: "omit", cache: "no-store", signal },
      );
      if (!response.ok) {
        lastError = `Instagram HTTP ${response.status}`;
        continue;
      }
      html = await response.text();
      if (html.length > 8_000_000)
        throw new Error("Instagram page is too large");
      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const payload = JSON.parse(html);
          const assets = extractAssets([payload], html, canonical);
          if (assets.length)
            return {
              url: canonical,
              caption: extractCaptionFromPayloads([payload]),
              author: extractAuthorFromPayloads([payload]),
              thumbnail: assets[0]?.thumbnail || "",
              assets,
            };
        } catch {
          /* try HTML parsing */
        }
      }
      const parsed = extractInstagramPostHtml(html, canonical);
      if (parsed?.assets.length) return parsed;
    } catch (error) {
      signal?.throwIfAborted();
      lastError =
        error instanceof Error ? error.message : "Instagram request failed";
    }
  }
  if (/login|challenge|consent|rate.?limit/i.test(html + lastError))
    throw new Error(
      "این محتوای Instagram برای دسترسی عمومی در دسترس نیست یا Instagram درخواست را محدود کرده است. محتوای خصوصی یا نیازمند ورود پشتیبانی نمی‌شود.",
    );
  throw new Error(
    lastError ||
      "رسانه‌ای از صفحه عمومی Instagram استخراج نشد؛ ممکن است صفحه نیازمند ورود یا محافظت ضدربات باشد",
  );
}

export function instagramDownloadUrl(
  asset: InstagramAsset,
  worker: WorkerProfile,
): string {
  return proxyDownloadUrl(asset.url, worker, safeName(asset.filename));
}
