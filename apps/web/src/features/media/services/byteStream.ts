/** Bridge byte streams to DOM APIs which require ArrayBuffer-backed views. */
export function fileWriteBytes(chunk:Uint8Array):Uint8Array<ArrayBuffer>{
  if(chunk.buffer instanceof ArrayBuffer){
    return new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength);
  }
  // SharedArrayBuffer-backed input must be copied before passing to DOM APIs.
  return new Uint8Array(chunk);
}

/** Generated manifests/subtitles are UTF-8, not files that require Blob.stream(). */
export function textByteStream(text:string):ReadableStream<Uint8Array>{
  return new ReadableStream<Uint8Array>({
    start(controller){
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    }
  });
}
