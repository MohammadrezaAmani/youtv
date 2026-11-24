import type { WorkerProfile } from "@youtv/shared";
import { proxyUrl } from "@/lib/proxy";
import { hlsRequestRoute, hlsResponseBase } from "@/features/player/hlsRelayRoutes";
import type { ZipEntrySource } from "./download";
import { textByteStream } from "./byteStream";
import { archiveResourceRoutes, fetchArchiveResource } from "./mediaRoutes";

type LoadedManifest = { text: string; url: string };
type ByteRange = { length: number; offset: number; implicit: boolean };
function attrs(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const source = line.slice(line.indexOf(":") + 1);
  const re = /([A-Z0-9-]+)=((?:"(?:[^"\\]|\\.)*")|[^,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const raw = match[2] || "";
    result[(match[1] || "").toUpperCase()] =
      raw.startsWith('"') && raw.endsWith('"')
        ? raw.slice(1, -1).replace(/\\"/g, '"')
        : raw;
  }
  return result;
}
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function setAttribute(line: string, name: string, value: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(${escaped}=)(?:"(?:[^"\\\\]|\\\\.)*"|[^,]*)`,
    "i",
  );
  return pattern.test(line)
    ? line.replace(pattern, `$1${quote(value)}`)
    : `${line},${name}=${quote(value)}`;
}
function safePart(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "media"
  );
}
function unwrapProxyUrl(value: string): URL {
  const parsed = new URL(value);
  const original = parsed.searchParams.get("url");
  return original ? new URL(original) : parsed;
}
function extensionFor(value: string, fallback = "bin"): string {
  try {
    const ext = unwrapProxyUrl(value).pathname.split(".").at(-1) || fallback;
    return (
      ext
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 8)
        .toLowerCase() || fallback
    );
  } catch {
    return fallback;
  }
}
async function readManifest(
  url: string,
  signal?: AbortSignal,
  worker?: WorkerProfile,
): Promise<LoadedManifest> {
  const routed = worker ? hlsRequestRoute(url, worker, url, true) : url;
  const response = await fetch(routed, {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HLS manifest HTTP ${response.status}`);
  const text = await response.text();
  if (!/^\uFEFF?\s*#EXTM3U(?:\r?\n|$)/.test(text))
    throw new Error("HLS manifest is invalid");
  const base = worker ? hlsResponseBase(text, routed, worker, response.headers.get("X-YouTV-Source-URL")) : undefined;
  return { text, url: base || response.url || routed };
}
function parseRange(value: string): ByteRange {
  const match = value.trim().match(/^(\d+)(?:@(\d+))?$/);
  if (!match) throw new Error("Invalid HLS BYTERANGE");
  const length = Number(match[1]);
  const implicit = match[2] === undefined;
  const offset = implicit ? 0 : Number(match[2]);
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error("Invalid HLS BYTERANGE");
  return { length, offset, implicit };
}
function mediaLines(text: string): boolean {
  return text.split(/\r?\n/).some((line) => /^#EXTINF:/i.test(line.trim()));
}
function makeFetcher(
  entries: ZipEntrySource[],
  signal: AbortSignal | undefined,
  worker: WorkerProfile | undefined,
  fallbacks: WorkerProfile[],
) {
  const keys = new Map<string, string>();
  let keyCounter = 0;
  const fetchEntry =
    (url: string, range?: ByteRange): ZipEntrySource["open"] =>
    async (entrySignal?: AbortSignal) => {
      // Fetch accepts a sequence of header pairs without relying on the
      // ambient Headers constructor (which differs in DOM test environments).
      const headers: [string, string][] = range
        ? [["range", `bytes=${range.offset}-${range.offset + range.length - 1}`]]
        : [];
      const routed = worker ? hlsRequestRoute(url, worker, url) : url;
      const response = await fetchArchiveResource(worker ? archiveResourceRoutes(routed, worker, fallbacks) : [routed], {
        headers, credentials: "omit", cache: "no-store", signal: entrySignal || signal,
      }, response => {
        if (!response.ok) throw new Error(`HLS media HTTP ${response.status}`);
        if (range) {
          const end = range.offset + range.length - 1;
          const contentRange = response.headers.get("content-range");
          const returned = contentRange?.match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/i);
          if (response.status !== 206 || !returned || Number(returned[1]) !== range.offset || Number(returned[2]) !== end)
            throw new Error(`Invalid HLS byte-range response: expected bytes ${range.offset}-${end}, got HTTP ${response.status} (${contentRange || "missing Content-Range"})`);
        }
      });
      if (!response.body) throw new Error("HLS resource has no body");
      return response.body;
    };
  return {
    fetchEntry,
    keyPath: (uri: string) => {
      let local = keys.get(uri);
      if (!local) {
        local = `keys/key-${++keyCounter}.bin`;
        keys.set(uri, local);
        entries.push({ filename: local, open: fetchEntry(uri) });
      }
      return local;
    },
  };
}
async function archiveMediaPlaylist(
  loaded: LoadedManifest,
  prefix: string,
  entries: ZipEntrySource[],
  fetcher: ReturnType<typeof makeFetcher>,
  signal?: AbortSignal,
): Promise<{
  path: string;
  text: string;
  segments: number;
  liveSnapshot: boolean;
}> {
  const lines = loaded.text.split(/\r?\n/);
  const liveSnapshot = !lines.some((line) =>
    /^#EXT-X-ENDLIST\s*$/i.test(line.trim()),
  );
  const output: string[] = [];
  let segmentIndex = 0;
  let pendingRange: ByteRange | undefined;
  const rangeEnds = new Map<string, number>();
  let mapIndex = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push(line);
      continue;
    }
    if (/^#EXT-X-BYTERANGE:/i.test(trimmed)) {
      pendingRange = parseRange(trimmed.slice(trimmed.indexOf(":") + 1));
      continue;
    }
    if (
      /^#EXT-X-KEY:/i.test(trimmed) ||
      /^#EXT-X-SESSION-KEY:/i.test(trimmed)
    ) {
      const meta = attrs(trimmed);
      const method = meta.METHOD || "NONE";
      if (method === "NONE") {
        output.push(line);
        continue;
      }
      if (method !== "AES-128")
        throw new Error(
          `HLS encryption ${method} cannot be archived as a playable offline playlist`,
        );
      if (meta.KEYFORMAT && meta.KEYFORMAT !== "identity")
        throw new Error(
          `HLS key format ${meta.KEYFORMAT} is DRM-protected and cannot be archived`,
        );
      const uri = meta.URI;
      if (!uri) throw new Error("AES-128 key URI is missing");
      if (uri.startsWith("data:")) {
        output.push(line);
        continue;
      }
      const local = fetcher.keyPath(new URL(uri, loaded.url).toString());
      output.push(
        line.replace(
          /URI=("(?:[^"\\]|\\.)*")/i,
          `URI=${quote(relativePath(prefix, local))}`,
        ),
      );
      continue;
    }
    if (/^#EXT-X-MAP:/i.test(trimmed)) {
      const meta = attrs(trimmed);
      const uri = meta.URI;
      if (!uri) throw new Error("EXT-X-MAP URI is missing");
      const absolute = new URL(uri, loaded.url).toString();
      let range = meta.BYTERANGE ? parseRange(meta.BYTERANGE) : undefined;
      if (range?.implicit) {
        const previous = rangeEnds.get(absolute);
        if (previous === undefined)
          throw new Error(
            "Implicit EXT-X-MAP BYTERANGE has no previous range for this resource",
          );
        range = { ...range, offset: previous };
      }
      if (range) rangeEnds.set(absolute, range.offset + range.length);
      const local = `${prefix ? `${prefix}/` : ""}init-${++mapIndex}.${extensionFor(absolute, "mp4")}`;
      entries.push({
        filename: local,
        open: fetcher.fetchEntry(absolute, range),
      });
      let rewritten = line.replace(
        /URI=("(?:[^"\\]|\\.)*")/i,
        `URI=${quote(relativePath(prefix, local))}`,
      );
      rewritten = rewritten.replace(
        /,?BYTERANGE=(?:"(?:[^"\\]|\\.)*"|[^,]+)/i,
        "",
      );
      output.push(rewritten);
      continue;
    }
    if (
      /^#EXT-X-(?:PART|PRELOAD-HINT|RENDITION-REPORT|CONTENT-STEERING|SERVER-CONTROL|SKIP):/i.test(
        trimmed,
      )
    )
      continue;
    if (trimmed.startsWith("#")) {
      output.push(line);
      continue;
    }
    const absolute = new URL(trimmed, loaded.url).toString();
    if (pendingRange?.implicit) {
      const previous = rangeEnds.get(absolute);
      if (previous === undefined)
        throw new Error(
          "Implicit EXT-X-BYTERANGE has no previous range for this resource",
        );
      pendingRange = { ...pendingRange, offset: previous };
    }
    if (pendingRange)
      rangeEnds.set(absolute, pendingRange.offset + pendingRange.length);
    const local = `${prefix ? `${prefix}/` : ""}segments/${String(++segmentIndex).padStart(6, "0")}.${extensionFor(absolute, "ts")}`;
    entries.push({
      filename: local,
      open: fetcher.fetchEntry(absolute, pendingRange),
    });
    output.push(relativePath(prefix, local));
    pendingRange = undefined;
  }
  if (!segmentIndex)
    throw new Error(
      `No complete HLS media segments found in ${prefix}; the live playlist may expose only LL-HLS parts`,
    );
  if (liveSnapshot) output.push("#EXT-X-ENDLIST");
  const path = prefix ? `${prefix}/index.m3u8` : "playlist.m3u8";
  entries.push({
    filename: path,
    open: async () => textByteStream(output.join("\n")),
  });
  return {
    path,
    text: output.join("\n"),
    segments: segmentIndex,
    liveSnapshot,
  };
}
async function archiveSubtitle(
  url: string,
  prefix: string,
  entries: ZipEntrySource[],
  fetcher: ReturnType<typeof makeFetcher>,
  signal?: AbortSignal,
  worker?: WorkerProfile,
): Promise<{ path: string; segments: number; liveSnapshot: boolean }> {
  try {
    const loaded = await readManifest(url, signal, worker);
    const archived = await archiveMediaPlaylist(
      loaded,
      prefix,
      entries,
      fetcher,
      signal,
    );
    return {
      path: archived.path,
      segments: archived.segments,
      liveSnapshot: archived.liveSnapshot,
    };
  } catch (manifestError) {
    const response = await fetch(worker ? hlsRequestRoute(url, worker, url) : url, {
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok) throw manifestError;
    const text = await response.text();
    const mime = response.headers.get("Content-Type") || "";
    if (
      !/^WEBVTT(?:\s|$)/i.test(text.trimStart()) &&
      !/text\/vtt|application\/x-subrip/i.test(mime)
    )
      throw manifestError;
    const extension =
      /subrip/i.test(mime) || /\.srt(?:[?#]|$)/i.test(url) ? "srt" : "vtt";
    const local = `${prefix}.${extension}`;
    entries.push({ filename: local, open: async () => textByteStream(text) });
    return { path: local, segments: 0, liveSnapshot: false };
  }
}
function relativePath(fromPrefix: string, toPath: string): string {
  const from = fromPrefix.split("/").filter(Boolean);
  const to = toPath.split("/").filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return [...from.map(() => ".."), ...to].join("/") || toPath;
}
function parseMaster(text: string, url: string) {
  const lines = text.split(/\r?\n/);
  const variants: {
    line: string;
    url: string;
    bandwidth: number;
    audio: string;
    subtitles: string;
    video: string;
    closedCaptions: string;
    lineIndex: number;
    uriIndex: number;
  }[] = [];
  const media: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || "";
    const trimmed = line.trim();
    if (/^#EXT-X-MEDIA:/i.test(trimmed)) {
      media.push(line);
      continue;
    }
    if (!/^#EXT-X-STREAM-INF:/i.test(trimmed)) continue;
    let next = index + 1;
    while (
      next < lines.length &&
      (!lines[next]!.trim() || lines[next]!.trim().startsWith("#"))
    )
      next++;
    if (next >= lines.length) continue;
    const meta = attrs(trimmed);
    variants.push({
      line,
      url: new URL(lines[next]!.trim(), url).toString(),
      bandwidth: Number(meta.BANDWIDTH) || 0,
      audio: meta.AUDIO || "",
      subtitles: meta.SUBTITLES || "",
      video: meta.VIDEO || "",
      closedCaptions: meta["CLOSED-CAPTIONS"] || "",
      lineIndex: index,
      uriIndex: next,
    });
  }
  return { lines, variants, media };
}
export async function buildHlsArchiveEntries(
  sourceUrl: string,
  worker: WorkerProfile | undefined,
  signal?: AbortSignal,
  fallbacks: WorkerProfile[] = [],
): Promise<{
  entries: ZipEntrySource[];
  name: string;
  segments: number;
  liveSnapshot: boolean;
}> {
  const initial = worker ? proxyUrl(sourceUrl, worker, "proxy", true) : sourceUrl;
  const master = await readManifest(initial, signal, worker);
  const entries: ZipEntrySource[] = [];
  const fetcher = makeFetcher(entries, signal, worker, fallbacks);
  let totalSegments = 0;
  let outputMaster = "";
  let liveSnapshot = false;
  const parsed = parseMaster(master.text, master.url);
  if (!parsed.variants.length || mediaLines(master.text)) {
    const archived = await archiveMediaPlaylist(
      master,
      "",
      entries,
      fetcher,
      signal,
    );
    totalSegments += archived.segments;
    liveSnapshot ||= archived.liveSnapshot;
    outputMaster = archived.text;
  } else {
    const chosen = [...parsed.variants].sort(
      (a, b) => b.bandwidth - a.bandwidth,
    )[0]!;
    const selectedMedia = parsed.media.map((line) => ({
      line,
      meta: attrs(line),
    }));
    const audio = selectedMedia.filter(
      (item) =>
        item.meta.TYPE?.toUpperCase() === "AUDIO" &&
        item.meta["GROUP-ID"] === chosen.audio,
    );
    const subtitles = selectedMedia.filter(
      (item) =>
        item.meta.TYPE?.toUpperCase() === "SUBTITLES" &&
        item.meta["GROUP-ID"] === chosen.subtitles,
    );
    const videoRenditions = selectedMedia.filter(
      (item) =>
        item.meta.TYPE?.toUpperCase() === "VIDEO" &&
        item.meta["GROUP-ID"] === chosen.video,
    );
    const closedCaptions = selectedMedia.filter(
      (item) =>
        item.meta.TYPE?.toUpperCase() === "CLOSED-CAPTIONS" &&
        item.meta["GROUP-ID"] === chosen.closedCaptions,
    );
    const masterLines: string[] = [];
    const variantUriLines = new Set(
      parsed.variants.map((item) => item.uriIndex),
    );
    for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
      const line = parsed.lines[lineIndex] || "";
      const trimmed = line.trim();
      if (
        variantUriLines.has(lineIndex) ||
        /^#EXT-X-MEDIA:/i.test(trimmed) ||
        /^#EXT-X-(?:I-FRAME-STREAM-INF|IMAGE-STREAM-INF):/i.test(trimmed) ||
        /^#EXT-X-STREAM-INF:/i.test(trimmed)
      )
        continue;
      if (/^#EXT-X-SESSION-KEY:/i.test(trimmed)) {
        const meta = attrs(trimmed);
        if (meta.METHOD === "NONE") {
          masterLines.push(line);
          continue;
        }
        if (meta.METHOD !== "AES-128")
          throw new Error(
            `HLS session encryption ${meta.METHOD || "unknown"} cannot be archived`,
          );
        if (meta.KEYFORMAT && meta.KEYFORMAT !== "identity")
          throw new Error(
            `HLS session key format ${meta.KEYFORMAT} is DRM-protected and cannot be archived`,
          );
        if (!meta.URI) throw new Error("EXT-X-SESSION-KEY URI is missing");
        if (meta.URI.startsWith("data:")) {
          masterLines.push(line);
          continue;
        }
        const local = fetcher.keyPath(new URL(meta.URI, master.url).toString());
        masterLines.push(
          line.replace(/URI=("(?:[^"\\]|\\.)*")/i, `URI=${quote(local)}`),
        );
        continue;
      }
      masterLines.push(line);
    }
    const generatedMedia: string[] = [];
    for (const [index, item] of audio.entries()) {
      const name = safePart(
        item.meta.NAME || item.meta.LANGUAGE || `audio-${index + 1}`,
      );
      const prefix = `audio/${name}`;
      if (item.meta.URI) {
        const audioUrl = new URL(item.meta.URI, master.url).toString();
        const loaded = await readManifest(audioUrl, signal, worker);
        const archived = await archiveMediaPlaylist(
          loaded,
          prefix,
          entries,
          fetcher,
          signal,
        );
        totalSegments += archived.segments;
        liveSnapshot ||= archived.liveSnapshot;
        generatedMedia.push(
          item.line.replace(
            /URI=("(?:[^"\\]|\\.)*")/i,
            `URI=${quote(archived.path)}`,
          ),
        );
      } else generatedMedia.push(item.line);
    }
    for (const [index, item] of videoRenditions.entries()) {
      const name = safePart(
        item.meta.NAME || item.meta.LANGUAGE || `video-${index + 1}`,
      );
      const prefix = `video-renditions/${name}`;
      if (item.meta.URI) {
        const renditionUrl = new URL(item.meta.URI, master.url).toString();
        const loaded = await readManifest(renditionUrl, signal, worker);
        const archived = await archiveMediaPlaylist(
          loaded,
          prefix,
          entries,
          fetcher,
          signal,
        );
        totalSegments += archived.segments;
        liveSnapshot ||= archived.liveSnapshot;
        generatedMedia.push(
          item.line.replace(
            /URI=("(?:[^"\\]|\\.)*")/i,
            `URI=${quote(archived.path)}`,
          ),
        );
      } else generatedMedia.push(item.line);
    }
    for (const [index, item] of subtitles.entries()) {
      const name = safePart(
        item.meta.NAME || item.meta.LANGUAGE || `subtitle-${index + 1}`,
      );
      const prefix = `subtitles/${name}`;
      if (item.meta.URI) {
        const subtitleUrl = new URL(item.meta.URI, master.url).toString();
        const archived = await archiveSubtitle(
          subtitleUrl,
          prefix,
          entries,
          fetcher,
          signal,
          worker,
        );
        totalSegments += archived.segments;
        liveSnapshot ||= archived.liveSnapshot;
        generatedMedia.push(
          item.line.replace(
            /URI=("(?:[^"\\]|\\.)*")/i,
            `URI=${quote(archived.path)}`,
          ),
        );
      } else generatedMedia.push(item.line);
    }
    generatedMedia.push(...closedCaptions.map((item) => item.line));
    const video = await readManifest(chosen.url, signal, worker);
    const archivedVideo = await archiveMediaPlaylist(
      video,
      "video",
      entries,
      fetcher,
      signal,
    );
    totalSegments += archivedVideo.segments;
    liveSnapshot ||= archivedVideo.liveSnapshot;
    let streamLine = chosen.line;
    if (audio.length)
      streamLine = setAttribute(streamLine, "AUDIO", chosen.audio);
    if (subtitles.length)
      streamLine = setAttribute(streamLine, "SUBTITLES", chosen.subtitles);
    if (videoRenditions.length)
      streamLine = setAttribute(streamLine, "VIDEO", chosen.video);
    if (closedCaptions.length)
      streamLine = setAttribute(
        streamLine,
        "CLOSED-CAPTIONS",
        chosen.closedCaptions,
      );
    outputMaster = [
      ...masterLines,
      ...generatedMedia,
      streamLine,
      "video/index.m3u8",
    ].join("\n");
    entries.unshift({
      filename: "master.m3u8",
      open: async () => textByteStream(outputMaster),
    });
  }
  if (!totalSegments) throw new Error("No complete HLS media segments found");
  if (liveSnapshot) {
    const note =
      "This archive contains the currently advertised HLS live/DVR window only. It is a finite snapshot, not a complete recording of the broadcast.";
    entries.push({
      filename: "ARCHIVE-INFO.txt",
      open: async () => textByteStream(note),
    });
  }
  const stem = safePart(
    (new URL(sourceUrl).pathname.split("/").at(-1) || "hls-stream").replace(
      /\.(?:m3u8?|m3u)$/i,
      "",
    ),
  );
  return {
    entries,
    name: `${stem}-${liveSnapshot ? "hls-window" : "hls"}.zip`,
    segments: totalSegments,
    liveSnapshot,
  };
}
