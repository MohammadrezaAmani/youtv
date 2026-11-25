# Playback repair and validation — 2026-11-25

The verified success is continuous **4 Kurd direct playback**, including the user's real Chrome profile. Remote Cloudflare playback is **not accepted as fixed**: standalone browser requests to deployed Workers still sometimes stop before the segment body completes. A passing local Worker test and a passing curl transfer do not establish that the deployed browser path works.

## Verified causes and changes

| Reproduction / cause | Repair and regression coverage |
| --- | --- |
| An upstream returned a complete HLS document with HTTP 206. The Worker only rewrote 200 responses, leaving relative segment names to resolve against the Worker hostname. | Manifest requests omit Range/If-Range upstream. Complete unsolicited 206 manifests are normalized to 200 and rewritten against the final upstream URL; incomplete partial documents return an explicit 502 instead of a broken playlist. Media Range/206 forwarding remains intact. Worker `playlistRange.test.ts`. |
| A pending playlist could consume the single startup foreground permit, leaving the first required fragment queued with no active downloader. Reproduced with the real player and a regression test. | Separate essential-request reservations from media permits. Playlist/key/init traffic reduces speculative admission but cannot block required audio/video. `hlsLoader.regression.test.ts`. |
| A fragment queued behind the concurrency limit did not always have a completion promise. The main loader could then fetch it independently. Keys also carry a fragment reference and could be mistaken for cacheable media. | Allocate completion before admission; join required requests with the same queue and bytes. Cache only explicit full media-fragment contexts. Unsupported encrypted-range/header/part contexts use the installed loader. |
| Cancelled work could retain a permit; initial live anchoring could cancel useful startup prefetch; consumed markers survived seeking. | Idempotent permit release, prompt claim settlement, initial-anchor tolerance, seek invalidation, and completion-driven scheduling. `hlsPrefetch.test.ts`. |
| URL normalization stripped authorization parameters and could match different signed resources. Cached delivery used unnecessary network indirection and ambiguous callback state. | Preserve exact authorization-bearing URLs, range, rendition, track, discontinuity/sequence and init identity within a session. Deliver a fresh ArrayBuffer from retained immutable bytes, with measured network timing; guard terminal callbacks and destruction. Cache delivery failure falls back to the actual HLS.js loader. |
| Unknown Content-Length was reported as `total = loaded`, making an incomplete transfer look complete. | Keep unknown total at zero until success. Preparation UI uses measured speed and known media bitrate only; otherwise ETA is explicitly unknown. Loader regression test. |
| Native-HLS preference based on Apple identification changed a previously usable playback engine. Native video fullscreen can suspend a JavaScript-fed pipeline. | Capability-first HLS.js selection, native alternative after an eligible fatal media failure, bounded engine switching. HLS.js/DASH fullscreen stays in the element or viewport without rebuilding the engine. Native HLS can use native video fullscreen. Physical iOS remains unverified. |
| Initial manifest errors could call `startLoad()` before any levels existed, which does not reload an absent master. Aggressive recovery could jump over valid accumulated media. | Initial manifest failure reconnects; level loading is retried only when levels exist. Recovery preserves contiguous playable media. Shared behavior also applied to MultiView. |
| The user's saved default was Proxy-only. A temporary Direct button selection in one tab did not persist into another. | Initially saved Auto only on channel `b78cc29f-3519-4f15-ba8b-08d90954aef6`, as requested. A fresh tab retained it. On the user's later explicit instruction, both global television and Media Center defaults were also changed to Auto; explicit channel overrides were retained. |
| That save initially failed because another channel already had the same URL: duplicate validation rejected an unchanged URL during any edit. | Check duplicate URLs only for additions or actual URL changes. Actual React form regression `channelEdit.test.ts`. |
| Development skipped Service Worker registration, so localhost asset requests did not use the production persistent cache. Slow obsolete image requests could occupy the queue across tabs. | Development now has an asset-only Worker. Production retains its versioned app shell and compatible persistent image cache. Coalesce identical requests, bound queue/network time, prioritize current requests and remove cancelled queue entries. |
| The mobile error overlay sat below player controls, so touches hit covered controls. | Correct stacking, disable covered controls, wrap error actions and retain touch targets. Real browser touch tests at 320/390/844px passed. |
| Generating the same public Worker bundle rewrote files and triggered Vite reloads during playback tests. | Write generated bundles only when bytes change. This prevents an identical bundle/check run from resetting development playback. |

