import { createHash } from "node:crypto";
import type { Plugin } from "vite";
import { imageCacheRuntime } from "./imageCacheRuntime";

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

/** Cache the static shell and public image subresources, never playback requests. */
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
  return `/* YouTV static app-shell and public image cache. IPTV playback is network-only. */
'use strict';
const CACHE_NAME=${JSON.stringify(cacheName)};
const CACHE_PREFIX=${JSON.stringify(cachePrefix)};
const PATHS=${JSON.stringify(paths)};
const HOME=new URL('index.html',self.registration.scope).href;
const ASSETS=PATHS.map(path=>new URL(path,self.registration.scope).href);
const STATIC=new Set(ASSETS);
${imageCacheRuntime(cachePrefix)}
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys()){
      if(key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME&&key!==IMAGE_CACHE&&key!==IMAGE_META)await caches.delete(key);
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
  // Cross-origin image subresources of a controlled page reach this worker.
  if(!STATIC.has(url.href)&&publicImageRequest(request,url)){
    event.respondWith(cachedPublicImage(request));
    return;
  }
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
  // /sources/, video, range requests or API responses through the app-shell cache.
  if(request.headers.has('range')||url.search||!STATIC.has(url.href))return;
  event.respondWith((async()=>{
    const cached=await caches.match(url.href);
    return cached||fetch(request);
  })());
});
`;
}

/** Development uses persistent asset caching without caching HMR, app code,
 * navigation documents or media. It shares the compatible image cache schema. */
export function devAssetServiceWorker(base: string) {
  const prefix = `youtv-pwa-${base.replace(/[^a-z0-9-]/gi, "_")}-`;
  return `"use strict";\n${imageCacheRuntime(prefix)}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.method==='GET'&&publicImageRequest(event.request,new URL(event.request.url)))
    event.respondWith(cachedPublicImage(event.request));
});`;
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
      // The dev worker caches only public images/fonts. HMR and source modules
      // remain network-only; production still uses the versioned shell worker.
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (path === `${base}image-cache-sw.js`) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Service-Worker-Allowed", base);
          res.end(devAssetServiceWorker(base));
          return;
        }
        if (path !== `${base}manifest.webmanifest`) return next();
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
            /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|svg|webp|avif|gif|ico)$/i.test(name),
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
