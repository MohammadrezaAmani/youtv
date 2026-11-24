# Validation — YouTV 0.36.1

## Executed successfully

- Node 22.16.0, built-in experimental TypeScript transformation: 58 tests passed, no failures (41 existing Worker smoke/integration tests, 9 Worker media regression tests, 4 browser-download regression tests using test doubles for the file picker, 4 media helper tests).
- Python: four DNS-curation unit tests passed.
- Worker source strict TypeScript check: passed using global TypeScript with DOM/standard Web API types and a minimal declaration of Cloudflare's ExportedHandler. This does not replace Cloudflare's actual installed type package.
- Media service and UI files: local TypeScript check passed with external module declarations supplied as temporary stubs. This does not establish full dependency compatibility.
- The Worker JavaScript bundle was generated from the real TypeScript sources with the explicit TypeScript fallback in scripts/build-dashboard.cjs, loaded and exercised in integration tests. Both Worker bundle files are byte-identical. The normal build still uses Bun.

Commands for the dependency-free tests (Node 22.16+):

```sh
node --experimental-transform-types --test apps/worker/tests/*.test.mjs apps/web/src/tests/download.regression.test.mjs apps/web/src/tests/media.smoke.test.mjs
python3 -m unittest discover -s scripts -p 'test_curate_iptv_sources.py'
cmp apps/worker/dashboard-worker.mjs apps/web/public/dashboard-worker.mjs
```

## Not verified in the delivery environment

Bun is absent; npm registry DNS lookup fails with EAI_AGAIN. The lockfile is inherited from the source baseline and must be refreshed by `bun install`. Full TypeScript checking against installed packages, Vitest, Vite production build, browser UI, real YouTube/Instagram extraction, live CDN playback, muxing/transcoding with the installed Mediabunny version and browser filesystem behavior are not certified by the local tests. No fabricated successful live-source results are included.

Before deployment run:

```sh
bun install
bun run check
bun run test
bun run build
cmp apps/worker/dashboard-worker.mjs apps/web/public/dashboard-worker.mjs
```

Then deploy the generated Worker using the existing Copy Worker code button. `/health` must report 0.36.1. Test authorized public media on the real network. Platform restrictions, DRM, unsupported codecs and login-gated media may prevent extraction or playback. The archive is a continued source-development release, not a fully validated production binary.