## Playback and scheduling

- HLS.js is selected using actual support; native HLS is used when appropriate support/fallback requires it. DASH retains its existing engine. This is not a blanket iOS engine rule.
- Stable HLS: low latency off; startup waits for two segments, bounded to 5–15 seconds and short-VOD duration. Target buffer 60 seconds, maximum 120, MSE byte target 64 MiB, back buffer 20 seconds.
- Live synchronization targets ten published segment durations, maximum thirty, playback catch-up rate 1. This is approximately 50 seconds for 4 Kurd's five-second fragments; it is not a promise of a 90-second delay for all streams.
- Startup admits essential work. After initial fragment buffering, normal adaptive concurrency is 2–8. Critical starvation can reduce speculative admission below two; required traffic has priority. No batch barriers and no default 16-request setting.
- Priorities combine distance/deadline, contiguous buffer, estimated transfer time and audio preference. EWMA measurements and aggregate-throughput probes govern additive increases/multiplicative decreases. Slow requests alone do not trigger increases.
- Overall loading policies allow 300 seconds, up to three fragment retries. A 30-second lack of byte progress can trigger recovery when buffering is threatened; healthy progress is retained.
- Prefetch horizon defaults to 90 seconds and is capped at 120. Memory is bounded to 192 MiB / 96 entries, with an 8 MiB per-fragment default cap. Cache is session-local and retains safe bytes until append confirmation or obsolescence. Seeks, rendition changes and cleanup cancel obsolete work.
- No future URLs are invented. No virtual live archive was implemented: a source with a tiny published window cannot be promised a 60–90-second client delay simply by increasing HLS.js buffer settings. The tested 4 Kurd window contained about 100 seconds of published media.
- Optional diagnostics expose engine/route, buffer, refresh age, pool/cache counters, measured throughput/TTFB, errors and recoveries without printing sensitive URL parameters. Preparation displays elapsed time, playable buffer, received bytes, measured ETA when available, and explicit inactivity/unknown states.

## Real browser results

All media below is the genuine `https://4kuhls.persiana.live/hls/stream.m3u8`, not fixture media. Measurements start after actual playing; decoded frames, currentTime, readyState and buffer were inspected. Scripts are `scripts/validate-playback.cjs`, `validate-playback-layout.cjs` and `validate-asset-cache.cjs`; they accept an externally installed Playwright module without adding an application dependency.

| Browser / path | Wall / media progression | Stalls after start | Other evidence |
| --- | --- | --- | --- |
| Chromium production, direct | 200.915 / 200.872 s | 0 | 42 playlist requests; 50 segment requests; zero repeated exact URL+Range; fullscreen enter/exit passed |
| Chromium direct, 400ms latency / 350,000 B/s cap | 200.924 / 200.881 s | 0 | 44 playlist requests; zero repeated exact URL+Range; fullscreen passed |
| Chromium iPhone UA, touch/mobile viewport | 200.929 / 200.886 s | 0 | Viewport fullscreen fallback enter/exit passed; this is not Safari or a physical iPhone |
| Chromium direct, 10-second browser offline interval | 201.011 / 200.969 s | 0 | Buffer sustained playback; playlist/segment activity continued after reconnection; no repeated exact URL+Range |
| Firefox 157, direct | 201.608 / 201.610 s | 0 | 42 playlist requests; zero repeated exact URL+Range; fullscreen passed |
| Local Worker 0.36.2, proxy | 200.931 / 200.888 s | 0 | Fullscreen passed; one initial repeated segment request remains in this recording |
| Local Worker, same slow profile | 200.923 / 200.879 s | 0 | Fullscreen passed; one initial repeated segment request remains in this recording |
| User's actual Chrome, temporary Direct test | 341.695 / 341.652 s | 0 | 8,546 decoded frames; readyState 4; ~48.4 s contiguous buffer at end |
| User's actual Chrome, **fresh tab with saved channel Auto** | 230.850 / 230.842 s | 0 | 5,771 additional frames; readyState 4; not paused; global route still Proxy-only |
| Deployed Workers, Chromium / Firefox | Failed to start in 45 s in automated runs | N/A | Zero decoded frames; manifest/segment transfer can remain incomplete |

