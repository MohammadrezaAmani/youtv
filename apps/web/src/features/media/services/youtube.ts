import type { WorkerProfile } from "@youtv/shared";
import { createYoutubeFetch, proxyUrl } from "@/lib/proxy";
import {
  createTempFile,
  streamWithCleanup,
  writeStreamToExistingTempFile,
} from "./opfs";
import { evaluatePlayerProgram } from "./youtubeEvaluator";

export type YouTubeFormat = {
  itag: number;
  quality: string;
  mimeType: string;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  size: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  kind: "combined" | "video" | "audio";
};
export type YouTubeVideo = {
  id: string;
  title: string;
  author: string;
  description: string;
  duration: number;
  views: number | null;
  publishDate: string | null;
  isLive: boolean;
  thumbnail: string;
  canonicalUrl: string;
  formats: YouTubeFormat[];
  dashManifest: string;
};
export type YouTubePlaylistItem = {
  id: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  url: string;
};

const clientCache = new Map<string, Promise<any>>();
const infoCache = new Map<string, { at: number; client: any; info: any }>();
const playlistState = new Map<
  string,
  { page: any; pending: YouTubePlaylistItem[] }
>();
const CACHE_MS = 90_000;
const MAX_MUX_FALLBACK_BYTES = 180 * 1024 * 1024;
export type MuxProgress = {
  stage: "video" | "audio" | "mux";
  loaded: number;
  total: number | null;
  fraction?: number;
};
export type MuxedMedia = {
  blob: Blob;
  cleanup: () => Promise<void>;
  filename: string;
};

