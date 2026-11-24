// @vitest-environment node
import { test, expect } from "vitest";
import { createServer } from "node:http";
import { builtinWorker, BUILTIN_WORKER_ID, defaultState, ensureDefaultWorker, type WorkerProfile } from "@youtv/shared";
import { fetchTextWithFallback, proxyUrl } from "@/lib/proxy";
import { mediaRoutingPolicy, directArchiveResourceRoutes } from "@/features/media/services/mediaRoutes";
import { probeDirectMedia } from "@/features/media/services/mediaDetector";

test("fresh profiles use the passwordless YouTV Worker with Auto routes", () => {
  expect(defaultState.workers).toEqual([builtinWorker]);
  expect(defaultState.settings.defaultWorkerId).toBe(BUILTIN_WORKER_ID);
  expect(defaultState.settings.proxyMode).toBe("auto");
  expect(defaultState.settings.mediaRouteMode).toBe("auto");
  expect(builtinWorker.baseUrl).toBe("https://youtv.mr4016a1382.workers.dev/");
  const endpoint = new URL(proxyUrl("https://i.imgur.com/BCC123A.jpg", builtinWorker));
  expect(endpoint.hostname).toBe("youtv.mr4016a1382.workers.dev");
  expect(endpoint.searchParams.has("key")).toBe(false);
});

test("empty legacy profiles get the built-in Worker, but personal profiles are preserved", () => {
  const previous = { ...structuredClone(defaultState), workers: [], settings: { ...defaultState.settings, proxyMode: "direct" as const, mediaRouteMode: "proxy" as const } };
  const migrated = ensureDefaultWorker(previous, true);
  expect(migrated.workers).toEqual([builtinWorker]);
  expect(migrated.settings.proxyMode).toBe("auto");
  expect(migrated.settings.mediaRouteMode).toBe("auto");
  const personal = { ...previous, workers: [{ ...builtinWorker, id: "personal", token: "personal-key", enabled: false }] };
  expect(ensureDefaultWorker(personal, true)).toBe(personal);
  expect(ensureDefaultWorker(previous).settings.proxyMode).toBe("direct");
});

test("Media Auto keeps direct and Worker available; strict Direct remains direct-only", () => {
  const auto = mediaRoutingPolicy(defaultState.workers, defaultState.settings, "https:");
  expect(auto.candidates).toEqual([builtinWorker]);
  expect(auto.allowDirect).toBe(true);
  expect(mediaRoutingPolicy(defaultState.workers, { ...defaultState.settings, mediaRouteMode: "direct" }, "https:")).toEqual({ candidates: [], allowDirect: true });
  const source = "https://example.org/segment.ts";
  expect(directArchiveResourceRoutes(source, auto.candidates)).toEqual([source, proxyUrl(source, builtinWorker)]);
});

test("real HTTP: Auto tries direct first, then Worker on failure; explicit proxy skips direct", async () => {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    calls.push(path);
    if (path === "/ok") { res.end("direct"); return; }
    if (path === "/text") { res.end("relay"); return; }
    if (path === "/video.mp4") { res.setHeader("content-type", "video/mp4"); res.setHeader("content-length", "123"); res.end(); return; }
    res.statusCode = 403; res.end("blocked");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const base = `http://127.0.0.1:${address.port}`;
    const worker: WorkerProfile = { ...builtinWorker, baseUrl: base };
    const settings = defaultState.settings;
    const read = (response: Response) => response.text();
    expect(await fetchTextWithFallback(`${base}/ok`, settings, [worker], "", false, read, undefined, "http:")).toEqual({ value: "direct", workerId: "" });
    expect(calls.splice(0)).toEqual(["/ok"]);
    expect(await fetchTextWithFallback(`${base}/blocked`, settings, [worker], "", false, read, undefined, "http:")).toEqual({ value: "relay", workerId: worker.id });
    expect(calls.splice(0)).toEqual(["/blocked", "/text"]);
    expect(await fetchTextWithFallback(`${base}/ok`, { ...settings, proxyMode: "proxy" }, [worker], "", false, read, undefined, "http:")).toEqual({ value: "relay", workerId: worker.id });
    expect(calls.splice(0)).toEqual(["/text"]);
    expect((await probeDirectMedia(`${base}/video.mp4`)).kind).toBe("video");
    expect(calls).toEqual(["/video.mp4"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
