import { fileWriteBytes } from "./byteStream.ts";

export type TempFile = {
  handle: FileSystemFileHandle;
  file: File;
  remove: () => Promise<void>;
};

type OpfsStorage = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
};

export async function createTempFile(
  prefix = "media",
): Promise<{
  handle: FileSystemFileHandle;
  remove: () => Promise<void>;
} | null> {
  try {
    const getDirectory = (navigator.storage as OpfsStorage | undefined)
      ?.getDirectory;
    if (!getDirectory) return null;
    const root = await getDirectory.call(navigator.storage);
    const directory = await root.getDirectoryHandle("youtv-media-temp", {
      create: true,
    });
    const name = `${prefix.replace(/[^a-z0-9_-]/gi, "_").slice(0, 24)}-${crypto.randomUUID()}.tmp`;
    const handle = await directory.getFileHandle(name, { create: true });
    return {
      handle,
      remove: async () => {
        try {
          await directory.removeEntry(name);
        } catch {
          /* already removed */
        }
      },
    };
  } catch {
    return null;
  }
}

export async function writeStreamToTempFile(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  onChunk: (bytes: number) => void = () => {},
  signal?: AbortSignal,
): Promise<TempFile> {
  const temp = await createTempFile(prefix);
  if (!temp)
    throw new Error(
      "Origin Private File System is unavailable in this browser",
    );
  let writable: FileSystemWritableFileStream;
  try {
    writable = await temp.handle.createWritable();
  } catch (error) {
    await temp.remove();
    throw error;
  }
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
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      await writable.write(fileWriteBytes(value));
      onChunk(value.byteLength);
    }
    signal?.throwIfAborted();
    await writable.close();
    return {
      handle: temp.handle,
      file: await temp.handle.getFile(),
      remove: temp.remove,
    };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await writable.abort(error).catch(() => undefined);
    await temp.remove();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export function streamWithCleanup(
  blob: Blob,
  cleanup: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = blob.stream().getReader();
  let cleaned = false;
  const clean = async () => {
    if (!cleaned) {
      cleaned = true;
      await cleanup();
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (item.done) {
          controller.close();
          await clean();
        } else controller.enqueue(item.value);
      } catch (error) {
        controller.error(error);
        await clean();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      await clean();
    },
  });
}

export async function writeStreamToExistingTempFile(
  temp: { handle: FileSystemFileHandle; remove: () => Promise<void> },
  stream: ReadableStream<Uint8Array>,
  onChunk: (bytes: number) => void = () => {},
  signal?: AbortSignal,
): Promise<TempFile> {
  let writable: FileSystemWritableFileStream;
  try {
    writable = await temp.handle.createWritable();
  } catch (error) {
    await temp.remove();
    throw error;
  }
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
      signal?.throwIfAborted();
      if (done) break;
      if (!value) continue;
      await writable.write(fileWriteBytes(value));
      onChunk(value.byteLength);
    }
    signal?.throwIfAborted();
    await writable.close();
    return {
      handle: temp.handle,
      file: await temp.handle.getFile(),
      remove: temp.remove,
    };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    await writable.abort(error).catch(() => undefined);
    await temp.remove();
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