function clientKey(worker: WorkerProfile): string {
  return `${worker.id}|${worker.baseUrl}|${worker.token}`;
}
async function getClient(worker: WorkerProfile): Promise<any> {
  const key = clientKey(worker);
  let pending = clientCache.get(key);
  if (!pending) {
    pending = (async () => {
      const { Innertube, Platform } = await import("youtubei.js/web");
      // YouTube's signature/n challenge is obfuscated player JavaScript. YouTube.js
      // requires an interpreter hook; this executes only the player program fetched
      // from YouTube, inside the user's browser, never in the Cloudflare Worker.
      Platform.shim.eval = async (data: any) =>
        evaluatePlayerProgram(data.output);
      return Innertube.create({
        fetch: createYoutubeFetch(worker),
        lang: "en",
        location: "US",
        generate_session_locally: true,
        enable_session_cache: true,
      });
    })();
    clientCache.set(key, pending);
    pending.catch(() => clientCache.delete(key));
  }
  return pending;
}
function videoIdFromUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
  let id = "";
  if (host === "youtu.be")
    id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (
    host === "youtube-nocookie.com" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  ) {
    id =
      url.searchParams.get("v") ||
      url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1] ||
      "";
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id))
    throw new Error("آدرس ویدئوی YouTube معتبر نیست");
  return id;
}
export function parseYouTubeUrl(value: string): {
  kind: "video" | "playlist";
  id: string;
  videoId?: string;
} {
  const url = new URL(value);
  const host = url.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
  if (!(
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com")
  ))
    throw new Error("آدرس YouTube معتبر نیست");
  const playlist = url.searchParams.get("list");
  const video = (() => {
    try {
      return videoIdFromUrl(value);
    } catch {
      return "";
    }
  })();
  if (
    playlist &&
    /^(?:PL|UU|LL|FL|RD|OLAK5uy|UULF|VL)[A-Za-z0-9_-]{8,}$/.test(playlist)
  )
    return { kind: "playlist", id: playlist, videoId: video || undefined };
  if (video) return { kind: "video", id: video };
  throw new Error("شناسه ویدئو یا Playlist در آدرس پیدا نشد");
}
function toFormat(format: any): YouTubeFormat | null {
  if (!Number.isFinite(Number(format?.itag))) return null;
  const hasAudio = Boolean(format.has_audio),
    hasVideo = Boolean(format.has_video);
  if (!hasAudio && !hasVideo) return null;
  const mimeType = String(format.mime_type || "application/octet-stream");
  if (format.drm_families?.length || format.fair_play_key_uri) return null;
  return {
    itag: Number(format.itag),
    quality: String(
      format.quality_label ||
        format.quality ||
        format.audio_quality ||
        "unknown",
    ),
    mimeType,
    width: Number(format.width) || 0,
    height: Number(format.height) || 0,
    fps: Number(format.fps) || 0,
    bitrate: Number(format.bitrate) || 0,
    size: Number(format.content_length) || null,
    hasAudio,
    hasVideo,
    kind: hasAudio && hasVideo ? "combined" : hasVideo ? "video" : "audio",
  };
}
async function getInfo(
  worker: WorkerProfile,
  id: string,
): Promise<{ client: any; info: any }> {
  const key = `${clientKey(worker)}|${id}`;
  const cached = infoCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS)
    return { client: cached.client, info: cached.info };
  const client = await getClient(worker);
  let info: any;
  let lastError = "";
  for (const clientName of ["TV", "WEB", "ANDROID"]) {
    try {
      const candidate = await client.getInfo(id, { client: clientName });
      if (candidate?.streaming_data) {
        info = candidate;
        break;
      }
      lastError = String(
        candidate?.playability_status?.reason || "No streaming data",
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!info?.streaming_data)
    throw new Error(
      lastError || "YouTube برای این ویدئو اطلاعات پخش برنگرداند",
    );
  infoCache.delete(key);
  infoCache.set(key, { at: Date.now(), client, info });
  while (infoCache.size > 40) {
    const oldest = infoCache.keys().next().value;
    if (!oldest) break;
    infoCache.delete(oldest);
  }
  return { client, info };
}
export async function resolveYouTubeVideo(
  worker: WorkerProfile,
  id: string,
  includeDashManifest = true,
): Promise<YouTubeVideo> {
  const { info } = await getInfo(worker, id);
  const basic = info.basic_info || {};
  const all = [
    ...(info.streaming_data.formats || []),
    ...(info.streaming_data.adaptive_formats || []),
  ];
  const formats = all
    .map(toFormat)
    .filter((value: YouTubeFormat | null): value is YouTubeFormat =>
      Boolean(value),
    );
  let dashManifest = "";
  if (includeDashManifest)
    try {
      dashManifest = await info.toDash({
        url_transformer: (url: URL) =>
          new URL(proxyUrl(url.toString(), worker)),
        format_filter: (format: any) =>
          !format.drm_families?.length && !format.fair_play_key_uri,
      });
    } catch {
      /* some restricted or DRM streams cannot be represented as browser DASH */
    }
  formats.sort(
    (a, b) =>
      Number(b.hasAudio && b.hasVideo) - Number(a.hasAudio && a.hasVideo) ||
      b.height - a.height ||
      b.bitrate - a.bitrate,
  );
  return {
    id,
    title: String(basic.title || "YouTube video"),
    author: String(basic.author || ""),
    description: String(basic.short_description || ""),
    duration: Number(basic.duration) || 0,
    views: Number.isFinite(Number(basic.view_count))
      ? Number(basic.view_count)
      : null,
    publishDate: String(basic.publish_date || basic.upload_date || "") || null,
    isLive: Boolean(basic.is_live || basic.is_live_content),
    thumbnail: String(
      basic.thumbnail?.at(-1)?.url ||
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ),
    canonicalUrl: String(
      basic.url_canonical || `https://www.youtube.com/watch?v=${id}`,
    ),
    formats,
    dashManifest,
  };
}
export async function openYouTubeDownload(
  worker: WorkerProfile,
  id: string,
  itag: number,
): Promise<{
  stream: ReadableStream<Uint8Array>;
  filename: string;
  size: number | null;
}> {
  const { info } = await getInfo(worker, id);
  const all = [
    ...(info.streaming_data.formats || []),
    ...(info.streaming_data.adaptive_formats || []),
  ];
  const format = all.find((item: any) => Number(item.itag) === itag);
  if (!format)
    throw new Error(
      "فرمت انتخاب‌شده دیگر در دسترس نیست؛ دوباره اطلاعات ویدئو را دریافت کن",
    );
  const kind =
    format.has_audio && format.has_video
      ? "video+audio"
      : format.has_video
        ? "video"
        : "audio";
  const mime = String(format.mime_type || "");
  const extension = mime.includes("webm")
    ? "webm"
    : mime.includes("audio/")
      ? mime.includes("mp4")
        ? "m4a"
        : "webm"
      : "mp4";
  const stream = await info.download({
    itag,
    type: kind,
    format: extension === "webm" ? "webm" : "mp4",
  });
  const title = String(info.basic_info?.title || id)
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 140);
  return {
    stream,
    filename: `${title}.${extension}`,
    size: Number(format.content_length) || null,
  };
}
function videoItem(item: any): YouTubePlaylistItem | null {
  const id = String(item?.video_id || item?.id || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const thumbnail =
    item?.best_thumbnail?.url ||
    item?.thumbnail?.at?.(-1)?.url ||
    item?.thumbnails?.at?.(-1)?.url ||
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const title =
    item?.title?.text ||
    item?.title?.toString?.() ||
    item?.title ||
    "YouTube video";
  const duration = item?.duration?.text || item?.length_text?.text || "";
  return {
    id,
    title: String(title),
    author: String(item?.author || ""),
    duration: String(duration),
    thumbnail: String(thumbnail),
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}
function playlistStateKey(worker: WorkerProfile, id: string): string {
  return `${clientKey(worker)}|playlist|${id}`;
}
function playlistPageItems(page: any): YouTubePlaylistItem[] {
  return Array.from(page?.videos || page?.items || [])
    .map(videoItem)
    .filter((item: YouTubePlaylistItem | null): item is YouTubePlaylistItem =>
      Boolean(item),
    );
}
export async function resolveYouTubePlaylist(
  worker: WorkerProfile,
  id: string,
  maxItems = 500,
): Promise<{
  id: string;
  title: string;
  author: string;
  items: YouTubePlaylistItem[];
  truncated: boolean;
}> {
  const client = await getClient(worker);
  let page = await client.getPlaylist(id);
  const title = String(page.info?.title || "YouTube Playlist");
  const author = String(
    page.info?.author?.name || page.info?.author?.toString?.() || "",
  );
  const items: YouTubePlaylistItem[] = [];
  const seen = new Set<string>();
  let pending: YouTubePlaylistItem[] = [];
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const batch = playlistPageItems(page);
    let reachedLimit = false;
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index]!;
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
      if (items.length >= maxItems) {
        pending = batch.slice(index + 1).filter((value) => !seen.has(value.id));
        reachedLimit = true;
        break;
      }
    }
    if (reachedLimit || !page.has_continuation) break;
    const next = await page.getContinuation();
    if (!next) break;
    page = next;
  }
  if (!items.length)
    throw new Error(
      "ویدئویی از این Playlist دریافت نشد؛ ممکن است خصوصی یا محدود باشد",
    );
  const truncated = pending.length > 0 || Boolean(page.has_continuation);
  playlistState.set(playlistStateKey(worker, id), { page, pending });
  return { id, title, author, items, truncated };
}

