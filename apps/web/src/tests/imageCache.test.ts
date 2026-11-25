// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { imageCacheRuntime, type PublicAssetCacheOptions } from "../../imageCacheRuntime";

function harness(network: (request: Request) => Promise<Response>, options: PublicAssetCacheOptions = {}) {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request) => `${request.url}|${request.headers.get("accept")}`;
  const caches = { async open(name: string) {
    const entries = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, entries);
    return {
      async match(request: Request) { return entries.get(key(request))?.clone(); },
      async put(request: Request, response: Response) { entries.set(key(request), response.clone()); },
      async delete(request: Request) { return entries.delete(key(request)); },
      async keys() { return [...entries.keys()].map(value => {
        const [url, accept] = value.split("|");
        return new Request(url!, { headers: { Accept: accept! } });
      }); },
    };
  } };
  const context = { Date, Request, Response, URL, AbortSignal, AbortController, setTimeout, clearTimeout, caches, fetch: network,
    self: { location: { origin: "https://app.example" } } };
  const api = runInNewContext(`${imageCacheRuntime("test-", options)}\n({publicImageRequest,cachedPublicImage})`, context) as {
    publicImageRequest: (request: Request, url: URL) => boolean;
    cachedPublicImage: (request: Request) => Promise<Response>;
  };
  const request = (source = "https://img.example/logo.png", destination = "image", extra = "") => {
    const url = new URL("https://relay.example/proxy");
    url.searchParams.set("url", source);
    if (extra) url.searchParams.set("key", extra);
    const req = new Request(url);
    Object.defineProperty(req, "destination", { value: destination });
    return req;
  };
  return { ...api, request, stores };
}
function image(policy = "public, max-age=3600", type = "image/png") {
  return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": type, "Cache-Control": policy } });
}
describe("public image runtime cache", () => {
  it("coalesces concurrent misses and reuses the exact URL without another request", async () => {
    let calls = 0;
    const api = harness(async () => { calls++; return image(); });
    const req = api.request();
    expect(api.publicImageRequest(req, new URL(req.url))).toBe(true);
    const responses = await Promise.all([api.cachedPublicImage(req), api.cachedPublicImage(req)]);
    for (const response of responses) expect((await response.arrayBuffer()).byteLength).toBe(4);
    expect((await (await api.cachedPublicImage(req)).arrayBuffer()).byteLength).toBe(4);
    expect(calls).toBe(1);
  });
  it("excludes stream requests, signed sources and authenticated relays", () => {
    const api = harness(async () => image());
    for (const req of [api.request(undefined, "video"), api.request("https://img.example/logo.png?sig=abc"), api.request(undefined, "image", "secret")]) {
      expect(api.publicImageRequest(req, new URL(req.url))).toBe(false);
    }
  });
  it("does not persist no-store responses or HTML errors", async () => {
    const api = harness(async () => image("no-store"));
    await api.cachedPublicImage(api.request());
    expect(api.stores.get("test-images-v1")?.size).toBe(0);
    const html = harness(async () => image("public, max-age=3600", "text/html"));
    await html.cachedPublicImage(html.request());
    expect(html.stores.get("test-images-v1")?.size).toBe(0);
  });
  it("refetches after freshness metadata expires", async () => {
    let calls = 0;
    const api = harness(async () => { calls++; return image(); });
    const req = api.request();
    await api.cachedPublicImage(req);
    const meta = api.stores.get("test-image-meta-v1")!;
    for (const key of meta.keys()) meta.set(key, new Response("0"));
    await api.cachedPublicImage(req);
    expect(calls).toBe(2);
  });
});


it("uses LRU and a byte budget instead of evicting a recently viewed image", async () => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  try {
    const api=harness(async()=>image(),{maxEntries:2,maxTotalBytes:1024});
    const a=api.request("https://img.example/a.png"), b=api.request("https://img.example/b.png"), c=api.request("https://img.example/c.png");
    await api.cachedPublicImage(a);vi.setSystemTime(Date.now()+1000);
    await api.cachedPublicImage(b);vi.setSystemTime(Date.now()+1000);
    await api.cachedPublicImage(a);vi.setSystemTime(Date.now()+1000);
    await api.cachedPublicImage(c);
    const keys=[...api.stores.get("test-images-v1")!.keys()].join("\n");
    expect(keys).toContain("a.png");expect(keys).toContain("c.png");expect(keys).not.toContain("b.png");
  } finally {vi.useRealTimers();}
});

it("does not probe or download a readable HTML error twice", async()=>{
 let calls=0;const api=harness(async()=>{calls++;return image("public, max-age=3600","text/html");});
 const response=await api.cachedPublicImage(api.request());
 expect(response.type).toBe("error");expect(calls).toBe(1);
});

it("admits anonymous direct public images and fonts without caching media or signed URLs",()=>{
 const api=harness(async()=>image());
 const direct=new Request("https://img.example/direct.png",{mode:"no-cors"});
 Object.defineProperty(direct,"destination",{value:"image"});
 expect(api.publicImageRequest(direct,new URL(direct.url))).toBe(true);
 const font=new Request("https://fonts.gstatic.com/a.woff2");Object.defineProperty(font,"destination",{value:"font"});
 expect(api.publicImageRequest(font,new URL(font.url))).toBe(true);
 const signed=new Request("https://img.example/direct.png?token=secret");Object.defineProperty(signed,"destination",{value:"image"});
 expect(api.publicImageRequest(signed,new URL(signed.url))).toBe(false);
});

it("enforces the total byte limit independently of the entry count",async()=>{
 const api=harness(async()=>new Response(new Uint8Array(800),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=3600'}}),{maxEntries:20,maxTotalBytes:1024});
 await api.cachedPublicImage(api.request('https://img.example/a.png'));
 await api.cachedPublicImage(api.request('https://img.example/b.png'));
 expect(api.stores.get('test-images-v1')?.size).toBe(1);
 const key=[...api.stores.get('test-images-v1')!.keys()][0]!;
 expect(key).toContain('b.png');
});


it("bounds image admission time instead of leaving a new tab behind an old backlog",async()=>{
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});
 let finish!:(response:Response)=>void;
 let calls=0;
 const api=harness(async()=>{calls++;return new Promise(resolve=>{finish=resolve;});},{concurrency:1,timeoutMs:1000});
 try {
   const first=api.cachedPublicImage(api.request('https://img.example/old.png'));
   for(let i=0;i<20&&calls===0;i++)await Promise.resolve();
   expect(calls).toBe(1);
   const second=api.cachedPublicImage(api.request('https://img.example/new.png'));
   await vi.advanceTimersByTimeAsync(1001);
   expect((await second).type).toBe('error');expect(calls).toBe(1);
   finish(image());await first;
 } finally {vi.useRealTimers();}
});
