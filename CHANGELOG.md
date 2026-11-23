## v0.21.0 — Responsive player, related channels and connectivity status
- Remove the extra HTTP/HLS and ICMP/CORS explanatory paragraphs from the signal monitor.
- Report browser `Failed to fetch` (and its Safari/Firefox equivalents) as offline; preserve explicit cancellation and timeout as unknown and keep definitive DNS NXDOMAIN details.
- Make related channels wrap beneath the player on mid-size screens; constrain channel rows and truncate long titles without horizontal overflow.
- Use video-width container queries to keep fullscreen always visible; move secondary player actions into the More menu at reduced widths.
- Run Worker `.mjs` integration tests with Bun instead of Node's version-dependent `--experimental-transform-types` flag.

## v0.20.0 — DNS-aware status and curated GitHub Pages sources
- Classify confirmed DNS NXDOMAIN/no A/AAAA as offline during browser scans (DoH fallback after inconclusive HTTP), not unknown. Never classify SERVFAIL/timeout as dead.
- Merge IPTV sources with full EXTINF / VLC / Kodi metadata, remove duplicate stream identities without conflating different required HTTP headers, and resolve each distinct public hostname just once.
- Deploy only A/AAAA-resolved streams from GitHub Actions, keep original source files untouched, and publish a curation summary with verifiable provenance.
- Preserve per-source enable toggles, folder structure and README.md documentation for DNS-screened collections.
- Keep permanent originals in git and upload recoverable NXDOMAIN/no-address/uncertain/private/duplicate archives and audit reports as workflow artifacts.
- Replace the built-in playlist only in the disposable CI checkout; refresh existing browser-local bundled lists by the curation digest without losing saved favorites.
- Never treat DNS resolution as proof of HTTP access, codec support or working playback.

## v0.18.0 — Installable PWA, offline UI and iOS keyboard behavior
- Built PWA manifest and service worker with GitHub Pages subpath awareness.
- Added iOS Home Screen and Android/desktop PWA icon sets, including maskable artwork.
- Precache only the built app shell; never intercept IPTV playlists, remote media or Worker API calls.
- Allow manual update checks and user-confirmed reload from Settings, never during a live stream without consent.
- Prevent iOS focus auto-zoom by using 16px form input text, retain user pinch-zoom and adapt safe areas / keyboard.

## v0.10.0
- Restore theme accent colors, remove header/sidebar seam lines.
- Add in-app copy Worker script and correct Cloudflare dashboard steps.

## v0.9.0 — dashboard shell rebuild

- Replaced the legacy mixed-direction header/sidebar with a unified Anama-style RTL dashboard shell.
- Added a concave upper sidebar seam and rounded main-content junction, using dedicated theme-safe CSS.
- Fixed deterministic collapsed sidebar width, icons-only labels, active states and persisted preference.
- Added searchable navigation, an off-canvas mobile drawer, and an adaptive bottom bar.
- Kept existing player, channel and worker features untouched.

## v0.6.0 — live buffering, signal monitor and categories

- Prefetch HLS fragments with bounded forward buffer and live latency recovery watchdog.
- Present signal scan status across cards and filters; scope scans to groups, tags and sources.
- Remove 300-result cap; page through all stored results and open channels directly.
- Add searchable categories with real group counts and status summaries.
- Remove unsolicited scan prompt from the main library.
- Add an actionable Persian/English Cloudflare setup guide.
- Separate Vitest and Node test runner to prevent false "No test suite" failures.
- All changes distributed as a patch on top of v0.5.0.

## v0.4.0 — Bundled playlist, recovery, connectivity and browser-side management

