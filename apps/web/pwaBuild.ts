import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** Vite emits a scope-correct manifest and a cache-bounded service worker for GitHub Pages. */
export function pwaManifest(base: string) {
  return {
    id: base,
    name: "YouTV — Personal IPTV Player",
    short_name: "YouTV",
    description: "Personal IPTV playlists, live TV and HLS player",
    lang: "fa",
    dir: "rtl",
    start_url: `${base}#/`,
    scope: base,
    display: "standalone",
    display_override: ["standalone"],
    background_color: "#0e0c12",
    theme_color: "#17121b",
    icons: [
      {
        src: `${base}icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}icons/maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Channels",
        short_name: "Channels",
        url: `${base}#/channels`,
        icons: [{ src: `${base}icons/icon-192.png`, sizes: "192x192" }],
      },
      {
        name: "Favorites",
        short_name: "Favorites",
        url: `${base}#/favorites`,
        icons: [{ src: `${base}icons/icon-192.png`, sizes: "192x192" }],
      },
      {
        name: "Playlists",
        short_name: "Playlists",
        url: `${base}#/playlists`,
        icons: [{ src: `${base}icons/icon-192.png`, sizes: "192x192" }],
      },
    ],
  };
}

/** Never intercept IPTV sources, Worker requests, HLS fragments or media streams. */
export function pwaServiceWorker(
  base: string,
  files: string[],
  revision: string,
) {
  const paths = [
    ...new Set([
      "index.html",
      "manifest.webmanifest",
      "icon.svg",
      "apple-touch-icon.png",
      "icons/icon-192.png",
      "icons/icon-512.png",
      "icons/maskable-512.png",
      ...files,
    ]),
  ];
  const safePrefix = base.replace(/[^a-z0-9-]/gi, "_");
  const cachePrefix = `youtv-pwa-${safePrefix}-`;
  const cacheName = `${cachePrefix}${revision}`;
  return `/* YouTV static app-shell worker. IPTV and remote media are deliberately network-only. */
'use strict';
const CACHE_NAME=${JSON.stringify(cacheName)};
const CACHE_PREFIX=${JSON.stringify(cachePrefix)};
const PATHS=${JSON.stringify(paths)};
const HOME=new URL('index.html',self.registration.scope).href;
const ASSETS=PATHS.map(path=>new URL(path,self.registration.scope).href);
const STATIC=new Set(ASSETS);
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME)await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try {return await fetch(request);}
      catch {return (await caches.match(HOME))||Response.error();}
    })());
    return;
  }
  // Only the build-time allowlist is cached; never cache playlists, URLs with tokens,
  // /sources/, video, range requests, cross-origin assets or API responses.
  if(request.headers.has('range')||url.search||!STATIC.has(url.href))return;
  event.respondWith((async()=>{
    const cached=await caches.match(url.href);
    return cached||fetch(request);
  })());
});
`;
}

export function youtvPwaPlugin(): Plugin {
  let base = "/";
  return {
    name: "youtv-pwa-shell",
    configResolved(config) {
      base = config.base;
      if (!base.startsWith("/"))
        throw new Error(
          "YouTV PWA requires an absolute VITE_BASE_PATH, such as / or /repo/",
        );
      if (!base.endsWith("/")) base += "/";
    },
    configureServer(server) {
      // The dev site still exposes a valid manifest. A caching SW is production-only
      // so HMR and source editing never get stuck behind stale script caches.
      server.middlewares.use((req, res, next) => {
        if ((req.url || "").split("?")[0] !== `${base}manifest.webmanifest`)
          return next();
        res.statusCode = 200;
        res.setHeader(
          "Content-Type",
          "application/manifest+json; charset=utf-8",
        );
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(pwaManifest(base)));
      });
    },
    generateBundle(_options, bundle) {
      const fileNames = Object.keys(bundle)
        .filter(
          (name) =>
            name.startsWith("assets/") &&
            /\.(?:js|css|woff2?|ttf)$/i.test(name),
        )
        .sort();
      const digest = createHash("sha256");
      for (const name of fileNames) {
        const entry = bundle[name];
        if (!entry) continue;
        digest.update(name);
        if (entry.type === "asset") digest.update(entry.source);
        else digest.update(entry.code);
      }
      const index = bundle["index.html"];
      if (index?.type === "asset") digest.update(index.source);
      const revision = digest.digest("hex").slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify(pwaManifest(base), null, 2),
      });
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: pwaServiceWorker(base, fileNames, revision),
      });
    },
  };
}