WebKit could not launch because the environment lacks required ICU/JPEG libraries. No physical iPhone/iPad test was performed. Fullscreen behavior under real Safari page suspension therefore remains a required device check. Media Center and MultiView compile and their existing tests pass, but were not each subjected to a separate multi-minute real-stream soak.

## Upstream and proxy checks

- The supplied TinTV/AFN master was fetched directly and through both configured Workers; nested playlists were genuine. Direct playback was observed for about 94 seconds, not a three-minute acceptance run.
- Direct 4 Kurd segment downloads completed in Chromium (roughly 916 KB in 0.6 s in one probe). Standalone browser downloads through both remote Workers repeatedly received only about 57–103 KB before stalling. This reproduces outside the React player. Curl could receive matching complete bytes through the same Workers, and the local Worker could deliver a full segment in the browser in about 1.15 s. The exact remote transport/network cause is **unresolved**, not proven to be the HLS scheduler.
- HTTP/1/QUIC settings and a small Range experiment did not establish a reliable repair. The experimental segment-splitting implementation was removed.
- `meow.arushop.ir/health` now reports 0.36.2; the user updated it during this session. We did not deploy it. New version detection does not establish continuous remote playback.
- The supplied Wikimedia Bushehr PNG returned 200 with image bytes. The aparatchi SVG endpoint reset the direct connection in this environment. Several original GitHub logos returned valid 200 public PNGs, but a pending/failed initial Worker transfer cannot be made usable by caching it.
- SSRF, access-control, signed query strings, custom IPTV hints, Wikimedia identification/rate limits and media Range behavior retain regression coverage. No DNS-Google resolver or additional infrastructure was introduced.

## Persistent assets

Cache First applies only to eligible successful public image/font responses and safe Google Fonts CSS. Live manifests, media, HTML, dynamic APIs, private/no-store/no-cache responses, signed/private URLs, ranges, incorrect image MIME and unreadable opaque bodies are excluded. Anonymous CORS probes are used only where appropriate; browser security is not disabled. An opaque fallback can use ordinary HTTP cache but cannot receive the same validated persistent-cache guarantee.

Defaults: 512 entries, 2 MiB per object, 64 MiB total, maximum seven days (bounded by upstream freshness), three active fetches and bounded waiting/network deadlines. Options support smaller/larger configured limits. Compatible image caches survive frontend deployments; application code remains versioned. Invalid responses are never cached as images.

With HTTP cache disabled, a genuine 500px public logo was decoded on initial load, repeat load, a second tab and reload. Both development and production runs observed **one total Service Worker network transfer** for all four displays. This proves those successful assets are reused; it does not prove a remotely stalled first download can finish or every upstream permits caching.

## Commands and deployment

- `bun install --frozen-lockfile`: passed; no dependency changes.
- `bun run check`: passed shared/web/Worker TypeScript.
- `bun run test`: real Vitest, 34 web files / 220 tests and 5 Worker files / 51 tests passed after the compact preparation/Auto-route/defaults update; native Bun smoke suites also passed (7 web and 65 Worker tests).
- `bun run build`: passed. Existing Vite chunk-size warnings remain.
- `bun run dashboard:bundle`: passed; generated Worker version 0.36.2.
- GitHub Pages `/youtv/` base build and `VITE_BASE_PATH=/youtv/ bun scripts/verify-pages-assets.mjs`: passed; root development build subsequently restored.
- `git diff --check`: passed.

Publish the frontend through the existing GitHub Pages workflow or deploy `apps/web/dist` with the project's configured base path. For another Worker still older than 0.36.2, deploy `apps/worker/dashboard-worker.mjs` through the existing dashboard installer, preserving secrets, access settings and routes, or use the repository's existing `bun run worker:deploy` configuration. The supplied meow Worker already advertises the new version, so redeployment alone is not a demonstrated cure for its stalled browser transport.

Changes are concentrated in the shared HLS loader/prefetch/buffer/fullscreen modules, PlayerStage/MultiView, ChannelDialog validation, image-cache/PWA generation, Worker manifest handling, CSS, focused regression tests and optional real-browser validation scripts. Generated dashboard bundles are included. Existing local default-Worker and documentation edits were preserved. No commit or external deployment was made by the agent. Global user routing was changed to Auto only after the user's later explicit request.

## Compact preparation control and Auto-route update

