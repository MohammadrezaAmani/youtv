# YouTV Core 0.3.0

A self-hosted, privacy-first IPTV/HLS personal media library built with **React 19 + TypeScript + Vite + shadcn-style Radix components + Bun**, and an **optional Cloudflare Worker**. No central backend, account, analytics SDK, demo channels, mock playlists or hard-coded channel catalog.

## Status

**Source-release / integration candidate, not a browser-verified production release.** In the delivery environment neither Bun nor the npm package registry is available, so full dependency installation, type checking and browser playback cannot be proven here. The included Node-based smoke suite passes; validate with the commands below on a networked machine before deployment.

## Features available in this source tree

- Personal IPTV channel catalog, tags, groups, favorites, pins, history, advanced filters and bulk operations
- Extended M3U import/export, duplicate management, playlists with update policies
- Live HLS via **hls.js 1.7.4**, MP4/native video, player controls and audio/subtitle preferences
- HLS multi-bitrate quality selections (Auto/ABR or a rendition), selectable alternative HLS audio language tracks
- HLS native subtitle renditions, exposed CEA captions where supported, external **WebVTT**, remote and local **SRT→WebVTT** conversion
- Captions toggle, user-selectable caption size/background, preferred subtitle and audio languages
- Keyboard shortcuts, seek, timeshift if DVR exists, live-edge, fullscreen, Picture in Picture, theater mode, speed, diagnostics, media session
- Stream fallback URLs, auto-direct-to-proxy fallback, per-channel override and multiple Worker profiles
- Teletext page browser for provider-supplied HTTP text/JSON/HTML text endpoints, page 100–899
- Six themes, Persian/English + Arabic/Turkish/Russian navigation translations, RTL/LTR, adaptive mobile / desktop layouts
- Versioned LocalStorage persistence, JSON backup without proxy tokens, GitHub Pages deployment
- Cloudflare Worker with HLS manifest rewriting, binary response streaming, range requests, CORS, SSRF and redirect protection, configurable source allowlist

**Not supported:** decoding raw DVB/EBU Teletext data embedded in MPEG-TS, DVB bitmap subtitle PIDs, DRM circumvention, transcoding codecs, guaranteed playback of arbitrary geo-blocked/paywalled sources, offline video downloads, EPG/XMLTV (planned), background recording, multi-device sync. Teletext needs an upstream page endpoint or a separate extractor/transcoder generating browser-compatible subtitles. A bare `.m3u8` does not imply a Teletext track.

## Run locally (Bun only)

