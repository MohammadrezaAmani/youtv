# YouTV v0.4 local validation

The available environment has **no Bun executable, no installed project dependencies and no functioning npm registry DNS resolution**. Consequently, a real `bun install`, `bun run check`, `bun run build` and browser-based HLS playback test could **not** be completed. These must not be called passing.

Verified offline:

- Node v22.16.0 `--experimental-transform-types` ran 17 original smoke tests: 17 passed.
- Worker standalone bundle executed 9 integration tests (synthetic HTTP upstreams): 9 passed.
- `typescript.transpileModule` syntax diagnostics on all 42 TS/TSX source/test files: 0 errors. This is **not a TypeScript semantic type-check**.
- `node --check` on `apps/worker/dashboard-worker.mjs`: passed.
- `git apply --check` and applying the patch to a clean v0.3 copy after captions fix: see final validation.
- Byte-for-byte comparison of `apps/web/public/default.m3u8` with user-uploaded file: see final validation.

Not verified:

- Real Cloudflare API permission scope, deployment, Workers routing or Cloudflare service policy compliance.
- Actual cross-browser playback, Safari native HLS quality controls, subtitle behavior and live CDN streams.
- Runtime UI rendering and responsive layout in browser.
- Vitest suite for new backup/connectivity modules (requires installed dependencies).

Use the project commands `bun install`, `bun run check`, `bun run test`, `bun run build`, and `bun run dev` on a connected machine.