The preparation block has been removed from the page flow. `PreparationIndicator.tsx` renders a small question mark and a determinate SVG ring in the existing player controls. The ring shows contiguous playable buffer / startup target (complete when ready). Details exist only while the viewer opens the control; a fixed, non-modal popover supports outside-click and Escape dismissal. It does not add a row or move content below the player. Browser geometry checks at 320, 390 and 1280px found unchanged player/shell heights and following-content positions, no horizontal control overflow, and a popover within the viewport. Screenshots were visually inspected. `scripts/validate-preparation-ui.cjs` reproduces this with the real channel.

For HLS.js playback in **Auto** mode, `hlsAutoRoute.ts` compares direct and the selected Worker concurrently. A successful candidate must supply a valid playlist chain and one **complete published video fragment**, rather than just an early status/header or a fast manifest. The choice has a four-second decision budget. If no completed candidate has won, ordinary playback takes the still-running direct request, or the Worker request if direct actually failed. Already-received bytes and real timing/progress counters are handed to `hlsRelayLoader.ts`; selected work is not restarted at the decision deadline. The losing route is cancelled. Individual probe bodies have bounded size (256 KiB playlists, 2 MiB fragment), and the selected request keeps the existing 300-second overall / threatened-buffer inactivity policies. Unsupported byte-range/variable/part/deeply nested probe cases are inconclusive and retain standard HLS loading; they do not mark a responsive direct route as failed.

This comparison respects explicit Direct/Proxy modes, mixed-content rules, native-only capabilities and the existing Apple/custom-header Worker requirement. It does not periodically switch a working stream or change saved routing preferences. Bootstrap responses are session-specific and retired after the first main fragment append, so an unused bootstrap fragment cannot later satisfy a seek or a reused live URL. Normal rendition/range/sequence-aware caching remains in the shared prefetcher. This update requires a frontend release, not another Worker version.

Two integration errors found during this update were fixed before accepting its browser results:

- Normalizing **only the direct warm manifest** to absolute fragment URLs made HLS.js 1.7 reject later overlapping relative-URI updates with a media-sequence mismatch. Direct warm responses now retain the original playlist spelling and final response URL. A regression was observed failing with the absolute URL and then passing with the original relative URI. Worker rewriting retains its existing normalization.
- Pressing Play while a route check was pending could call `video.play()` before MediaSource existed and queue a browser play promise that bypassed startup buffering. The non-Apple HLS.js path now retains playback intent until its engine and initial buffer are ready. The real-browser script checks initial contiguous buffer as well as sustained progression. Apple gesture behavior is retained and remains subject to the physical-device limitation above.

New deterministic coverage includes a fast manifest with a stalled video body, a working Worker with failed direct access, deadline handoff without re-downloading, unsupported/inconclusive probes, channel cancellation, real-loader binary delivery and destruction, and opt-in progress details with keyboard dismissal. Preliminary repaired Auto runs each passed ~201 seconds (normal, 400ms/350,000 B/s and iPhone Chromium emulation), with no post-start stalls or duplicate URL+Range requests. Final reruns and machine-readable evidence are recorded in `playback-validation-results.json`; remote Cloudflare transport limitations described above still apply.

### Auto defaults, including assets and Media Center

At the user's explicit follow-up request, fresh state and missing-field schema defaults now use `proxyMode: "auto"` and `mediaRouteMode: "auto"`. Legacy initialization no longer rewrites saved Auto settings to Proxy-only. Existing explicit Direct/Proxy choices in other profiles and channel overrides are preserved. In the user's current browser, both television and Media Center Auto settings were saved through the UI and remained selected after reload; the configured meow Worker was retained.

Images in PlayerStage and MultiView now retain the effective Auto policy even when video itself selected a Worker. That Worker remains the preferred image fallback, not a reason to force HTTPS images through it. An HTTP video source likewise does not force an unrelated HTTPS logo onto a proxy; HTTP images on an HTTPS page still require relay. Media Center Auto images and file assets try their direct route before configured Workers, including when platform extraction needed a Worker. Explicit Proxy-only privacy behavior retains its tests.

The genuine original `4Kurd.fr.png` from the user's GitHub logo source was decoded at 512px on initial load, repeat load, a second tab and reload with browser HTTP cache disabled. All four displays required **one total Service Worker network transfer**. The default/migration tests now assert Auto and continue asserting that explicit Direct/Proxy preferences survive initialization. Older backups without media routing settings also default to Auto.
