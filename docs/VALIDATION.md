# Validation report — YouTV Core v0.3.0

## Executed in artifact generation environment

- `node --experimental-transform-types --test apps/worker/tests/smoke.test.mjs apps/web/src/tests/library.smoke.test.mjs apps/web/src/tests/media.smoke.test.mjs` — **17/17 pass**
- TypeScript/TSX transpilation syntax diagnostics using installed TypeScript compiler — **no syntax diagnostics**
- PostCSS parse of styles.css, refined.css, player.css — **passed**
- JSON and GitHub YAML syntax validations — **passed**
- Package and import path audit — **passed**
- ZIP integrity verification — **passed**

## Not executed / not verified

- Bun 1.4.5 is not installed in the execution container.
- npm package registry is inaccessible (DNS `EAI_AGAIN`); thus `bun install` / lockfile creation unavailable.
- `tsc --noEmit` against actual installed dependencies, Vite production build and React browser test **NOT VERIFIED**.
- Browser playback against real HLS streams and screenshot-based desktop/mobile QA **NOT VERIFIED**.
- Cloudflare Worker deployment and real streaming throughput **NOT VERIFIED**.

## Functional scope and gaps

Implemented source paths: HLS.js player, audio/subtitle menus, native browser TextTracks, external VTT and SRT conversion, per-channel subtitle source editor, live-edge, buffer reporting, fullscreen/PiP, keyboard commands, media session, fallback stream URLs, settings persistence, Teletext HTTP text page viewer, browsing/import/filtering channel library, Worker.

Explicitly not implemented: raw DVB/EBU Teletext demux/decoding from TS PIDs; bitmap DVB subtitles; protected DRM streams; backend transcoding; EPG; recording. Native Safari browser track controls may limit quality selection. Peer review and real-browser integration testing remain necessary.

Note: the portable `bun run smoke` script invokes Bun's native test runner; the executed evidence in this environment comes from the equivalent Node 22 `node:test` invocation because Bun is unavailable here.