export async function loadMoreYouTubePlaylist(
  worker: WorkerProfile,
  id: string,
  knownIds: string[],
  maxItems = 500,
): Promise<{ items: YouTubePlaylistItem[]; truncated: boolean }> {
  const key = playlistStateKey(worker, id);
  let state = playlistState.get(key);
  if (!state) {
    const client = await getClient(worker);
    let page = await client.getPlaylist(id);
    const known = new Set(knownIds);
    let pending: YouTubePlaylistItem[] = [];
    for (
      let pageIndex = 0;
      pageIndex < 100 && page.has_continuation;
      pageIndex++
    ) {
      const batch = playlistPageItems(page);
      pending = batch.filter((item) => !known.has(item.id));
      if (pending.length) break;
      const next = await page.getContinuation();
      if (!next) break;
      page = next;
    }
    state = { page, pending };
  }
  const known = new Set(knownIds);
  const added: YouTubePlaylistItem[] = [];
  let pending = [...state.pending];
  let page = state.page;
  while (added.length < maxItems) {
    while (pending.length && added.length < maxItems) {
      const item = pending.shift()!;
      if (!known.has(item.id)) {
        known.add(item.id);
        added.push(item);
      }
    }
    if (added.length >= maxItems || !page?.has_continuation) break;
    const next = await page.getContinuation();
    if (!next) {
      page = null;
      break;
    }
    page = next;
    pending = playlistPageItems(page).filter((item) => !known.has(item.id));
    if (!pending.length && !page.has_continuation) break;
  }
  const truncated = pending.length > 0 || Boolean(page?.has_continuation);
  playlistState.set(key, { page, pending });
  return { items: added, truncated };
}

