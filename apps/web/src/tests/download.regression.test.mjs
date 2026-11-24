import test from "node:test";
import assert from "node:assert/strict";
import {
  downloadStreamFactory,
  downloadUrl,
} from "../features/media/services/download.ts";
import {
  fileWriteBytes,
  textByteStream,
} from "../features/media/services/byteStream.ts";

function mockPicker(t, { failWrite = false } = {}) {
  const prior = globalThis.window;
  const state = { writes: [], closed: false, aborted: false };
  globalThis.window = {
    showSaveFilePicker: async () => ({
      createWritable: async () => ({
        write: async (chunk) => {
          if (failWrite) throw new Error("Disk full");
          state.writes.push([...chunk]);
        },
        close: async () => {
          state.closed = true;
        },
        abort: async () => {
          state.aborted = true;
        },
      }),
    }),
  };
  t.after(() => {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  });
  return state;
}
test("a completed stream is written without losing or changing bytes", async (t) => {
  const sink = mockPicker(t);
  const progress = [];
  await downloadStreamFactory(
    async () => new Blob([Uint8Array.of(1, 2, 3, 4)]).stream(),
    "video.mp4",
    4,
    (p) => progress.push(p),
  );
  assert.deepEqual(sink.writes.flat(), [1, 2, 3, 4]);
  assert.equal(sink.closed, true);
  assert.equal(sink.aborted, false);
  assert.equal(progress.at(-1).loaded, 4);
});
test("abort during a pending read does not close a partial file as completed", async (t) => {
  const sink = mockPicker(t);
  let cancelled = false;
  const controller = new AbortController();
  let opened;
  const ready = new Promise((resolve) => {
    opened = resolve;
  });
  const download = downloadStreamFactory(
    async () =>
      new ReadableStream({
        start() {
          opened();
        },
        cancel() {
          cancelled = true;
        },
      }),
    "large.mkv",
    null,
    () => {},
    controller.signal,
  );
  await ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(download, { name: "AbortError" });
  assert.equal(sink.closed, false);
  assert.equal(sink.aborted, true);
  assert.equal(cancelled, true);
});
test("disk write failure cancels the source and aborts the partial destination", async (t) => {
  const sink = mockPicker(t, { failWrite: true });
  let cancelled = false;
  await assert.rejects(
    downloadStreamFactory(
      async () =>
        new ReadableStream({
          pull(c) {
            c.enqueue(Uint8Array.of(1, 2, 3));
          },
          cancel() {
            cancelled = true;
          },
        }),
      "disk-full.mp4",
      null,
    ),
    /Disk full/,
  );
  assert.equal(cancelled, true);
  assert.equal(sink.closed, false);
  assert.equal(sink.aborted, true);
});
test("cancellation before opening a URL does not start a network request", async (t) => {
  const sink = mockPicker(t);
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("unexpected");
  };
  t.after(() => {
    globalThis.fetch = previous;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    downloadUrl(
      "https://example.org/video.mp4",
      "video.mp4",
      () => {},
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  assert.equal(sink.closed, false);
});

test("file writes preserve the exact byte offset and length of a subarray", () => {
  const original = Uint8Array.of(99, 1, 2, 3, 98);
  const view = fileWriteBytes(original.subarray(1, 4));
  assert.deepEqual([...view], [1, 2, 3]);
  assert.equal(view.buffer, original.buffer);
  assert.equal(view.byteOffset, 1);
});
test("SharedArrayBuffer chunks are copied into valid DOM file-write buffers", async (t) => {
  const sink = mockPicker(t);
  const shared = new Uint8Array(new SharedArrayBuffer(5));
  shared.set([99, 4, 5, 6, 98]);
  const view = fileWriteBytes(shared.subarray(1, 4));
  assert.ok(view.buffer instanceof ArrayBuffer);
  assert.deepEqual([...view], [4, 5, 6]);
  shared[1] = 77;
  assert.deepEqual([...view], [4, 5, 6]);
  shared[1] = 4;
  await downloadStreamFactory(
    async () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(shared.subarray(1, 4));
          controller.close();
        },
      }),
    "shared.bin",
    3,
  );
  assert.deepEqual(sink.writes.flat(), [4, 5, 6]);
  assert.equal(sink.closed, true);
});
test("generated HLS/DASH text streams do not depend on Blob.stream", async () => {
  // Bun can expose Blob.prototype.stream as non-configurable. Disable the
  // global constructor instead of attempting to redefine its native methods.
  const original = globalThis.Blob;
  try {
    globalThis.Blob = undefined;
    assert.equal(globalThis.Blob, undefined);
    for (const text of [
      "#EXTM3U\n#EXTINF:4,شبکه\nsegment.ts\n#EXT-X-ENDLIST",
      '<?xml version="1.0"?><MPD type="static"><Period/></MPD>',
      "WEBVTT\n\nمتن زیرنویس",
      "",
    ]) {
      // Read the stream directly: Response/Blob implementations are not part
      // of the functionality under test and may use native Blob internals.
      const reader = textByteStream(text).getReader();
      const bytes = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          assert.ok(value instanceof Uint8Array);
          bytes.push(...value);
        }
      } finally {
        reader.releaseLock();
      }
      assert.deepEqual(bytes, [...new TextEncoder().encode(text)]);
      assert.equal(new TextDecoder().decode(Uint8Array.from(bytes)), text);
    }
  } finally {
    globalThis.Blob = original;
  }
});