Install [Bun 1.4.5](https://bun.com/docs/installation) and then:

```bash
bun --version
bun install
bun run dev
```

Open `http://localhost:5173`. Build and test:

```bash
bun run check
bun run test
bun run smoke
bun run build
```

Bun generates a `bun.lock` during the first successful install. Commit this lockfile for deterministic CI. It is **not** supplied in this archive because the package registry was unreachable in the build environment. The CI workflows currently execute `bun install` until the lockfile is committed; then change to `bun install --frozen-lockfile`.

## Web deployment (GitHub Pages)

1. Create a GitHub repository and push the files.
2. In repository Settings → Pages, set Source to **GitHub Actions**.
3. A push to `main` triggers `.github/workflows/deploy-pages.yml`.
4. For a standard project site (`OWNER.github.io/REPO`), the workflow auto-sets `VITE_BASE_PATH=/REPO/`.
5. For a custom-domain installation set the repository variable `YOUTV_BASE_PATH=/` (or your intended base path).

Routing uses `HashRouter`, so client-side pages work without server rewrite rules.

## Optional Cloudflare Worker

The Worker is a **public-destination** HLS proxy, separate from GitHub Pages. `ALLOWED_HOSTS` defaults to `*`, accepting public DNS hostnames (including redirected segment hosts) without per-channel configuration. Private/local hosts, IPv4/IPv6 literals and non-HTTP(S) URLs are always blocked. To restrict upstreams, set an explicit comma-separated domain allowlist instead of `*`.

`https://mohammadrezaamani.github.io` and loopback development origins (`http(s)://localhost:<port>`, `127.0.0.1` and `[::1]`) are permitted automatically. Set `ALLOWED_ORIGINS` only to **add** other exact browser origins. A custom domain will need to be added explicitly.

```bash
cd apps/worker
bunx wrangler login
bunx wrangler deploy
# OPTIONAL: require authentication using a Cloudflare secret
bunx wrangler secret put PROXY_TOKEN
```

`PROXY_TOKEN` is optional. If omitted/blank, YouTV can save a Worker profile with an empty token and all playback, HLS segments, playlist imports and probes work without a `key` query parameter. When `PROXY_TOKEN` exists, enter the exact same secret into YouTV; all routes carrying upstream data require it. **Never commit secrets**. Wrangler is configured with `keep_vars: true` to preserve variables set in the Cloudflare dashboard on subsequent CLI deploys; existing settings may need to be corrected manually.

**Exposure warning:** combining `ALLOWED_HOSTS=*` with no `PROXY_TOKEN` makes the Worker an unauthenticated proxy to public hosts, allowing anyone who knows its URL to consume your Worker quota. Set a secret or narrow the hostname list if abuse is a concern.

Worker use for large-scale delivery of video may be restricted by Cloudflare service-specific terms. It also cannot bypass DRM, codec restrictions or a provider's authorization checks. Keep streaming sources lawful and licensed for the intended use.

## Streaming limitations

- A remote stream must be reachable from the user's browser (direct), or from the chosen Worker (proxy).
- Mixed `http://` content is typically blocked on HTTPS GitHub Pages. Use HTTPS streams.
- HLS audio languages, subtitle renditions, resolutions and DVR are listed only if the source **actually exposes** them.
- Browsers differ. On some Safari/iOS devices, native HLS or OS-level media controls may be required and quality/audio APIs can be limited.
- Local SRT/VTT subtitle files are loaded for the current browser session. For durable subtitles, add an accessible HTTPS subtitle URL to a channel.
- Teletext page URL example: `https://provider.example/teletext/{page}.txt` (replace `{page}` with 100–899). HTTP endpoint requires CORS or the selected Worker; it does not decode Teletext from `.ts` segments.
- User passwords and protected CDN cookies are not forwarded by the Worker. Protected links may fail.
- Channel data and Worker tokens reside in browser LocalStorage. Export backups regularly; imported backups intentionally don't contain Worker tokens.

## Structure

```
apps/web                 React client + library + streaming UI
apps/worker              Cloudflare Worker proxy
packages/shared          Zod types and persistence schema
.github/workflows        Bun CI, Pages deployment, optional Worker deployment
apps/web/src/tests       Library + playlist + media tests
apps/worker/tests        HLS proxy tests
```

## License

See [LICENSE](./LICENSE). Nothing in this project grants a license to rebroadcast third-party channels.


## نسخه 0.4: Patch به‌جای ZIP

مراحل ارتقا و قابلیت‌های Default Playlist، تست اتصال، مدیریت Cloudflare، اتصال خودکار مجدد و Backup کامل در [راهنمای فارسی v0.4](docs/UPGRADE-v0.4.fa.md) آمده است. فایل `apps/worker/dashboard-worker.mjs` برای کپی مستقیم در Cloudflare Dashboard فراهم است.


## YouTV 0.5 browser recording and UI design system

This release adds local live-TV recording with MediaRecorder, optional direct file writing (where the browser supports the File System Access API), a bounded browser-memory fallback, a configurable recording bitrate that survives backup/restore, and shared custom React inputs, Radix selects, checkboxes, radios, sliders, file inputs, textareas, date picker and action buttons.

**Recording is only available while a stream is actively playing and the browser tab remains open.** The recorded output is re-encoded by the browser and may omit subtitles/teletext; DRM, CORS restrictions and unsupported browsers prevent some sources from recording. See `docs/UPGRADE-v0.5.fa.md` for step-by-step installation and limitations.


## YouTV 0.18 PWA and iOS

`bun run build` generates `manifest.webmanifest` and `sw.js` with correct GitHub Pages base paths. The worker caches the built application shell (HTML, JS, CSS and icons) for offline navigation, but never captures IPTV playlists, Cloudflare requests or video segments. iOS Safari: Share → Add to Home Screen. Installation and update controls are in Settings. Inputs are set to 16 CSS pixels on phones to avoid Safari's unwanted focus zoom without blocking user pinch-zoom. See `docs/UPGRADE-v0.18.fa.md`.

## YouTV 0.19 mobile playback

The player now prefers native HLS on iOS/iPadOS, even when `hls.js` reports MediaSource support. Native playback does not request CORS-enabled video; browsers still enforce HTTPS mixed-content, codec, and source authorization restrictions. On iOS, start audio with a user tap. Multi-view controls are located with the player action icons, not in the page header. See `docs/UPGRADE-v0.19.fa.md` for deployment and limitations.