export function transcriptSegmentsToVtt(segments: unknown[]): string {
  const lines = ["WEBVTT", ""];
  const stamp = (value: number) => {
    const ms = Math.max(0, Math.round(value));
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    const millis = ms % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  };
  for (const segment of segments as any[]) {
    if (segment?.type !== "TranscriptSegment") continue;
    const text = String(segment.snippet?.toString?.() || segment.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = Number(segment.start_ms);
    const end = Number(segment.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    lines.push(`${stamp(start)} --> ${stamp(end)}`, text, "");
  }
  if (lines.length <= 2)
    throw new Error("برای این ویدئو زیرنویس یا Transcript قابل دریافت نیست.");
  return lines.join("\n");
}
export async function getYouTubeTranscript(
  worker: WorkerProfile,
  id: string,
  language = "",
): Promise<{ language: string; languages: string[]; vtt: string }> {
  const { info } = await getInfo(worker, id);
  const transcriptInfo = await info.getTranscript();
  const languages: string[] = Array.from(transcriptInfo.languages || []);
  const selected =
    language && languages.includes(language)
      ? await transcriptInfo.selectLanguage(language)
      : transcriptInfo;
  const segments = Array.from(
    selected.transcript?.content?.body?.initial_segments || [],
  ) as unknown[];
  return {
    language: selected.selectedLanguage || languages[0] || "und",
    languages,
    vtt: transcriptSegmentsToVtt(segments),
  };
}

async function collectBlob(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      const item = await reader.read();
      signal?.throwIfAborted();
      if (item.done) break;
      if (!item.value) continue;
      size += item.value.byteLength;
      if (size > maxBytes)
        throw new Error(
          "حجم فایل برای Mux داخل حافظه مرورگر بیش از حد مجاز است؛ از مرورگری با OPFS پشتیبانی‌شده استفاده کن یا فایل‌های صوت و تصویر را جدا دانلود کن.",
        );
      chunks.push(new Uint8Array(item.value));
    }
    return new Blob(chunks, { type: "application/octet-stream" });
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Muxes YouTube's separate adaptive video/audio streams into one MP4 in the browser.
 * OPFS is used for temporary inputs and output when available; no media is uploaded
 * to a server. The returned cleanup must be called after the output stream is consumed.
 */
export async function muxYouTubeFormats(
  worker: WorkerProfile,
  id: string,
  videoItag: number,
  audioItag: number,
  title: string,
  onProgress: (progress: MuxProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<MuxedMedia> {
  const muxController = new AbortController();
  const muxSignal = signal
    ? AbortSignal.any([signal, muxController.signal])
    : muxController.signal;
  muxSignal.throwIfAborted();
  const sources = await Promise.allSettled([
    openYouTubeDownload(worker, id, videoItag),
    openYouTubeDownload(worker, id, audioItag),
  ]);
  if (
    sources[0].status === "rejected" ||
    sources[1].status === "rejected" ||
    muxSignal.aborted
  ) {
    await Promise.allSettled(
      sources.flatMap((item) =>
        item.status === "fulfilled" ? [item.value.stream.cancel()] : [],
      ),
    );
    muxSignal.throwIfAborted();
    throw sources[0].status === "rejected"
      ? sources[0].reason
      : sources[1].status === "rejected"
        ? sources[1].reason
        : new Error("Unable to open both tracks");
  }
  const videoSource = sources[0].value,
    audioSource = sources[1].value;
  const inputCleanup: Array<() => Promise<void>> = [];
  let outputTemp: Awaited<ReturnType<typeof createTempFile>> = null;
  let output: any;
  let videoInput: any,
    audioInput: any,
    videoConversion: any,
    audioConversion: any;
  let videoProgress = 0,
    audioProgress = 0;
  let inputTasks: Promise<Blob>[] = [];
  let conversionTasks: Promise<void>[] = [];
  const cancelConversions = () => {
    void Promise.allSettled([
      videoConversion?.cancel?.(),
      audioConversion?.cancel?.(),
    ]);
  };
  muxSignal.addEventListener("abort", cancelConversions, { once: true });
  let outputWritable: FileSystemWritableFileStream | undefined;
  try {
    const videoFilePromise = (async () => {
      const temp = await createTempFile("youtube-video");
      if (temp) {
        const file = await writeStreamToExistingTempFile(
          temp,
          videoSource.stream,
          (bytes) =>
            onProgress({
              stage: "video",
              loaded: bytes,
              total: videoSource.size,
            }),
          muxSignal,
        );
        inputCleanup.push(file.remove);
        return file.file;
      }
      return collectBlob(videoSource.stream, MAX_MUX_FALLBACK_BYTES, muxSignal);
    })();
    const audioFilePromise = (async () => {
      const temp = await createTempFile("youtube-audio");
      if (temp) {
        const file = await writeStreamToExistingTempFile(
          temp,
          audioSource.stream,
          (bytes) =>
            onProgress({
              stage: "audio",
              loaded: bytes,
              total: audioSource.size,
            }),
          muxSignal,
        );
        inputCleanup.push(file.remove);
        return file.file;
      }
      return collectBlob(audioSource.stream, MAX_MUX_FALLBACK_BYTES, muxSignal);
    })();
    inputTasks = [videoFilePromise, audioFilePromise];
    const [videoFile, audioFile] = await Promise.all([
      videoFilePromise,
      audioFilePromise,
    ]);
    if (muxSignal.aborted)
      throw muxSignal.reason || new DOMException("Aborted", "AbortError");
    const module = (await import("mediabunny")) as any;
    videoInput = new module.Input({
      source: new module.BlobSource(videoFile),
      formats: module.ALL_FORMATS,
    });
    audioInput = new module.Input({
      source: new module.BlobSource(audioFile),
      formats: module.ALL_FORMATS,
    });
    if (!(await videoInput.canRead()) || !(await audioInput.canRead()))
      throw new Error(
        "فرمت یکی از Streamهای YouTube برای Mux در مرورگر قابل خواندن نیست.",
      );
    outputTemp = await createTempFile("youtube-mux");
    let target: any;
    if (outputTemp) {
      outputWritable = await outputTemp.handle.createWritable();
      target = new module.StreamTarget(outputWritable, {
        chunked: true,
        chunkSize: 8 * 1024 * 1024,
      });
    } else target = new module.BufferTarget();
    output = new module.Output({
      format: new module.Mp4OutputFormat({ fastStart: false }),
      target,
    });
    videoConversion = await module.Conversion.init({
      input: videoInput,
      output,
      tracks: "primary",
      audio: { discard: true },
      composable: true,
      showWarnings: false,
    });
    audioConversion = await module.Conversion.init({
      input: audioInput,
      output,
      tracks: "primary",
      video: { discard: true },
      composable: true,
      showWarnings: false,
    });
    if (
      !videoConversion.utilizedTracks?.length ||
      !audioConversion.utilizedTracks?.length
    )
      throw new Error("ترکیب Trackهای صوت و تصویر YouTube امکان‌پذیر نیست.");
    muxSignal.throwIfAborted();
    await output.start();
    const report = () =>
      onProgress({
        stage: "mux",
        loaded: 0,
        total: null,
        fraction: (videoProgress + audioProgress) / 2,
      });
    videoConversion.onProgress = (fraction: number) => {
      videoProgress = Math.max(videoProgress, Math.min(1, fraction));
      report();
    };
    audioConversion.onProgress = (fraction: number) => {
      audioProgress = Math.max(audioProgress, Math.min(1, fraction));
      report();
    };
    // Advance both tracks in lockstep so the muxer doesn't buffer minutes of one track.
    for (
      let until = 5;
      videoConversion.state !== "done" || audioConversion.state !== "done";
      until += 5
    ) {
      muxSignal.throwIfAborted();
      conversionTasks = [
        videoConversion.execute({ until }),
        audioConversion.execute({ until }),
      ];
      await Promise.all(conversionTasks);
    }
    if (muxSignal.aborted)
      throw muxSignal.reason || new DOMException("Aborted", "AbortError");
    await output.finalize();
    let blob: Blob;
    if (outputTemp) blob = await outputTemp.handle.getFile();
    else if (target.buffer)
      blob = new Blob([target.buffer], { type: "video/mp4" });
    else throw new Error("Mux تمام شد اما فایل MP4 تولید نشد.");
    const filename = `${
      title
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .trim()
        .slice(0, 140) || id
    }.mp4`;
    let cleaned = false;
    return {
      blob,
      filename,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await outputTemp?.remove();
      },
    };
  } catch (error) {
    muxController.abort(error);
    await Promise.allSettled(inputTasks);
    await Promise.allSettled(conversionTasks);
    await Promise.resolve(output?.cancel?.()).catch(() => undefined);
    await outputWritable?.abort(error).catch(() => undefined);
    await outputTemp?.remove();
    throw error;
  } finally {
    muxSignal.removeEventListener("abort", cancelConversions);
    videoInput?.dispose?.();
    audioInput?.dispose?.();
    for (const cleanup of inputCleanup) await cleanup();
  }
}

export function openMuxedBlobStream(
  result: MuxedMedia,
): ReadableStream<Uint8Array> {
  return streamWithCleanup(result.blob, result.cleanup);
}
