import { RoutedImage } from "@/components/common/RoutedAsset";
import { assetRoutes } from "@/lib/assetRoutes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Download,
  ExternalLink,
  FileJson,
  FileVideo,
  Image,
  LoaderCircle,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ActionButton } from "@/components/ui/action-button";
import { useYoutv } from "@/stores/useYoutv";
import type { WorkerProfile } from "@youtv/shared";
import { needsHttpsRelay, proxyUrl } from "@/lib/proxy";
import { mediaRoutingPolicy, withMediaWorkers, requireMediaCapability, mediaAssetUrls, openMediaAsset, mediaError, primeMediaStream } from "./services/mediaRoutes";
import {
  guessMediaKind,
  probeDirectMedia,
  type DirectProbe,
  type MediaKind,
} from "./services/mediaDetector";
import {
  parseYouTubeUrl,
  resolveYouTubePlaylist,
  loadMoreYouTubePlaylist,
  getYouTubeTranscript,
  resolveYouTubeVideo,
  openYouTubeDownload,
  muxYouTubeFormats,
  openMuxedBlobStream,
  type YouTubeFormat,
  type YouTubePlaylistItem,
  type YouTubeVideo,
} from "./services/youtube";
import { resolveYouTubePublicPreview, type YouTubePublicPreview } from "./services/youtubeFallback";
import { resolveInstagramPost, type InstagramPost } from "./services/instagram";
import {
  downloadStreamFactory,
  downloadZip,
  downloadZipLazy,
  type DownloadProgress,
  type ZipEntrySource,
} from "./services/download";
import { buildHlsArchiveEntries } from "./services/hlsDownload";
import { buildDashArchiveEntries } from "./services/dashDownload";
import { convertToBrowserMp4 } from "./services/conversion";
import MediaPlayer from "./components/MediaPlayer";
import MediaRouteControl from "./components/MediaRouteControl";
import SelectedYouTubePlayer from "./components/SelectedYouTubePlayer";
import { chooseYouTubeAudio } from "./services/youtubePlayback";
import "./media-center.css";

type PlaylistData = {
  id: string;
  title: string;
  author: string;
  items: YouTubePlaylistItem[];
  truncated: boolean;
};
type Target =
  | { type: "youtube"; video: YouTubeVideo }
  | { type: "youtube-playlist"; playlist: PlaylistData }
  | { type: "youtube-preview"; preview: YouTubePublicPreview }
  | { type: "instagram"; post: InstagramPost }
  | { type: "direct"; url: string; probe: DirectProbe | null; kind: MediaKind };
type Job = {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "handed-off" | "error" | "cancelled";
  progress: DownloadProgress | null;
  message: string;
  createdAt: number;
};
type JobTask = (
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal,
) => Promise<void | string>;
type QueuedJob = {
  id: string;
  name: string;
  task: JobTask;
  resolve: () => void;
};
const isYoutubeHost = (host: string) =>
  [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "music.youtube.com",
  ].includes(host.toLowerCase());
const isInstagramHost = (host: string) =>
  ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
    host.toLowerCase(),
  );
