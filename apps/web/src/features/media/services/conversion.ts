import type { WorkerProfile } from "@youtv/shared";
import { proxyUrl } from "@/lib/proxy";
import { createTempFile } from "./opfs";

export type ConversionProgress = (
  fraction: number,
  processedSeconds: number,
) => void;
export type ConversionResult = {
  blob: Blob | null;
  filename: string;
  duration: number | null;
  discarded: string[];
  cleanup?: () => Promise<void>;
};
const MAX_IN_MEMORY_OUTPUT = 250 * 1024 * 1024;

function safeName(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 120) || "media"
  );
}
async function verifyHlsVOD(url: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HLS manifest HTTP ${response.status}`);
  let manifest = await response.text();
  let finalUrl = response.url || url;
  if (!/^\uFEFF?\s*#EXTM3U/i.test(manifest))
    throw new Error("Source did not return an HLS playlist");
  if (
    !manifest.includes("#EXT-X-ENDLIST") &&
    /#EXT-X-STREAM-INF:/i.test(manifest)
  ) {
    const lines = manifest.split(/\r?\n/);
    const variants: { url: string; bandwidth: number }[] = [];
    for (let index = 0; index < lines.length; index++)
      if (/^\s*#EXT-X-STREAM-INF:/i.test(lines[index] || "")) {
        const bandwidth = Number(
          (lines[index] || "").match(/BANDWIDTH=(\d+)/i)?.[1] || 0,
        );
        let next = index + 1;
        while (
          next < lines.length &&
          (!lines[next]!.trim() || lines[next]!.trim().startsWith("#"))
        )
          next++;
        if (next < lines.length)
          variants.push({
            url: new URL(lines[next]!.trim(), finalUrl).toString(),
            bandwidth,
          });
      }
    const selected = variants.sort((a, b) => b.bandwidth - a.bandwidth)[0];
    if (selected) {
      const child = await fetch(selected.url, {
        credentials: "omit",
        cache: "no-store",
        signal,
      });
      if (!child.ok) throw new Error(`HLS media playlist HTTP ${child.status}`);
      manifest = await child.text();
      finalUrl = child.url || selected.url;
    }
  }
  if (
    !manifest.includes("#EXT-X-ENDLIST") &&
    !/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(manifest)
  )
    throw new Error(
      "تبدیل MP4 برای HLS زنده فعال نیست؛ برای پخش زنده از پلیر استفاده کن.",
    );
  if (
    /METHOD=(?:SAMPLE-AES|SAMPLE-AES-CTR)/i.test(manifest) ||
    /KEYFORMAT=(?!"identity")/i.test(manifest)
  )
    throw new Error("HLS با SAMPLE-AES یا DRM قابل تبدیل نیست.");
}

export async function convertToBrowserMp4(
  sourceUrl: string,
  worker: WorkerProfile,
  kind: "video" | "hls",
  onProgress: ConversionProgress = () => {},
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const filename = `${safeName(new URL(sourceUrl).pathname.split("/").at(-1) || "media").replace(/\.[^.]+$/, "")}.mp4`;
  let temp: Awaited<ReturnType<typeof createTempFile>> = null;
  let tempWritable: FileSystemWritableFileStream | undefined;
  let input: any, conversion: any;
  let overflow = false;
  let inputDisposed = false;
  const disposeInput = () => {
    if (input && !inputDisposed) {
      inputDisposed = true;
      input.dispose();
    }
  };
  const abortConversion = () => {
    if (conversion) void conversion.cancel().catch(() => undefined);
    // UrlSource owns its AbortSignal. Dispose even while canRead/init is pending.
    disposeInput();
  };
  try {
    temp = await createTempFile("media-convert");
    if (temp) tempWritable = await temp.handle.createWritable();
    const module = await import("mediabunny");
    const sourceUrlThroughWorker = proxyUrl(
      sourceUrl,
      worker,
      "proxy",
      kind === "hls",
    );
    if (kind === "hls") await verifyHlsVOD(sourceUrlThroughWorker, signal);
    if (signal?.aborted)
      throw signal.reason || new DOMException("Aborted", "AbortError");
    input = new module.Input({
      source: new module.UrlSource(sourceUrlThroughWorker, {
        maxCacheSize: 32 * 1024 * 1024,
        parallelism: 2,
        requestInit: { credentials: "omit", cache: "no-store" },
      }),
      formats: kind === "hls" ? module.HLS_FORMATS : module.ALL_FORMATS,
    });
    signal?.addEventListener("abort", abortConversion, { once: true });
    signal?.throwIfAborted();
    const target = tempWritable
      ? new module.StreamTarget(tempWritable, {
          chunked: true,
          chunkSize: 8 * 1024 * 1024,
        })
      : new module.BufferTarget();
    const output = new module.Output({
      format: new module.Mp4OutputFormat({ fastStart: false }),
      target,
    });
    if (target instanceof module.BufferTarget) {
      target.on("write", ({ end }: { end: number }) => {
        if (end > MAX_IN_MEMORY_OUTPUT && !overflow) {
          overflow = true;
          void conversion?.cancel().catch(() => undefined);
        }
      });
    }
    if (!(await input.canRead()))
      throw new Error(
        "این فرمت یا Container توسط مرورگر/کتابخانه قابل خواندن نیست. فایل اصلی همچنان قابل دانلود است.",
      );
    signal?.throwIfAborted();
    conversion = await module.Conversion.init({
      input,
      output,
      tracks: "primary",
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const details = conversion.discardedTracks
        .map((item: any) => `${item.track?.type || "track"}: ${item.reason}`)
        .join("; ");
      throw new Error(
        `امکان ساخت MP4 با Trackهای موجود نیست${details ? `: ${details}` : ""}`,
      );
    }
    conversion.onProgress = (fraction: number, processedSeconds: number) =>
      onProgress(Math.max(0, Math.min(1, fraction)), processedSeconds);
    signal?.throwIfAborted();
    await conversion.execute();
    if (signal?.aborted)
      throw signal.reason || new DOMException("Aborted", "AbortError");
    if (overflow)
      throw new Error(
        "خروجی از سقف 250 MiB حافظه مرورگر عبور کرد. برای تبدیل فایل بزرگ از مرورگری با OPFS یا File System Access استفاده کن.",
      );
    const duration = await input.getDurationFromMetadata().catch(() => null);
    signal?.throwIfAborted();
    if (temp && tempWritable) {
      const file = await temp.handle.getFile();
      signal?.throwIfAborted();
      const cleanup = temp.remove;
      temp = null;
      return {
        blob: file,
        filename,
        duration,
        discarded: conversion.discardedTracks.map((item: any) => item.reason),
        cleanup,
      };
    }
    if (target instanceof module.BufferTarget) {
      if (!target.buffer)
        throw new Error("تبدیل تمام شد اما خروجی MP4 تولید نشد.");
      return {
        blob: new Blob([target.buffer], { type: "video/mp4" }),
        filename,
        duration,
        discarded: conversion.discardedTracks.map((item: any) => item.reason),
      };
    }
    return {
      blob: null,
      filename,
      duration,
      discarded: conversion.discardedTracks.map((item: any) => item.reason),
    };
  } catch (error) {
    await tempWritable?.abort(error).catch(() => undefined);
    await temp?.remove();
    if (overflow)
      throw new Error(
        "خروجی از سقف 250 MiB حافظه مرورگر عبور کرد. برای تبدیل فایل بزرگ از مرورگری با OPFS یا File System Access استفاده کن.",
      );
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortConversion);
    disposeInput();
  }
}
