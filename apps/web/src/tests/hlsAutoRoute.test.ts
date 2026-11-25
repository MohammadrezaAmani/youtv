// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import type { ProxyResult } from "../lib/proxy";
import { chooseHlsAutoRoute } from "../features/player/hlsAutoRoute";
const direct: ProxyResult = { url: "https://origin.test/live.m3u8", mode: "direct" };
const proxy: ProxyResult = { url: "https://worker.test/proxy?url=https%3A%2F%2Forigin.test%2Flive.m3u8&hls=1", mode: "proxy", worker: {id:"w",name:"Worker",baseUrl:"https://worker.test",token:"",enabled:true} };
const playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nsegment.ts\n";
const text = () => new Response(playlist, {headers:{"Content-Type":"application/vnd.apple.mpegurl"}});
afterEach(() => vi.useRealTimers());

test("a fast playlist cannot win while its video body is stalled", async () => {
  let loserAborted = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("segment.ts")) return text();
    if (url.startsWith("https://worker.test")) return new Response(new ReadableStream({start(controller) {
      controller.enqueue(new Uint8Array([71]));
      init?.signal?.addEventListener("abort",()=>{loserAborted=true;controller.error(new DOMException("Aborted","AbortError"));});
    }}));
    return new Response(new Uint8Array([71,1,2,3]));
  };
  const result = await chooseHlsAutoRoute(direct, proxy, new AbortController().signal, {fetcher});
  expect(result.route.mode).toBe("direct");
  expect(loserAborted).toBe(true);
  // HLS.js compares overlapping fragment URI spellings on live refresh.
  // Changing only the warm manifest to absolute URLs breaks that comparison.
  expect((await result.responses.get(direct.url)!.completion).data).toBe(playlist);
  expect(await (await result.responses.get("https://origin.test/segment.ts")!.completion).data).toBeInstanceOf(Blob);
  result.dispose();
});

test("a working Worker wins when direct CORS/network access fails", async () => {
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.startsWith("https://origin.test")) throw new TypeError("Failed to fetch");
    if (url.includes("segment.ts")) return new Response(new Uint8Array([71,2]));
    return new Response(playlist,{headers:{"X-YouTV-Source-URL":"https://origin.test/redirect/live.m3u8"}});
  };
  const result = await chooseHlsAutoRoute(direct,proxy,new AbortController().signal,{fetcher});
  expect(result.route.mode).toBe("proxy");
  expect([...result.responses.keys()].some(url=>url.includes(encodeURIComponent("https://origin.test/redirect/segment.ts")))).toBe(true);
  result.dispose();
});

test("decision deadline hands off the selected ongoing bytes without restarting them", async () => {
  vi.useFakeTimers();
  let finish: (()=>void) | undefined, directAborted = false;
  const fetcher = vi.fn<typeof fetch>(async (input,init) => {
    if (!String(input).includes("segment.ts")) return text();
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(new Uint8Array([71,1]));
      if(String(input).startsWith("https://origin.test")) {
        finish=()=>{controller.enqueue(new Uint8Array([2,3]));controller.close();};
        init?.signal?.addEventListener("abort",()=>{directAborted=true;});
      } else init?.signal?.addEventListener("abort",()=>controller.error(new DOMException("Aborted","AbortError")));
    }}));
  });
  const selection=chooseHlsAutoRoute(direct,proxy,new AbortController().signal,{fetcher,timeoutMs:40});
  await vi.advanceTimersByTimeAsync(40);
  const result=await selection;
  expect(result.route.mode).toBe("direct");
  expect(directAborted).toBe(false);
  const transfer=result.responses.get("https://origin.test/segment.ts")!;
  expect(transfer.loaded).toBe(2);
  finish!();
  const payload=await transfer.completion;
  expect(payload.data).toBeInstanceOf(Blob);
  expect(await (payload.data as Blob).arrayBuffer()).toEqual(new Uint8Array([71,1,2,3]).buffer);
  expect(fetcher.mock.calls.filter(([url])=>String(url)==="https://origin.test/segment.ts")).toHaveLength(1);
  result.dispose();
});

test("invalid pages and unsupported byte-range probes leave standard playback available", async () => {
  const fetcher:typeof fetch=async input=>String(input).startsWith("https://origin.test")
    ?new Response(playlist.replace("#EXTINF:5,","#EXT-X-BYTERANGE:100@0\n#EXTINF:5,"))
    :new Response("<html>error</html>",{headers:{"Content-Type":"text/html"}});
  const result=await chooseHlsAutoRoute(direct,proxy,new AbortController().signal,{fetcher});
  expect(result.route.mode).toBe("direct");
  expect([...result.responses.keys()]).toEqual([direct.url]);
  result.dispose();
});

test("aborting a channel cancels both routes", async () => {
  let aborted=0;
  const controller=new AbortController();
  const fetcher:typeof fetch=async (_input,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener("abort",()=>{aborted++;reject(new DOMException("Aborted","AbortError"));});
  });
  const result=chooseHlsAutoRoute(direct,proxy,controller.signal,{fetcher});
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(aborted).toBe(2);
});

test("an inconclusive byte-range probe must not make a responsive direct route lose",async()=>{
  vi.useFakeTimers();
  const fetcher:typeof fetch=async (input,init)=>{
    if(String(input).startsWith("https://origin.test")) return new Response(playlist.replace("#EXTINF:5,","#EXT-X-BYTERANGE:100@0\n#EXTINF:5,"));
    return new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError"))));
  };
  const selection=chooseHlsAutoRoute(direct,proxy,new AbortController().signal,{fetcher,timeoutMs:40});
  await vi.advanceTimersByTimeAsync(40);
  const result=await selection;
  expect(result.route.mode).toBe("direct");
  result.dispose();
});
