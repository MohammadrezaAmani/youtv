// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { imageCacheRuntime } from "../../imageCacheRuntime";

function harness(network: (request: Request) => Promise<Response>) {
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
  const context = { Request, Response, URL, caches, fetch: network,
    self: { location: { origin: "https://app.example" } } };
  const api = runInNewContext(`${imageCacheRuntime("test-")}\n({publicImageRequest,cachedPublicImage})`, context) as {
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