- Bundled exact uploaded `default.m3u8` as an enabled-by-default, optional source; 2,203 EXTINF entries.
- Protected personalized tags/favorites/pins when refreshing or hiding built-in sources.
- Health checks with cancellable bounded scans, CORS-safe unknown classification and results filtering.
- Player reconnect/backoff/stall detection and HLS rendition quality preferences.
- Full versioned browser backup and merge/replace import, with optional Worker-token inclusion.
- Cloudflare management through an authenticated personal-Worker bridge: verify/list/inspect, workers.dev toggles, and explicit PROXY_TOKEN/ADMIN_TOKEN rotation.
- Self-contained Cloudflare dashboard Worker code for initial setup without a terminal.
- Built-in GitHub Pages support and dedicated integration/unit tests.

# YouTV changelog

## 0.3.0 — Player / Bun / Teletext extension

- Migrated package manager, scripts, workflows and deployment documentation from pnpm to Bun 1.4.5.
- Replaced basic preset video player with a modular hls.js-based React player and custom media controls.
- Added HLS quality, audio rendition and subtitle track menus, as available from each origin.
- Added native subtitle track selection and sidecar WebVTT and SRT→WebVTT conversion with local-file import.
- Added global preferred audio/subtitle languages and caption size/background settings.
- Added player shortcuts, progress, live edge, playback rate, PiP, fullscreen, theater, diagnostics and media session controls.
- Added Teletext HTTP page viewer and per-channel page template editor; does NOT decode embedded DVB Teletext from MPEG-TS.
- Added multiple per-channel source URLs and source failover plus manual selection.
- Added VOD resume position persistence.
- Kept the channel library, tags, favorites, bulk actions, search, filters, playlists and proxy manager from 0.2.0.
- Expanded testing to 17 dependency-free smoke tests plus existing TypeScript unit tests.
- Reworked default theme to the YouTV charcoal/rose palette and updated brand icon.

Important: no real-browser, Bun dependency install, or Vite production build proof was possible in the artifact environment; see docs/VALIDATION.md.

## v0.4.0 — Default playlist, reconnect, connectivity, Cloudflare admin, full backup
- Bundled user-supplied `default.m3u8` (2203 EXTINF entries) as a *local* default source, toggle without deleting channel customizations.
- Channel grid paging for large playlists and status-based filtering.
- HLS reconnect with capped exponential backoff, stall detection, playback resume and stable quality preference via hls.js rendition heights.
- Concurrency-limited HTTP probes (not ICMP) with CORS-safe unknown results, cancel, stored results and optional startup scan.
- Secure, allowlisted Cloudflare management API bridge, plus a single-file dashboard deployment artifact. Token remains only in React state.
- Versioned full backup and import with merge/replace, including all settings and optional Worker access tokens; never exports Cloudflare management API token.

## v0.5.0 — Browser Recording & YouTV UI primitives
- Local recording control with start, pause/resume, stop/save, elapsed time and output bitrate.
- Streaming file writes via File System Access when supported, bounded-memory download fallback.
- Shared responsive form controls: Radix Select, checkbox, radio, slider, textarea, file picker, date picker and semantic action button.
- Fix Picture-in-Picture React typing, Cloudflare input and settings handlers, health probe schema and M3U export test.

## v0.13.0

- Decoupled Rose Light/Dark and Mint Light/Emerald Dark theme families.
- Fixed Multi-view entry: automatic second channel, searchable add, four simultaneous independently managed HLS tiles, audio isolation and resize.
- One-row mobile header search with relocated navigation menu.
- Responsive related-channel rail with bounded initial results.
- Removed redundant LIVE badges from channel cards.

## v0.19.0 — Mobile HLS playback and multi-view actions
- Prefer Safari/iOS native HLS even on recent iOS versions exposing Managed Media Source.
- Do not add a CORS opt-in on native HLS media elements; keep it for hls.js MSE playback.
- Provide a touch-to-play state instead of a stalled loading state on iOS and report HTTPS mixed-content and unsupported codec errors.
- Correct Worker HLS routing for auto-detected `.m3u8` streams and automatically fall back from mobile direct playback when Auto mode has an enabled Worker.
- Use the same mobile engine selection in Multi-view tiles, with user-gesture audio unmute.
- Move Multi-view action from the watch page toolbar into the controls beneath the primary player; manage active multi-view below the grid.
