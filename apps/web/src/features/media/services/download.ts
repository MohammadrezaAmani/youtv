import { createTempFile } from "./opfs.ts";
import { fileWriteBytes } from "./byteStream.ts";

export type DownloadProgress = {
  loaded: number;
  total: number | null;
  item: number;
  items: number;
  filename: string;
  handoff?: boolean;
  percent?: number;
  processedSeconds?: number;
};
type Sink = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};
type FilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};
const FALLBACK_MAX_BYTES = 350 * 1024 * 1024;

function safeFilename(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 160) || "download.bin"
  );
}
function safeArchivePath(value: string): string {
  return (
    value
      .split("/")
      .map((part) => safeFilename(part))
      .filter(Boolean)
      .join("/") || "file.bin"
  );
}
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeFilename(filename);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60_000);
}
async function createSink(filename: string): Promise<Sink> {
  const picker = (window as FilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: safeFilename(filename),
      });
      const writable = await handle.createWritable();
      return {
        write: async (chunk) => {
          await writable.write(fileWriteBytes(chunk));
        },
        close: async () => {
          await writable.close();
        },
        abort: async (reason) => {
          await writable.abort(reason).catch(() => undefined);
        },
      };
    } catch (error) {
      // Queued jobs often start outside the transient user activation window.
      // Fall back to OPFS, but never ignore an explicit picker cancellation.
      if (
        !(error instanceof DOMException) ||
        !["SecurityError", "NotAllowedError"].includes(error.name)
      )
        throw error;
    }
  }
  // Safari/iOS does not expose showSaveFilePicker. Prefer OPFS so large ZIPs and
  // YouTube streams do not accumulate in JS memory before the browser download.
  const temp = await createTempFile("download");
  if (temp) {
    let writable: FileSystemWritableFileStream;
    try {
      writable = await temp.handle.createWritable();
    } catch (error) {
      await temp.remove();
      throw error;
    }
    return {
      write: async (chunk) => {
        await writable.write(fileWriteBytes(chunk));
      },
      close: async () => {
        await writable.close();
        const file = await temp.handle.getFile();
        triggerBlobDownload(file, filename);
        window.setTimeout(() => void temp.remove(), 10 * 60_000);
      },
      abort: async (reason) => {
        await writable.abort(reason).catch(() => undefined);
        await temp.remove();
      },
    };
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  return {
    write: async (chunk) => {
      size += chunk.byteLength;
      if (size > FALLBACK_MAX_BYTES)
        throw new Error(
          "این مرورگر ذخیره‌سازی جریانی فایل بزرگ یا OPFS را پشتیبانی نمی‌کند؛ از Chrome/Edge دسکتاپ استفاده کن.",
        );
      chunks.push(new Uint8Array(chunk));
    },
    close: async () =>
      triggerBlobDownload(
        new Blob(chunks, { type: "application/octet-stream" }),
        filename,
      ),
    abort: async () => {
      chunks.length = 0;
    },
  };
}
async function streamToSink(
  stream: ReadableStream<Uint8Array>,
  sink: Sink,
  onProgress: (value: DownloadProgress) => void,
  filename: string,
  total: number | null,
  item = 1,
  items = 1,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  let loaded = 0;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      if (done) break;
      if (value) {
        await sink.write(value);
        loaded += value.byteLength;
        onProgress({ loaded, total, item, items, filename });
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
export async function downloadStream(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  total: number | null,
  onProgress: (value: DownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const sink = await createSink(filename);
  try {
    await streamToSink(stream, sink, onProgress, filename, total, 1, 1, signal);
    signal?.throwIfAborted();
    await sink.close();
  } catch (error) {
    await sink.abort(error);
    throw error;
  }
}
export async function downloadUrl(
  url: string,
  filename: string,
  onProgress: (value: DownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  // Keep direct attachment navigation for browsers without the File System API:
  // the Worker streams the file and supplies Content-Disposition.
  if (!(window as FilePickerWindow).showSaveFilePicker) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(filename);
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    onProgress({
      loaded: 0,
      total: null,
      item: 1,
      items: 1,
      filename,
      handoff: true,
    });
    return;
  }
  const sink = await createSink(filename);
  try {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "no-store",
      signal,
    });
    if (!response.ok)
      throw new Error(`Download failed: HTTP ${response.status}`);
    if (!response.body)
      throw new Error("Download response has no readable body");
    const total = Number(response.headers.get("Content-Length")) || null;
    await streamToSink(
      response.body,
      sink,
      onProgress,
      filename,
      total,
      1,
      1,
      signal,
    );
    signal?.throwIfAborted();
    await sink.close();
  } catch (error) {
    await sink.abort(error);
    throw error;
  }
}

export type ZipEntrySource = {
  filename: string;
  open: (signal?: AbortSignal) => Promise<ReadableStream<Uint8Array>>;
  size?: number | null;
};
export async function downloadZip(
  entries: ZipEntrySource[],
  archiveName: string,
  onProgress: (value: DownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  return downloadZipLazy(async () => entries, archiveName, onProgress, signal);
}

export async function downloadStreamFactory(
  open: () => Promise<ReadableStream<Uint8Array>>,
  filename: string,
  total: number | null,
  onProgress: (value: DownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const sink = await createSink(filename);
  try {
    if (signal?.aborted)
      throw signal.reason || new DOMException("Aborted", "AbortError");
    const stream = await open();
    await streamToSink(stream, sink, onProgress, filename, total, 1, 1, signal);
    signal?.throwIfAborted();
    await sink.close();
  } catch (error) {
    await sink.abort(error);
    throw error;
  }
}
export async function downloadZipLazy(
  buildEntries: (signal?: AbortSignal) => Promise<ZipEntrySource[]>,
  archiveName: string,
  onProgress: (value: DownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const sink = await createSink(archiveName);
  let writeChain = Promise.resolve();
  let zipError: Error | undefined;
  let loaded = 0;
  let zip: any;
  const usedPaths = new Set<string>();
  try {
    const { Zip, ZipPassThrough } = await import("fflate");
    const entries = await buildEntries(signal);
    if (!entries.length)
      throw new Error("هیچ فایلی برای دانلود انتخاب نشده است");
    if (entries.length > 65000)
      throw new Error(
        "ZIP32 supports at most 65000 entries; split this download into batches.",
      );
    zip = new Zip((error, data) => {
      if (error) {
        zipError = error;
        return;
      }
      if (data.length) writeChain = writeChain.then(() => sink.write(data));
    });
    for (let index = 0; index < entries.length; index++) {
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      const entry = entries[index]!;
      let path = safeArchivePath(entry.filename);
      let count = 2;
      const original = path;
      while (usedPaths.has(path)) {
        const dot = original.lastIndexOf(".");
        path =
          dot > original.lastIndexOf("/")
            ? `${original.slice(0, dot)}-${count++}${original.slice(dot)}`
            : `${original}-${count++}`;
      }
      usedPaths.add(path);
      const file = new ZipPassThrough(path);
      zip.add(file);
      const stream = await entry.open(signal);
      const reader = stream.getReader();
      const abort = () => {
        void reader.cancel(signal?.reason).catch(() => undefined);
      };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          if (signal?.aborted)
            throw signal.reason || new DOMException("Aborted", "AbortError");
          const { done, value } = await reader.read();
          if (signal?.aborted)
            throw signal.reason || new DOMException("Aborted", "AbortError");
          if (done) break;
          if (value) {
            file.push(value);
            await writeChain;
            if (zipError) throw zipError;
            loaded += value.byteLength;
            if (loaded > 3_900_000_000)
              throw new Error(
                "ZIP32 size limit reached; split the download into smaller archives.",
              );
            onProgress({
              loaded,
              total: null,
              item: index + 1,
              items: entries.length,
              filename: entry.filename,
            });
          }
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
        reader.releaseLock();
      }
      file.push(new Uint8Array(0), true);
      await writeChain;
      if (zipError) throw zipError;
    }
    zip.end();
    await writeChain;
    if (zipError) throw zipError;
    signal?.throwIfAborted();
    await sink.close();
  } catch (error) {
    try {
      zip?.terminate();
    } catch {
      /* no-op */
    }
    await writeChain.catch(() => undefined);
    await sink.abort(error);
    throw error;
  }
}