const cleanFilename = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 140) || "media";
function formatExtension(format: YouTubeFormat): string {
  return format.mimeType.includes("webm")
    ? "webm"
    : format.mimeType.includes("audio/")
      ? format.mimeType.includes("mp4")
        ? "m4a"
        : "webm"
      : "mp4";
}
function selectCombinedFormat(
  formats: YouTubeFormat[],
  quality = "best",
): YouTubeFormat | undefined {
  const candidates = formats.filter(
    (format) =>
      format.kind === "combined" &&
      (format.mimeType.includes("mp4") || format.mimeType.includes("webm")),
  );
  if (!candidates.length) return undefined;
  if (quality === "best")
    return [...candidates].sort(
      (a, b) => b.height - a.height || b.bitrate - a.bitrate,
    )[0];
  const max = Number(quality) || 1080;
  return (
    [...candidates]
      .filter((format) => format.height <= max)
      .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)[0] ||
    [...candidates].sort((a, b) => a.height - b.height)[0]
  );
}
function progressLabel(progress: DownloadProgress | null, fa: boolean): string {
  if (!progress) return "";
  if (progress.percent !== undefined)
    return `${progress.percent.toFixed(0)}%${progress.processedSeconds ? ` · ${progress.processedSeconds.toFixed(1)} s` : ""}`;
  if (progress.handoff)
    return fa
      ? "دانلود به مرورگر واگذار شد؛ ادامه را از نوار دانلود مرورگر دنبال کن."
      : "Download handed to the browser; follow progress in the browser downloads panel.";
  if (progress.total)
    return `${(progress.loaded / 1024 / 1024).toFixed(1)} / ${(progress.total / 1024 / 1024).toFixed(1)} MB`;
  return fa
    ? `${progress.item} از ${progress.items} مورد · ${(progress.loaded / 1024 / 1024).toFixed(1)} MB`
    : `Item ${progress.item}/${progress.items} · ${(progress.loaded / 1024 / 1024).toFixed(1)} MB`;
}
function YouTubeDashPreview({
  manifest,
  title,
  videoId,
  worker,
  allowDirect,
  onFailure,
  fa,
}: {
  manifest: string;
  title: string;
  videoId: string;
  worker?: WorkerProfile;
  allowDirect: boolean;
  onFailure: () => void;
  fa: boolean;
}) {
  const [src, setSrc] = useState("");
  const [dashFailed, setDashFailed] = useState(false);
  useEffect(() => {
    setDashFailed(false);
    if (!manifest) {
      setSrc("");
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([manifest], { type: "application/dash+xml" }),
    );
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [manifest]);
  if (!manifest || dashFailed) {
    if (!allowDirect) return <div className="media-inline-warning"><span>{fa ? "پیش‌نمایش DASH در دسترس نیست؛ فرمت‌های قابل دانلود را بررسی کن یا مسیر دیگری انتخاب کن." : "DASH preview unavailable. Try another Worker or an available download format."}</span><Button size="sm" variant="outline" onClick={onFailure}>{fa ? "تلاش با Worker دیگر" : "Try another Worker"}</Button></div>;
    return (
      <div className="media-embed">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  if (!src) return null;
  return (
    <MediaPlayer
      src={src}
      sourceUrl={`https://www.youtube.com/watch?v=${videoId}`}
      kind="dash"
      worker={worker}
      title={title}
      onError={() => { setDashFailed(true); onFailure(); }}
    />
  );
}

function YouTubeRestrictedPreview({ preview, imageUrls, allowDirect, loading, onRetry, fa }: {
  imageUrls: string[];
  preview: YouTubePublicPreview;
  allowDirect: boolean;
  loading: boolean;
  onRetry: () => void;
  fa: boolean;
}) {
  const [directRequested, setDirectRequested] = useState(false);
  const title = preview.metadata?.title || (preview.source.kind === "video"
    ? (fa ? "ویدئوی یوتیوب" : "YouTube video")
    : (fa ? "پلی‌لیست یوتیوب" : "YouTube playlist"));
  return (
    <section className="panel-card media-detail-card">
      <div className="media-result-heading">
        {preview.metadata?.thumbnail && <RoutedImage urls={imageUrls} alt="" />}
        <div>
          <span className="media-provider">YOUTUBE · {preview.metadata ? "PUBLIC METADATA" : "PREVIEW"}</span>
          <h2>{title}</h2>
          {preview.metadata?.author && <p>{preview.metadata.author}</p>}
        </div>
      </div>
      <div className="media-inline-warning" role="status">
        <AlertCircle size={18} />
        <span>{preview.reason === "bot-check"
          ? (fa ? "YouTube درخواست استخراج را با بررسی ضدربات رد کرد. همه Workerهای انتخاب‌شده برای استخراج امتحان شده‌اند؛ دانلود تا دریافت فرمت واقعی در دسترس نیست." : "YouTube rejected extraction with a bot check. All selected extraction routes were tried; downloads require real media formats.")
          : (fa ? "استخراج فرمت‌های رسانه موفق نبود. این نتیجه فقط پیش‌نمایش است و دانلود در دسترس نیست." : "Media format extraction failed. This is a preview only; downloading is unavailable.")}</span>
      </div>
      {preview.detail && <p className="muted" role="status">{preview.detail}</p>}
      {(allowDirect || directRequested) ? (
        <>
          <p className="media-inline-warning">{fa ? "پلیر رسمی YouTube مستقیماً از مرورگر بارگیری می‌شود، نه از Worker. ممکن است به شبکه قابل دسترسی یا اجازه Embed نیاز داشته باشد." : "The official YouTube player connects directly from your browser, not through the Worker. Network access and embedding permission may be required."}</p>
          <div className="media-embed">
            <iframe src={preview.embedUrl} title={title} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
          </div>
        </>
      ) : (
        <p className="media-inline-warning">{fa ? "اتصال مستقیم غیرفعال است. در صورت دسترسی، می‌توانی فقط برای این رسانه پلیر رسمی را باز کنی." : "Direct access is off. You may explicitly open the official player for this item only."}</p>
      )}
      <div className="media-list-actions media-preview-actions">
        {!allowDirect && !directRequested && <Button variant="outline" onClick={() => setDirectRequested(true)}><Clapperboard size={16} />{fa ? "پخش مستقیم این رسانه" : "Play this item directly"}</Button>}
        <Button disabled={loading} onClick={onRetry}><Search size={16} />{fa ? "تلاش مجدد استخراج" : "Retry extraction"}</Button>
        <Button variant="outline" asChild><a href={preview.canonicalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />{fa ? "بازکردن در YouTube" : "Open in YouTube"}</a></Button>
      </div>
      {preview.detail && <details className="media-preview-details"><summary>{fa ? "جزئیات خطا" : "Error details"}</summary><p>{preview.detail}</p></details>}
    </section>
  );
}

function mediaKindLabel(kind: MediaKind, fa: boolean): string {
  const labels: Record<MediaKind, [string, string]> = {
    "youtube-video": ["YouTube video", "ویدئوی یوتیوب"],
    "youtube-playlist": ["YouTube playlist", "پلی‌لیست یوتیوب"],
    "instagram-post": ["Instagram post", "پست اینستاگرام"],
    hls: ["HLS stream", "استریم HLS"],
    dash: ["MPEG-DASH stream", "استریم MPEG-DASH"],
    video: ["Video file", "فایل ویدئویی"],
    audio: ["Audio file", "فایل صوتی"],
    image: ["Image", "تصویر"],
    document: ["PDF document", "سند PDF"],
    file: ["Media file", "فایل رسانه‌ای"],
    unknown: ["Unknown media", "رسانه ناشناخته"],
  };
  return labels[kind][fa ? 1 : 0];
}
export default function MediaCenterPage() {
  const settings = useYoutv((state) => state.settings),
    workers = useYoutv((state) => state.workers);
  const fa = settings.language === "fa";
  const automaticFallback = settings.mediaWorkerFallback;
  const directMode = settings.mediaRouteMode === "direct";
  const { candidates, allowDirect } = useMemo(() => mediaRoutingPolicy(workers, settings), [workers, settings.mediaRouteMode, settings.mediaWorkerId, settings.defaultWorkerId, settings.mediaWorkerFallback, settings.mediaDirectFallback]);
  const [resolvedWorkerId, setResolvedWorkerId] = useState<string | null>(null);
  const previewTried = useRef(new Set<string>());
  const previewRetrying = useRef(false);
  const resolutionGeneration = useRef(0);
  const worker = resolvedWorkerId === "" ? undefined : candidates.find(item => item.id === resolvedWorkerId) || candidates[0];
  const activeCandidates = useMemo(() => worker ? [worker, ...candidates.filter(item => item.id !== worker.id)] : candidates, [worker, candidates]);
  const allowAssetDirect = allowDirect;
  const imageUrls = (url?: string) => assetRoutes(url, activeCandidates, allowAssetDirect, undefined, workers);
  const openAsset = (url: string, filename: string, signal?: AbortSignal) => {
    const urls = mediaAssetUrls(url, activeCandidates, allowAssetDirect, filename);
    if (resolvedWorkerId === "" && urls.includes(url)) return openMediaAsset([url, ...urls.filter(item => item !== url)], signal);
    return openMediaAsset(urls, signal);
  };
  const openYoutube = async (id: string, itag: number, signal?: AbortSignal) => (await withMediaWorkers(activeCandidates, async candidate => {
    const opened = await openYouTubeDownload(candidate, id, itag);
    return primeMediaStream(opened.stream, signal);
  }, signal)).value;
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [quality, setQuality] = useState("best");
  const [selectedFormat, setSelectedFormat] = useState<number | null>(null);
  const [showYoutubeFormats, setShowYoutubeFormats] = useState(false);
  const [playSelectedFormat, setPlaySelectedFormat] = useState(false);
  const [combineYoutubeAudio, setCombineYoutubeAudio] = useState(true);
  const [captionLanguages, setCaptionLanguages] = useState<string[]>([]);
  const [captionLanguage, setCaptionLanguage] = useState("");
  const [loadingPlaylistMore, setLoadingPlaylistMore] = useState(false);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [playingInstagram, setPlayingInstagram] = useState("");
  const [instagramRouteIndex, setInstagramRouteIndex] = useState(0);
  const [jobs, setJobs] = useState<Job[]>(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("youtv-media-download-history") || "[]",
        ) as Job[]
      )
        .slice(0, 30)
        .map((item) =>
          item.status === "running" || item.status === "queued"
            ? {
                ...item,
                status: "cancelled",
                message: "Interrupted by page reload",
              }
            : item,
        );
    } catch {
      return [];
    }
  });
  const queueRef = useRef<QueuedJob[]>([]);
  const activeRef = useRef(false);
  const controllersRef = useRef(new Map<string, AbortController>());
  const [directName, setDirectName] = useState("");
  const [convertedPreviewUrl, setConvertedPreviewUrl] = useState("");
  const [convertedFilename, setConvertedFilename] = useState("media.mp4");
  const previewCleanupRef = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );
  const clearConvertedPreview = () => {
    setConvertedPreviewUrl("");
    const cleanup = previewCleanupRef.current;
    previewCleanupRef.current = undefined;
    if (cleanup) void cleanup();
  };

  const historyKey = jobs
    .map((item) => `${item.id}:${item.status}:${item.name}`)
    .join("|");
  useEffect(
    () => () => {
      if (convertedPreviewUrl) URL.revokeObjectURL(convertedPreviewUrl);
    },
    [convertedPreviewUrl],
  );
  useEffect(
    () => () => {
      const cleanup = previewCleanupRef.current;
      if (cleanup) void cleanup();
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem(
        "youtv-media-download-history",
        JSON.stringify(
          jobs.slice(0, 20).map((item) => ({ ...item, progress: null })),
        ),
      );
    } catch {
      /* storage may be unavailable */
    }
  }, [historyKey]);
  useEffect(
    () => () => {
      for (const controller of controllersRef.current.values())
        controller.abort();
      for (const queued of queueRef.current.splice(0)) queued.resolve();
    },
    [],
  );
  const processQueue = async () => {
    if (activeRef.current) return;
    const queued = queueRef.current.shift();
    if (!queued) return;
    activeRef.current = true;
    const controller = new AbortController();
    controllersRef.current.set(queued.id, controller);
    const update = (patch: Partial<Job>) =>
      setJobs((current) =>
        current.map((item) =>
          item.id === queued.id ? { ...item, ...patch } : item,
        ),
      );
    update({
      status: "running",
      message: fa ? "در حال آماده‌سازی" : "Preparing",
    });
    try {
      let handedOff = false;
      const completion = await queued.task((progress) => {
        handedOff ||= Boolean(progress.handoff);
        update({
          progress,
          message: progress.handoff
            ? fa
              ? "دانلود به مرورگر واگذار شد"
              : "Download handed to browser"
            : progressLabel(progress, fa),
        });
      }, controller.signal);
      controller.signal.throwIfAborted();
      update({
        status: handedOff ? "handed-off" : "done",
        message:
          completion ||
          (handedOff
            ? fa
              ? "به دانلود منیجر مرورگر واگذار شد؛ پایان دانلود تأیید نشده است."
              : "Handed to browser; completion is not verified."
            : fa
              ? "عملیات تکمیل شد"
              : "Completed"),
      });
    } catch (cause) {
      const message = mediaError(cause);
      const cancelled =
        controller.signal.aborted ||
        (cause instanceof Error && cause.name === "AbortError");
      update({
        status: cancelled ? "cancelled" : "error",
        message: cancelled ? (fa ? "لغو شد" : "Cancelled") : message,
      });
    } finally {
      controllersRef.current.delete(queued.id);
      activeRef.current = false;
      queued.resolve();
      void processQueue();
    }
  };
  const runJob = (name: string, task: JobTask): Promise<void> =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      setJobs((current) => [
        {
          id,
          name,
          status: "queued" as const,
          progress: null,
          message: fa ? "در صف دانلود" : "Queued",
          createdAt: Date.now(),
        },
        ...current.filter(
          (item) => item.status === "queued" || item.status === "running",
        ),
        ...current
          .filter(
            (item) => item.status !== "queued" && item.status !== "running",
          )
          .slice(0, 30),
      ]);
      queueRef.current.push({ id, name, task, resolve });
      void processQueue();
    });
  const cancelJob = (id: string) => {
    const controller = controllersRef.current.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    const index = queueRef.current.findIndex((item) => item.id === id);
    if (index >= 0) {
      const [removed] = queueRef.current.splice(index, 1);
      setJobs((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "cancelled",
                message: fa ? "لغو شد" : "Cancelled",
              }
            : item,
        ),
      );
      removed?.resolve();
    }
  };
  const resolve = async (sourceUrl = input) => {
    const raw = sourceUrl.trim();
    if (!raw || loading) return;
    setInput(raw);
    setLoading(true);
    resolutionGeneration.current++;
    previewTried.current.clear();
    setResolvedWorkerId(null);
    setError("");
    setTarget(null);
    setCaptionLanguages([]);
    setCaptionLanguage("");
    setShowYoutubeFormats(false);
    setPlaySelectedFormat(false);
    setPlayingInstagram("");
    setInstagramRouteIndex(0);
    clearConvertedPreview();
    try {
      const parsed = new URL(raw);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw new Error(
          "آدرس رسانه باید HTTP(S) معتبر و بدون اطلاعات ورود داخل URL باشد.",
        );
      if (isYoutubeHost(parsed.hostname)) {
        const source = parseYouTubeUrl(raw);
        try {
          if (directMode) throw new Error(fa ? "حالت مستقیم: استخراج فرمت‌های YouTube به‌دلیل محدودیت CORS مرورگر ممکن است در دسترس نباشد." : "Direct mode: YouTube format extraction may be unavailable due to browser CORS.");
          if (source.kind === "playlist") {
            const { worker: selected, value: playlist } = await withMediaWorkers(candidates, candidate => resolveYouTubePlaylist(candidate, source.id, 500));
            setResolvedWorkerId(selected.id);
            setTarget({ type: "youtube-playlist", playlist });
            setSelectedItems(playlist.items.map((item) => item.id));
          } else {
            const { worker: selected, value: video } = await withMediaWorkers(candidates, candidate => resolveYouTubeVideo(candidate, source.id));
            setResolvedWorkerId(selected.id);
            setTarget({ type: "youtube", video });
            const best =
              selectCombinedFormat(video.formats) ||
              [...video.formats]
                .filter((item) => item.kind === "video")
                .sort(
                  (a, b) => b.height - a.height || b.bitrate - a.bitrate,
                )[0] ||
              video.formats.find((item) => item.kind === "audio");
            setSelectedFormat(best?.itag ?? null);
            setCombineYoutubeAudio(true);
          }
        } catch (cause) {
          const preview = await resolveYouTubePublicPreview(source, candidates, cause, undefined, allowDirect);
          setResolvedWorkerId(preview.metadataWorkerId);
          setSelectedFormat(null);
          setTarget({ type: "youtube-preview", preview });
        }
      } else if (isInstagramHost(parsed.hostname)) {
        try {
          const { worker: selected, value: post } = await withMediaWorkers(candidates, async candidate => {
            await requireMediaCapability(candidate, "instagramPublicRelay");
            return resolveInstagramPost(candidate, raw);
          });
          setResolvedWorkerId(selected.id);
          setTarget({ type: "instagram", post });
          setSelectedAssets(post.assets.map(asset => asset.id));
        } catch (cause) {
          if (!allowDirect) throw cause;
          const path = parsed.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
          if (!path) throw new Error("Invalid Instagram post URL");
          setResolvedWorkerId("");
          setTarget({ type: "instagram", post: { url: `https://www.instagram.com/${path[1]}/${path[2]}/`, author: "", caption: "", thumbnail: "", assets: [] } });
          setSelectedAssets([]);
        }
      } else {
        const normalized = parsed.toString();
        let probe: DirectProbe | null = null;
        if (candidates.length) {
          try {
            const result = await withMediaWorkers(candidates, candidate => probeDirectMedia(normalized, candidate));
            probe = result.value;
            setResolvedWorkerId(result.worker.id);
          } catch (cause) {
            if (!allowDirect || needsHttpsRelay(normalized)) throw cause;
            setResolvedWorkerId("");
          }
        } else {
          if (!allowAssetDirect || needsHttpsRelay(normalized)) throw new Error("Media requires an active compatible Worker or explicit direct fallback");
          setResolvedWorkerId("");
        }
        const kind = probe?.kind || guessMediaKind(normalized);
        setTarget({ type: "direct", url: normalized, probe, kind });
        setDirectName(
          probe?.filename ||
            decodeURIComponent(parsed.pathname.split("/").at(-1) || "") ||
            "media",
        );
      }
    } catch (cause) {
      setError(
        mediaError(cause),
      );
    } finally {
      setLoading(false);
    }
  };

  const retryYoutubePreview = async (video: YouTubeVideo) => {
    if (!automaticFallback || previewRetrying.current) return;
    if (worker) previewTried.current.add(worker.id);
    const remaining = activeCandidates.filter(candidate => !previewTried.current.has(candidate.id));
    if (!remaining.length) return;
    const generation = resolutionGeneration.current;
    previewRetrying.current = true;
    try {
      const { worker: selected, value: next } = await withMediaWorkers(remaining, async candidate => {
        previewTried.current.add(candidate.id);
        const value = await resolveYouTubeVideo(candidate, video.id);
        if (!value.dashManifest) throw new Error("No DASH manifest available");
        return value;
      });
      if (resolutionGeneration.current !== generation) return;
      setResolvedWorkerId(selected.id);
      setTarget({ type: "youtube", video: next });
      setSelectedFormat(current => next.formats.some(format => format.itag === current) ? current : selectCombinedFormat(next.formats)?.itag ?? next.formats[0]?.itag ?? null);
    } catch (cause) {
      if (resolutionGeneration.current === generation) setError(mediaError(cause));
    } finally { previewRetrying.current = false; }
  };

  const downloadYoutube = async (video: YouTubeVideo, itag: number) => {
    if (!worker) return;
    const format = video.formats.find((item) => item.itag === itag);
    if (!format)
      throw new Error("Selected YouTube format is no longer available");
    const filename = `${cleanFilename(video.title)}.${formatExtension(format)}`;
    const audioFormat = chooseYouTubeAudio(video.formats, format, combineYoutubeAudio);
    if (audioFormat) {
      const muxFilename = `${cleanFilename(video.title)}.mp4`;
      await runJob(muxFilename, async (onProgress, signal) =>
        downloadStreamFactory(
          async () => {
            const { value: muxed } = await withMediaWorkers(activeCandidates, candidate => muxYouTubeFormats(
              candidate,
              video.id,
              format.itag,
              audioFormat.itag,
              video.title,
              (value) =>
                onProgress({
                  loaded: value.loaded,
                  total: value.total,
                  item: 1,
                  items: 1,
                  filename: muxFilename,
                  percent:
                    value.fraction !== undefined
                      ? value.fraction * 100
                      : undefined,
                }),
              signal,
            ), signal);
            return openMuxedBlobStream(muxed);
          },
          muxFilename,
          null,
          onProgress,
          signal,
        ),
      );
      return;
    }
    await runJob(filename, async (onProgress, signal) =>
      downloadStreamFactory(
        () => openYoutube(video.id, itag, signal),
        filename,
        format.size,
        onProgress,
        signal,
      ),
    );
  };
  const downloadYoutubeThumbnail = async (video: YouTubeVideo) => {
    if (!worker || !video.thumbnail) return;
    const extension =
      (new URL(video.thumbnail).pathname.split(".").at(-1) || "jpg")
        .replace(/[^a-z0-9]/gi, "")
        .toLowerCase() || "jpg";
    const filename = `${cleanFilename(video.title)}-thumbnail.${extension}`;
    await runJob(filename, (onProgress, signal) =>
      downloadStreamFactory(() => openAsset(video.thumbnail, filename, signal), filename, null, onProgress, signal),
    );
  };
  const downloadYoutubeMetadata = async (video: YouTubeVideo) => {
    const filename = `${cleanFilename(video.title)}-metadata.json`;
    const metadata = {
      id: video.id,
      title: video.title,
      author: video.author,
      description: video.description,
      viewCount: video.views,
      publishDate: video.publishDate,
      isLive: video.isLive,
      duration: video.duration,
      canonicalUrl: video.canonicalUrl,
      formats: video.formats,
    };
    const blob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    await runJob(filename, (onProgress, signal) =>
      downloadStreamFactory(
        async () => blob.stream() as ReadableStream<Uint8Array>,
        filename,
        blob.size,
        onProgress,
        signal,
      ),
    );
  };
  const downloadYoutubeTranscript = async (video: YouTubeVideo) => {
    if (!worker) return;
    const filename = `${cleanFilename(video.title)}.${captionLanguage || "auto"}.vtt`;
    await runJob(filename, async (onProgress, signal) => {
      const { value: transcript } = await withMediaWorkers(activeCandidates, candidate => getYouTubeTranscript(candidate, video.id, captionLanguage), signal);
      setCaptionLanguages(transcript.languages);
      if (!captionLanguage) setCaptionLanguage(transcript.language);
      const blob = new Blob([transcript.vtt], {
        type: "text/vtt;charset=utf-8",
      });
      return downloadStreamFactory(
        async () => blob.stream() as ReadableStream<Uint8Array>,
        filename,
        blob.size,
        onProgress,
        signal,
      );
    });
  };
  const loadPlaylistMore = async (playlist: PlaylistData) => {
    if (!worker || loadingPlaylistMore) return;
    setLoadingPlaylistMore(true);
    setError("");
    try {
      const { worker: selected, value: result } = await withMediaWorkers(activeCandidates, candidate => loadMoreYouTubePlaylist(candidate, playlist.id, playlist.items.map(item => item.id), 500));
      setResolvedWorkerId(selected.id);
      if (!result.items.length) {
        setTarget({
          type: "youtube-playlist",
          playlist: { ...playlist, truncated: false },
        });
        return;
      }
      const updated = {
        ...playlist,
        items: [...playlist.items, ...result.items],
        truncated: result.truncated,
      };
      setTarget({ type: "youtube-playlist", playlist: updated });
      setSelectedItems((current) => [
        ...new Set([...current, ...result.items.map((item) => item.id)]),
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load more playlist items",
      );
    } finally {
      setLoadingPlaylistMore(false);
    }
  };
  const downloadYoutubePlaylist = async (playlist: PlaylistData) => {
    if (!worker) return;
    const chosen = playlist.items.filter((item) =>
      selectedItems.includes(item.id),
    );
    if (!chosen.length) {
      setError(
        fa ? "حداقل یک ویدئو را انتخاب کن." : "Select at least one video.",
      );
      return;
    }
    const archiveName = `${cleanFilename(playlist.title)}.zip`;
    await runJob(archiveName, (onProgress, signal) =>
      downloadZipLazy(
        async (buildSignal) => {
          const entries: ZipEntrySource[] = [];
          for (const item of chosen) {
            if (buildSignal?.aborted)
              throw (
                buildSignal.reason || new DOMException("Aborted", "AbortError")
              );
            const { worker: itemWorker, value: video } = await withMediaWorkers(activeCandidates, candidate => resolveYouTubeVideo(candidate, item.id, false), buildSignal);
            const combined = selectCombinedFormat(video.formats, quality);
            if (combined) {
              entries.push({
                filename: `${cleanFilename(item.title)}.${formatExtension(combined)}`,
                open: (signal) => openYoutube(item.id, combined.itag, signal),
              });
              continue;
            }
            const max = quality === "best" ? Infinity : Number(quality) || 1080;
            const videoOnly = video.formats
              .filter(
                (format) => format.kind === "video" && format.height <= max,
              )
              .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)[0];
            const audioOnly = video.formats
              .filter((format) => format.kind === "audio")
              .sort((a, b) => b.bitrate - a.bitrate)[0];
            if (videoOnly && audioOnly) {
              entries.push({
                filename: `${cleanFilename(item.title)}.mp4`,
                open: async (signal) => {
                  const { value: muxed } = await withMediaWorkers([itemWorker, ...activeCandidates.filter(candidate => candidate.id !== itemWorker.id)], candidate => muxYouTubeFormats(
                    candidate,
                    item.id,
                    videoOnly.itag,
                    audioOnly.itag,
                    item.title,
                    () => {},
                    signal,
                  ), signal);
                  return openMuxedBlobStream(muxed);
                },
              });
            } else if (videoOnly)
              entries.push({
                filename: `${cleanFilename(item.title)}-video-only.${formatExtension(videoOnly)}`,
                open: (signal) => openYoutube(item.id, videoOnly.itag, signal),
              });
            else if (audioOnly)
              entries.push({
                filename: `${cleanFilename(item.title)}-audio-only.${formatExtension(audioOnly)}`,
                open: (signal) => openYoutube(item.id, audioOnly.itag, signal),
              });
            else
              throw new Error(
                `${item.title}: no downloadable non-DRM formats were exposed by YouTube`,
              );
          }
          return entries;
        },
        archiveName,
        onProgress,
        signal,
      ),
    );
  };
  const downloadInstagramAsset = async (
    asset: InstagramPost["assets"][number],
  ) => {
    if (!worker) return;
    await runJob(asset.filename, (onProgress, signal) =>
      downloadStreamFactory(() => openAsset(asset.url, asset.filename, signal), asset.filename, null, onProgress, signal),
    );
  };
  const downloadInstagram = async (post: InstagramPost) => {
    if (!worker) return;
    const chosen = post.assets.filter((asset) =>
      selectedAssets.includes(asset.id),
    );
    if (!chosen.length) {
      setError(
        fa ? "حداقل یک رسانه را انتخاب کن." : "Select at least one media item.",
      );
      return;
    }
    const archiveName = `${cleanFilename(post.author || "instagram-post")}.zip`;
    const entries: ZipEntrySource[] = chosen.map((asset, index) => ({
      filename: `${String(index + 1).padStart(2, "0")}-${cleanFilename(asset.filename)}`,
      open: (signal) =>
        openAsset(asset.url, asset.filename, signal),
    }));
    await runJob(archiveName, (onProgress, signal) =>
      downloadZip(entries, archiveName, onProgress, signal),
    );
  };
  const convertDirect = async (
    targetValue: Extract<Target, { type: "direct" }>,
  ) => {
    if (!worker && !allowDirect) return;
    const kind = targetValue.kind === "hls" ? "hls" : "video";
    const filename = `${cleanFilename(new URL(targetValue.url).pathname.split("/").at(-1) || "media").replace(/\.[^.]+$/, "")}.mp4`;
    await runJob(filename, async (onProgress, signal) => {
      const result = await convertToBrowserMp4(
        targetValue.url,
        worker,
        kind,
        (fraction, processedSeconds) =>
          onProgress({
            loaded: fraction * 100,
            total: 100,
            item: 1,
            items: 1,
            filename,
            percent: fraction * 100,
            processedSeconds,
          }),
        signal,
      );
      if (result.blob) {
        clearConvertedPreview();
        previewCleanupRef.current = result.cleanup;
        setConvertedFilename(result.filename);
        setConvertedPreviewUrl(URL.createObjectURL(result.blob));
        return fa
          ? "MP4 آماده شد؛ پخش و دانلود فایل تبدیل‌شده در همین صفحه فعال است."
          : "MP4 ready; preview and download are available on this page.";
      }
      return fa
        ? "فایل MP4 مستقیماً روی دیسک ذخیره شد."
        : "MP4 was saved directly to disk.";
    });
  };

  const archiveWithRoutes = async <T,>(action: (candidate: WorkerProfile | undefined) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (activeCandidates.length) {
      try { return (await withMediaWorkers(activeCandidates, action, signal)).value; }
      catch (error) { signal?.throwIfAborted(); if (!allowDirect) throw error; }
    }
    if (!allowDirect) throw new Error("No usable media route");
    return action(undefined);
  };
  const downloadDirect = async (
    targetValue: Extract<Target, { type: "direct" }>,
  ) => {
    if (!activeCandidates.length && !allowDirect && (targetValue.kind === "hls" || targetValue.kind === "dash")) {
      setError(fa ? "برای آرشیو HLS/DASH یک مسیر فعال انتخاب کن." : "Select an available route for HLS/DASH archiving.");
      return;
    }
    if (targetValue.kind === "hls") {
      const stem = cleanFilename(
        (
          new URL(targetValue.url).pathname.split("/").at(-1) || "hls-stream"
        ).replace(/\.(?:m3u8?|m3u)$/i, ""),
      );
      const archiveName = `${stem}-hls.zip`;
      let liveSnapshot = false;
      await runJob(archiveName, async (onProgress, signal) => {
        await downloadZipLazy(
          async (buildSignal) => {
            const result = await archiveWithRoutes(candidate => buildHlsArchiveEntries(targetValue.url, candidate, buildSignal, activeCandidates), buildSignal);
            liveSnapshot = result.liveSnapshot;
            return result.entries;
          },
          archiveName,
          onProgress,
          signal,
        );
        return liveSnapshot
          ? fa
            ? "پنجره فعلی استریم زنده به‌صورت ZIP ذخیره شد؛ این ضبط کامل پخش نیست."
            : "The currently advertised live window was saved as a ZIP snapshot, not a full recording."
          : fa
            ? "آرشیو HLS ذخیره شد."
            : "HLS archive saved.";
      });
      return;
    }
    if (targetValue.kind === "dash") {
      const archiveName = `${cleanFilename(new URL(targetValue.url).pathname.split("/").at(-1) || "dash-stream")}-dash.zip`;
      await runJob(archiveName, (onProgress, signal) =>
        downloadZipLazy(
          async () =>
            (await archiveWithRoutes(candidate => buildDashArchiveEntries(targetValue.url, candidate, signal, activeCandidates), signal)).entries,
          archiveName,
          onProgress,
          signal,
        ),
      );
      return;
    }
    const filename = cleanFilename(
      directName ||
        targetValue.probe?.filename ||
        new URL(targetValue.url).pathname.split("/").at(-1) ||
        "media",
    );
    await runJob(filename, (onProgress, signal) =>
      downloadStreamFactory(() => openAsset(targetValue.url, filename, signal), filename, targetValue.probe?.contentLength || null, onProgress, signal),
    );
  };

  const youtubeVideo = target?.type === "youtube" ? target.video : null;
  const youtubePlaylist =
    target?.type === "youtube-playlist" ? target.playlist : null;
  const instagramPost = target?.type === "instagram" ? target.post : null;
  const direct = target?.type === "direct" ? target : null;
  const currentFormat = youtubeVideo?.formats.find(
    (item) => item.itag === selectedFormat,
  );
  const selectedAudio = chooseYouTubeAudio(youtubeVideo?.formats || [], currentFormat, combineYoutubeAudio);
  const linkedPlaylistUrl = (() => {
    try {
      const source = parseYouTubeUrl(input, true);
      return source.kind === "playlist" && source.videoId ? `https://www.youtube.com/playlist?list=${encodeURIComponent(source.id)}` : "";
    } catch { return ""; }
  })();
  const directPreviewAllowed = Boolean(worker) || allowAssetDirect;
  const retryDirectPreview = () => {
    if (!direct) return;
    const current = worker?.id || "";
    if (previewTried.current.has(current)) return;
    previewTried.current.add(current);
    const next = candidates.find(candidate => !previewTried.current.has(candidate.id));
    if (next && automaticFallback) { setResolvedWorkerId(next.id); return; }
    if (allowDirect && current && !previewTried.current.has("") && !needsHttpsRelay(direct.url)) { setResolvedWorkerId(""); return; }
    setError(fa ? "پخش رسانه در مسیرهای موجود موفق نبود؛ اتصال، نوع فایل یا کدک را بررسی کن." : "Media playback failed on the available routes. Check connectivity, format or codec.");
  };
  const directProxy =
    direct && worker
      ? proxyUrl(direct.url, worker, "proxy", direct.kind === "hls")
      : directPreviewAllowed ? direct?.url || "" : "";
  const dashProxy =
    direct && worker
      ? (() => {
          const value = new URL(proxyUrl(direct.url, worker));
          value.searchParams.set("dash", "1");
          return value.toString();
        })()
      : directPreviewAllowed ? direct?.url || "" : "";
  const toggle = (
    values: string[],
    value: string,
    update: (next: string[]) => void,
  ) =>
    update(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    );

  return (
    <section className="page-content media-center-page">
      <div className="page-heading media-center-heading">
        <div>
          <div className="eyebrow">ONLINE MEDIA CENTER</div>
          <h1>
            <Clapperboard size={27} />
            {fa ? "مرکز رسانه" : "Media Center"}
          </h1>
          <p>
            {fa
              ? "پخش، استخراج اطلاعات و دانلود رسانه از YouTube، Instagram و لینک‌های مستقیم با اتصال مستقیم یا Cloudflare Worker"
              : "Resolve, play and download media from YouTube, Instagram and direct URLs directly or through your Cloudflare Worker."}
          </p>
        </div>
      </div>
      <div className="panel-card media-resolver-card">
        <label htmlFor="media-url-input">
          {fa ? "آدرس رسانه یا Playlist" : "Media or playlist URL"}
        </label>
        <div className="media-url-row">
          <Input
            id="media-url-input"
            dir="ltr"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event: { key: string }) => {
              if (event.key === "Enter") void resolve();
            }}
            placeholder="YouTube, Instagram, .mp4, .mkv, .m3u8, .mpd …"
            inputMode="url"
          />
          <Button
            onClick={() => void resolve()}
            disabled={!input.trim() || loading}
          >
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Search size={17} />
            )}{" "}
            {fa ? "بررسی لینک" : "Resolve URL"}
          </Button>
        </div>
        {linkedPlaylistUrl && <div className="media-actions"><Button variant="outline" size="sm" disabled={loading} onClick={() => void resolve(linkedPlaylistUrl)}>{fa ? "بررسی کل پلی‌لیست به‌جای ویدئو" : "Resolve entire playlist instead"}</Button></div>}
        <MediaRouteControl disabled={loading} onChange={() => {
          resolutionGeneration.current++; setResolvedWorkerId(null); setTarget(null); setPlayingInstagram(""); clearConvertedPreview();
        }} status={directMode ? (fa ? "اتصال مستقیم؛ بدون Worker" : "Direct connection; no Worker") : resolvedWorkerId === "" ? (fa ? "مسیر جایگزین: مستقیم" : "Fallback: direct") : worker ? `Worker: ${worker.name}` : (fa ? "Worker فعال موجود نیست" : "No active Worker")} />
        <div className="media-source-hints">
          <span>YouTube / Playlist</span>
          <span>Instagram Post / Reel</span>
          <span>MP4 · MKV · WEBM · MP3</span>
          <span>HLS · DASH</span>
        </div>
        {!worker && !directMode && (
          <p className="media-inline-warning">
            <AlertCircle size={15} />
            {fa
              ? "Worker فعالی برای این مسیر انتخاب نشده؛ فایل مستقیم فقط در صورت دسترسی و مجاز بودن CORS قابل دانلود است. استخراج پلتفرم‌ها معمولاً به Worker نیاز دارد."
              : "No active Worker is selected. Direct files require network access and CORS; platform extraction generally requires a Worker."}
          </p>
        )}
      </div>

      {error && (
        <div className="media-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <ActionButton onClick={() => setError("")} aria-label="Dismiss">
            <span>×</span>
          </ActionButton>
        </div>
      )}

      {target?.type === "youtube-preview" && (
        <YouTubeRestrictedPreview
          key={`${target.preview.source.kind}:${target.preview.source.id}`}
          preview={target.preview}
          imageUrls={imageUrls(target.preview.metadata?.thumbnail)}
          allowDirect={allowDirect}
          loading={loading}
          onRetry={() => void resolve(target.preview.canonicalUrl)}
          fa={fa}
        />
      )}

      {youtubeVideo && (
        <div className="media-result-grid">
          <section className="panel-card media-detail-card">
            <div className="media-result-heading">
              <RoutedImage urls={imageUrls(youtubeVideo.thumbnail)} alt="" />
              <div>
                <span className="media-provider">YOUTUBE VIDEO</span>
                <h2>{youtubeVideo.title}</h2>
                <p>
                  {youtubeVideo.author}
                  {youtubeVideo.duration
                    ? ` · ${Math.floor(youtubeVideo.duration / 60)}:${String(youtubeVideo.duration % 60).padStart(2, "0")}`
                    : ""}
                  {youtubeVideo.views !== null
                    ? ` · ${youtubeVideo.views.toLocaleString()} views`
                    : ""}
                  {youtubeVideo.publishDate
                    ? ` · ${youtubeVideo.publishDate}`
                    : ""}
                </p>
              </div>
            </div>
            {playSelectedFormat && currentFormat ? <SelectedYouTubePlayer
              key={`${youtubeVideo.id}:${currentFormat.itag}:${selectedAudio?.itag ?? "single"}`}
              workers={activeCandidates} videoId={youtubeVideo.id} itag={currentFormat.itag}
              audioItag={selectedAudio?.itag} title={youtubeVideo.title} fa={fa}
            /> : <YouTubeDashPreview
              manifest={youtubeVideo.dashManifest}
              title={youtubeVideo.title}
              videoId={youtubeVideo.id}
              worker={worker}
              allowDirect={allowDirect}
              onFailure={() => void retryYoutubePreview(youtubeVideo)}
              fa={fa}
            />}
            {playSelectedFormat && <Button variant="outline" size="sm" onClick={() => setPlaySelectedFormat(false)}>{fa ? "بازگشت به پخش خودکار" : "Return to automatic playback"}</Button>}
            {youtubeVideo.description && (
              <p className="media-description">{youtubeVideo.description}</p>
            )}
            <div className="media-format-row">
              <label htmlFor="youtube-format">
                {fa ? "کیفیت و فرمت پخش / دانلود" : "Playback / download format"}
              </label>
              <Select
                id="youtube-format"
                value={selectedFormat ?? ""}
                onChange={(event) =>
                  setSelectedFormat(Number(event.target.value))
                }
              >
                {youtubeVideo.formats.map((format) => (
                  <SelectOption key={format.itag} value={format.itag}>
                    {format.quality} · {format.mimeType.split(";")[0]} ·{" "}
                    {format.kind === "combined"
                      ? "Video + Audio"
                      : format.kind === "video"
                        ? "Video only"
                        : "Audio only"}
                    {format.size
                      ? ` · ${(format.size / 1024 / 1024).toFixed(1)} MB`
                      : ""}
                  </SelectOption>
                ))}
              </Select>
            </div>
            {captionLanguages.length > 0 && (
              <div className="media-format-row">
                <label htmlFor="youtube-caption-language">
                  {fa ? "زبان زیرنویس" : "Subtitle language"}
                </label>
                <Select
                  id="youtube-caption-language"
                  value={captionLanguage}
                  onChange={(event) => setCaptionLanguage(event.target.value)}
                >
                  {captionLanguages.map((language) => (
                    <SelectOption key={language} value={language}>
                      {language}
                    </SelectOption>
                  ))}
                </Select>
              </div>
            )}
            {currentFormat &&
              currentFormat.kind === "video" &&
              youtubeVideo.formats.some((item) => item.kind === "audio") && (
                <label className="media-combine-option">
                  <Checkbox
                    checked={combineYoutubeAudio}
                    onChange={(event) =>
                      setCombineYoutubeAudio(event.target.checked)
                    }
                  />
                  {fa
                    ? "همراه بهترین صدای موجود (پخش DASH / دانلود MP4)"
                    : "Include best available audio (DASH playback / MP4 download)"}
                </label>
              )}
            {currentFormat && currentFormat.kind !== "combined" && (
              <p className="media-inline-warning">
                <AlertCircle size={15} />
                {fa
                  ? "این Stream به‌تنهایی صدا و تصویر را با هم ندارد. در صورت فعال‌بودن ترکیب، YouTV آن‌ها را داخل مرورگر Mux می‌کند."
                  : "This stream does not contain both audio and video. When enabled, YouTV muxes the separate tracks locally in your browser."}
              </p>
            )}
            <div className="media-actions">
              <Button variant="outline" disabled={!worker || !currentFormat || playSelectedFormat} onClick={() => setPlaySelectedFormat(true)}><Clapperboard size={17} />{fa ? "پخش آنلاین همین فرمت" : "Play this format online"}</Button>
              <Button
                disabled={!worker || !currentFormat}
                onClick={() =>
                  currentFormat &&
                  void downloadYoutube(youtubeVideo, currentFormat.itag)
                }
              >
                <Download size={17} />
                {fa
                  ? currentFormat?.kind === "video" && combineYoutubeAudio
                    ? "دانلود ویدئو + صدا"
                    : "دانلود این فرمت"
                  : currentFormat?.kind === "video" && combineYoutubeAudio
                    ? "Download video + audio"
                    : "Download selected format"}
              </Button>
              <Button
                variant="outline"
                disabled={!worker}
                onClick={() => void downloadYoutubeTranscript(youtubeVideo)}
              >
                <Download size={17} />
                {fa ? "دانلود زیرنویس VTT" : "Download subtitles (VTT)"}
              </Button>
              <Button
                variant="outline"
                disabled={!worker || !youtubeVideo.thumbnail}
                onClick={() => void downloadYoutubeThumbnail(youtubeVideo)}
              >
                <Image size={17} />
                {fa ? "دانلود تصویر بندانگشتی" : "Download thumbnail"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void downloadYoutubeMetadata(youtubeVideo)}
              >
                <FileJson size={17} />
                {fa ? "دانلود اطلاعات JSON" : "Download metadata"}
              </Button>
              <a
                className="ui-button ui-button-outline"
                href={youtubeVideo.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={16} />
                {fa ? "بازکردن در YouTube" : "Open YouTube"}
              </a>
            </div>
          </section>
          <section className="panel-card media-side-card">
            <h3>{fa ? "اطلاعات و فرمت‌های موجود" : "Available formats"}</h3>
            <div className="media-stat-grid">
              <div>
                <strong>{youtubeVideo.formats.length}</strong>
                <span>{fa ? "فرمت" : "formats"}</span>
              </div>
              <div>
                <strong>
                  {Math.max(
                    0,
                    ...youtubeVideo.formats.map((format) => format.height),
                  ) || "—"}
                </strong>
                <span>{fa ? "بیشترین ارتفاع" : "max height"}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" aria-expanded={showYoutubeFormats} onClick={() => setShowYoutubeFormats(value => !value)}>{showYoutubeFormats ? (fa ? "بستن فهرست فرمت‌ها" : "Hide format list") : (fa ? "نمایش همه گزینه‌های پخش و دانلود" : "Show all playback and download options")}</Button>
            {showYoutubeFormats && <div className="media-format-list">
              {youtubeVideo.formats.map(format => <div className="media-format-item" key={format.itag}>
                <div><strong>{format.quality} · {format.height ? `${format.height}p` : format.kind === "audio" ? (fa ? "صوت" : "Audio") : "—"}</strong>
                  <small dir="ltr">itag {format.itag} · {format.mimeType}</small>
                  <small>{format.kind === "combined" ? (fa ? "صوت و تصویر" : "Video + audio") : format.kind === "video" ? (fa ? "فقط تصویر" : "Video only") : (fa ? "فقط صوت" : "Audio only")} · {format.bitrate ? `${Math.round(format.bitrate / 1000)} kbps` : "—"}{format.fps ? ` · ${format.fps} fps` : ""}{format.size ? ` · ${(format.size / 1048576).toFixed(1)} MiB` : ""}</small>
                </div>
                <div className="media-format-item-actions">
                  <Button size="sm" variant={selectedFormat === format.itag && playSelectedFormat ? "default" : "outline"} disabled={!worker} onClick={() => { setSelectedFormat(format.itag); setPlaySelectedFormat(true); }}><Clapperboard size={15} />{fa ? "پخش" : "Play"}</Button>
                  <Button size="sm" variant="outline" disabled={!worker} onClick={() => { setSelectedFormat(format.itag); void downloadYoutube(youtubeVideo, format.itag); }}><Download size={15} />{fa ? "دانلود" : "Download"}</Button>
                </div>
              </div>)}
              {!youtubeVideo.formats.length && <p className="muted">{fa ? "فرمت فایل مستقلی از منبع دریافت نشد." : "No individual file formats were returned."}</p>}
            </div>}
            <p className="muted">
              {fa
                ? "فقط فرمت‌هایی که YouTube برای این ویدئو در اختیار Worker قرار داده نمایش داده می‌شوند. ویدئوهای DRM یا محدود ممکن است قابل دریافت نباشند."
                : "Only formats exposed by YouTube for this video are listed. DRM-protected or restricted streams are not downloadable."}
            </p>
          </section>
        </div>
      )}

      {youtubePlaylist && (
        <section className="panel-card media-playlist-card">
          <div className="media-list-heading">
            <div>
              <span className="media-provider">YOUTUBE PLAYLIST</span>
              <h2>{youtubePlaylist.title}</h2>
              <p>
                {youtubePlaylist.author} · {youtubePlaylist.items.length}{" "}
                {fa ? "ویدئو" : "videos"}
                {youtubePlaylist.truncated ? " · 500 item limit" : ""}
              </p>
            </div>
            <div className="media-list-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedItems(youtubePlaylist.items.map((item) => item.id))
                }
              >
                {fa ? "انتخاب همه" : "Select all"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedItems([])}
              >
                {fa ? "هیچ‌کدام" : "Clear"}
              </Button>
              {youtubePlaylist.truncated && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingPlaylistMore}
                  onClick={() => void loadPlaylistMore(youtubePlaylist)}
                >
                  {loadingPlaylistMore ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Search size={15} />
                  )}{" "}
                  {fa ? "بارگذاری ۵۰۰ ویدئوی بعدی" : "Load next 500"}
                </Button>
              )}
            </div>
          </div>
          {allowDirect && <div className="media-embed media-playlist-embed">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(youtubePlaylist.id)}`}
              title={youtubePlaylist.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>}
          <div className="media-format-row">
            <label htmlFor="playlist-quality">
              {fa ? "کیفیت دانلود" : "Download quality"}
            </label>
            <Select
              id="playlist-quality"
              value={quality}
              onChange={(event) => setQuality(event.target.value)}
            >
              <SelectOption value="best">{fa ? "بهترین کیفیت همراه صدا" : "Best available combined"}</SelectOption>
              <SelectOption value="1080">{fa ? "1080p یا کمتر" : "1080p or lower"}</SelectOption>
              <SelectOption value="720">{fa ? "720p یا کمتر" : "720p or lower"}</SelectOption>
              <SelectOption value="480">{fa ? "480p یا کمتر" : "480p or lower"}</SelectOption>
              <SelectOption value="360">{fa ? "360p یا کمتر" : "360p or lower"}</SelectOption>
            </Select>
          </div>
          <div className="media-video-list">
            {youtubePlaylist.items.map((item, index) => (
              <div className="media-video-row media-youtube-playlist-row" key={item.id}>
                <Checkbox aria-label={item.title}
                  checked={selectedItems.includes(item.id)}
                  onChange={() =>
                    toggle(selectedItems, item.id, setSelectedItems)
                  }
                />
                <RoutedImage urls={imageUrls(item.thumbnail)} alt="" loading="lazy" />
                <span className="media-row-index">{index + 1}</span>
                <span className="media-row-title">
                  {item.title}
                  <small>
                    {item.author} {item.duration && `· ${item.duration}`}
                  </small>
                </span>
                <Button variant="outline" size="sm" disabled={loading} onClick={() => void resolve(item.url)}><Clapperboard size={15} />{fa ? "فرمت‌ها و پخش" : "Formats & play"}</Button>
              </div>
            ))}
          </div>
          <div className="media-actions">
            <Button
              disabled={!worker || !selectedItems.length}
              onClick={() => void downloadYoutubePlaylist(youtubePlaylist)}
            >
              <Download size={17} />
              {fa
                ? `دانلود ${selectedItems.length} ویدئو به‌صورت ZIP`
                : `Download ${selectedItems.length} videos as ZIP`}
            </Button>
            <a
              className="ui-button ui-button-outline"
              href={`https://www.youtube.com/playlist?list=${encodeURIComponent(youtubePlaylist.id)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              {fa ? "بازکردن Playlist" : "Open playlist"}
            </a>
          </div>
          {youtubePlaylist.truncated && (
            <p className="media-inline-warning">
              {fa
                ? "همه موارد Playlist هنوز بارگذاری نشده‌اند؛ برای دریافت ادامه فهرست از دکمه بارگذاری بیشتر استفاده کن."
                : "The playlist has more items. Load the next batch to continue."}
            </p>
          )}
        </section>
      )}

      {instagramPost && (
        <section className="panel-card media-instagram-card">
          <div className="media-list-heading">
            <div>
              <span className="media-provider">INSTAGRAM PUBLIC POST</span>
              <h2>{instagramPost.author || "Instagram post"}</h2>
              <p>
                {instagramPost.assets.length} {fa ? "رسانه" : "media items"}
              </p>
            </div>
            <a
              className="ui-button ui-button-outline"
              href={instagramPost.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              {fa ? "بازکردن پست" : "Open post"}
            </a>
          </div>
          {instagramPost.caption && (
            <p className="media-caption">{instagramPost.caption}</p>
          )}
          {instagramPost.assets.length > 0 ? (
            <div className="media-asset-grid">
              {instagramPost.assets.map((asset) => (
                <div className="media-asset-card" key={asset.id}>
                  <Checkbox
                    className="media-asset-select"
                    aria-label={fa ? "انتخاب رسانه" : "Select media asset"}
                    checked={selectedAssets.includes(asset.id)}
                    onChange={() =>
                      toggle(selectedAssets, asset.id, setSelectedAssets)
                    }
                  />
                  {asset.kind === "video" ? (
                    playingInstagram === asset.id ? <MediaPlayer
                      src={imageUrls(asset.url)[instagramRouteIndex] || ""}
                      sourceUrl={asset.url} title={asset.filename} worker={activeCandidates[instagramRouteIndex]}
                      poster={imageUrls(asset.thumbnail)[instagramRouteIndex]}
                      onError={() => {
                        if (instagramRouteIndex + 1 < imageUrls(asset.url).length) setInstagramRouteIndex(i => i === instagramRouteIndex ? i + 1 : i);
                        else setError(fa ? "پخش این رسانه ناموفق بود." : "Media playback failed.");
                      }} /> : <Button type="button" variant="ghost" className="media-instagram-poster" aria-label={fa ? "پخش ویدئو" : "Play video"} onClick={() => { setInstagramRouteIndex(0); setPlayingInstagram(asset.id); }}>
                      {asset.thumbnail && <RoutedImage urls={imageUrls(asset.thumbnail)} alt="" />}<span className="media-poster-play"><Clapperboard size={24}/></span>
                    </Button>
                  ) : (
                    <RoutedImage
                      urls={imageUrls(asset.url)}
                      alt="Instagram media"
                      loading="lazy"
                    />
                  )}
                  <span>
                    <b>
                      {asset.kind === "video" ? "Video" : "Image"}{" "}
                      {asset.width && `${asset.width}×${asset.height}`}
                    </b>
                    <small>{asset.filename}</small>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!worker}
                    onClick={() => void downloadInstagramAsset(asset)}
                  >
                    <Download size={14} />
                    {fa ? "دانلود این مورد" : "Download item"}
                  </Button>
                </div>
              ))}
            </div>
          ) : allowDirect ? (
            <div className="media-embed">
              <iframe
                src={`${instagramPost.url.replace(/\/$/, "")}/embed/`}
                title="Instagram post"
                loading="lazy"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : (
            <p className="media-inline-warning">{fa ? "نمایش Embed اینستاگرام به اتصال مستقیم نیاز دارد؛ Fallback مستقیم غیرفعال است." : "Instagram embed needs a direct connection; direct fallback is disabled."}</p>
          )}
          <div className="media-actions">
            <Button
              disabled={!worker || !selectedAssets.length}
              onClick={() => void downloadInstagram(instagramPost)}
            >
              <Download size={17} />
              {fa
                ? `دانلود ${selectedAssets.length} مورد به‌صورت ZIP`
                : `Download ${selectedAssets.length} items as ZIP`}
            </Button>
          </div>
          {!instagramPost.assets.length && (
            <p className="media-inline-warning">
              <AlertCircle size={15} />
              {fa
                ? "Instagram اطلاعات رسانه خام را در دسترس Worker قرار نداد؛ پست از طریق Embed رسمی نمایش داده می‌شود و دانلود مستقیم برای این پست فعال نیست."
                : "Instagram did not expose raw media URLs to the public page. The official embed is shown; direct download is unavailable for this post."}
            </p>
          )}
          <p className="media-inline-warning">
            <AlertCircle size={15} />
            {fa
              ? "استخراج فقط برای پست‌های عمومی قابل دسترسی است؛ پست خصوصی، نیازمند ورود یا مسدودشده توسط Instagram قابل دریافت نیست."
              : "Extraction is limited to publicly accessible posts. Private, login-gated or challenge-protected content is not supported."}
          </p>
        </section>
      )}

      {direct && (
        <section className="panel-card media-direct-card">
          <div className="media-list-heading">
            <div>
              <span className="media-provider">DIRECT MEDIA URL</span>
              <h2>{mediaKindLabel(direct.kind, fa)}</h2>
              <p className="media-url-ellipsis" title={direct.url}>
                {direct.url}
              </p>
            </div>
            <span className="media-kind-pill">
              {direct.probe?.contentType || extensionLabel(direct.url)}
            </span>
          </div>
          {directPreviewAllowed && (["hls", "dash", "video", "audio"] as MediaKind[]).includes(direct.kind) && (
            <MediaPlayer
              src={convertedPreviewUrl || (direct.kind === "dash" ? dashProxy : directProxy)}
              sourceUrl={direct.url}
              title={directName || mediaKindLabel(direct.kind, fa)}
              kind={convertedPreviewUrl ? "video" : direct.kind as "hls" | "dash" | "video" | "audio"}
              worker={convertedPreviewUrl ? undefined : worker}
              onError={convertedPreviewUrl ? message => setError(mediaError(message)) : retryDirectPreview}
            />
          )}
          {directPreviewAllowed && direct.kind === "image" && (
            <img
              className="media-direct-image"
              key={directProxy}
              src={directProxy}
              onError={retryDirectPreview}
              alt="Direct media"
            />
          )}
          {directPreviewAllowed && direct.kind === "document" && (
            <iframe
              className="media-embed"
              style={{ width: "100%", minHeight: "450px", border: 0 }}
              src={directProxy}
              title="PDF document"
              sandbox=""
            />
          )}
          {(direct.kind === "file" || direct.kind === "unknown") && (
            <div className="media-file-preview">
              <FileVideo size={42} />
              <strong>
                {direct.probe?.contentType || "Binary media file"}
              </strong>
              <span>
                {fa
                  ? "این نوع فایل برای پخش بومی مرورگر شناخته‌شده نیست؛ دانلود مستقیم در دسترس است."
                  : "This content type is not natively previewable; direct download is available."}
              </span>
            </div>
          )}
          <div className="media-direct-meta">
            <span>
              {direct.probe?.contentLength
                ? `${(direct.probe.contentLength / 1024 / 1024).toFixed(2)} MB`
                : fa
                  ? "حجم نامشخص"
                  : "Size unknown"}
            </span>
            <span>
              {direct.probe?.acceptRanges
                ? "HTTP Range supported"
                : fa
                  ? "Range نامشخص"
                  : "Range unknown"}
            </span>
            <span>
              {direct.probe?.status ? `HTTP ${direct.probe.status}` : fa ? "پاسخ منبع هنوز بررسی نشده" : "Source response not verified"}
            </span>
          </div>
          <div className="media-format-row">
            <label htmlFor="direct-filename">
              {fa ? "نام فایل دانلود" : "Download filename"}
            </label>
            <Input
              id="direct-filename"
              dir="auto"
              value={directName}
              onChange={(event) => setDirectName(event.target.value)}
              placeholder="media-file"
            />
          </div>
          <div className="media-actions">
            {convertedPreviewUrl && (
              <a
                className="ui-button ui-button-primary"
                href={convertedPreviewUrl}
                download={convertedFilename}
              >
                <Download size={17} />
                {fa ? "دانلود MP4 تبدیل‌شده" : "Download converted MP4"}
              </a>
            )}
            <Button
              disabled={!activeCandidates.length && !allowDirect}
              onClick={() => void downloadDirect(direct)}
            >
              <Download size={17} />
              {direct.kind === "hls"
                ? fa
                  ? "دانلود آرشیو HLS"
                  : "Download HLS archive"
                : direct.kind === "dash"
                  ? fa
                    ? "دانلود آرشیو DASH"
                    : "Download DASH archive"
                  : fa
                    ? "دانلود فایل اصلی"
                    : "Download original file"}
            </Button>
            {(direct.kind === "hls" || direct.kind === "video") && (
              <Button
                variant="outline"
                disabled={!worker && !allowDirect}
                onClick={() => void convertDirect(direct)}
              >
                <FileVideo size={17} />
                {fa
                  ? "تبدیل برای پخش در مرورگر (MP4)"
                  : "Prepare browser-playable MP4"}
              </Button>
            )}
            <a
              className="ui-button ui-button-outline"
              href={direct.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              {fa ? "بازکردن منبع" : "Open source"}
            </a>
          </div>
          {direct.kind === "dash" && (
            <p className="media-inline-warning">
              <AlertCircle size={15} />
              {fa
                ? "آرشیو DASH برای MPD ثابت (VOD) با SegmentTemplate، SegmentList یا SegmentBase پشتیبانی می‌شود؛ MPD زنده فعلاً فقط قابل پخش است."
                : "DASH archive supports static VOD MPDs using SegmentTemplate, SegmentList or SegmentBase. Dynamic live MPDs are playback-only."}
            </p>
          )}
          {direct.kind === "hls" && (
            <p className="media-inline-warning">
              <AlertCircle size={15} />
              {fa
                ? "آرشیو HLS شامل کیفیت انتخاب‌شده، صدا، زیرنویس، قطعات، Byte Range و کلید AES-128 مجاز است. برای استریم زنده فقط پنجره فعلی DVR/Playlist ذخیره می‌شود، نه کل پخش. DRM پشتیبانی نمی‌شود."
                : "HLS archives include the selected rendition, separate audio/subtitles, segments, byte ranges and permitted AES-128 keys. Live streams save only the currently advertised DVR/playlist window, not the entire broadcast. DRM is not supported."}
            </p>
          )}
          {direct.kind === "video" && (
            <p className="media-inline-warning">
              <AlertCircle size={15} />
              {fa
                ? "فایل اصلی بدون تغییر قابل دانلود است. پخش MKV، AVI، FLV و فرمت‌های مشابه به کدک مرورگر وابسته است؛ در صورت پشتیبانی، می‌توانی نسخه MP4 سازگار بسازی."
                : "The original file can be downloaded unchanged. MKV, AVI, FLV and similar formats depend on browser codec support; when supported, you can create a browser-friendly MP4."}
            </p>
          )}
          {(direct.kind === "hls" || direct.kind === "video") && (
            <p className="media-inline-warning">
              <AlertCircle size={15} />
              {fa
                ? "تبدیل کاملاً داخل مرورگر انجام می‌شود و به پشتیبانی WebCodecs و Codecهای دستگاه وابسته است. برای فایل‌های بزرگ از Chrome/Edge استفاده کن."
                : "Conversion runs entirely in the browser and depends on WebCodecs and device codec support. Use Chrome/Edge for large files."}
            </p>
          )}
        </section>
      )}

      {jobs.length > 0 && (
        <section className="panel-card media-job-card" aria-live="polite">
          <div className="media-list-heading">
            <div>
              <span className="media-provider">DOWNLOAD MANAGER</span>
              <h2>{fa ? "مدیریت دانلودها" : "Download manager"}</h2>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setJobs((current) =>
                  current.filter(
                    (item) =>
                      item.status === "running" || item.status === "queued",
                  ),
                )
              }
            >
              {fa ? "پاک‌کردن تاریخچه" : "Clear history"}
            </Button>
          </div>
          {jobs.map((item) => (
            <div className="media-job-item" key={item.id}>
              <div className="media-job-heading">
                {item.status === "running" ? (
                  <LoaderCircle className="spin" />
                ) : item.status === "handed-off" ? (
                  <Download />
                ) : item.status === "done" ? (
                  <CheckCircle2 className="success-icon" />
                ) : item.status === "queued" ? (
                  <LoaderCircle />
                ) : (
                  <AlertCircle
                    className={
                      item.status === "cancelled" ? "muted-icon" : "error-icon"
                    }
                  />
                )}
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.message}</span>
                </div>
                {(item.status === "running" || item.status === "queued") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => cancelJob(item.id)}
                  >
                    {fa ? "لغو" : "Cancel"}
                  </Button>
                )}
              </div>
              {item.status === "running" && (
                <div
                  className={`media-progress ${item.progress?.total ? "" : "is-indeterminate"}`}
                >
                  <div
                    style={{
                      width: item.progress?.total
                        ? `${Math.min(100, (item.progress.loaded / item.progress.total) * 100)}%`
                        : undefined,
                    }}
                  />
                </div>
              )}
              {item.progress && (
                <small>{progressLabel(item.progress, fa)}</small>
              )}
            </div>
          ))}
        </section>
      )}

      {!target && !loading && (
        <div className="media-empty-state">
          <Clapperboard size={42} />
          <h2>{fa ? "لینک رسانه را وارد کن" : "Paste a media URL"}</h2>
          <p>
            {fa
              ? "YouTube، Playlist، Instagram Post یا لینک مستقیم فایل را وارد کن تا اطلاعات واقعی منبع بررسی شود."
              : "Enter a YouTube video or playlist, a public Instagram post, or a direct media URL to inspect the actual source."}
          </p>
        </div>
      )}
    </section>
  );
}
function extensionLabel(url: string): string {
  return new URL(url).pathname.split(".").at(-1)?.toUpperCase() || "URL";
}
