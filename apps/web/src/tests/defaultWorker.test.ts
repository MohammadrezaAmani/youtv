// @vitest-environment node
import { test, expect } from "vitest";
import { createServer } from "node:http";
import { builtinWorker, BUILTIN_WORKER_ID, defaultState, ensureDefaultWorker, type WorkerProfile } from "@youtv/shared";
import { fetchTextWithFallback, proxyUrl } from "@/lib/proxy";
import { mediaAssetUrls, mediaRoutingPolicy } from "@/features/media/services/mediaRoutes";
import { probeDirectMedia } from "@/features/media/services/mediaDetector";

test("fresh profiles use the passwordless YouTV Worker with Proxy-only defaults", () => {
  expect(defaultState.workers).toEqual([builtinWorker]);
  expect(defaultState.settings.defaultWorkerId).toBe(BUILTIN_WORKER_ID);
  expect(defaultState.settings.proxyMode).toBe("proxy");
  expect(defaultState.settings.mediaRouteMode).toBe("proxy");
  expect(builtinWorker.baseUrl).toBe("https://youtv.mr4016a1382.workers.dev/");
  const endpoint = new URL(proxyUrl("https://i.imgur.com/BCC123A.jpg", builtinWorker));
  expect(endpoint.hostname).toBe("youtv.mr4016a1382.workers.dev");
  expect(endpoint.searchParams.has("key")).toBe(false);
});

test("legacy Auto defaults migrate to Proxy once and personal Workers are preserved", () => {
  const previous = {
    ...structuredClone(defaultState),
    workers: [],
    settings: { ...defaultState.settings, proxyMode: "auto" as const, mediaRouteMode: "auto" as const, routingDefaultsVersion: 0 },
  };
  const migrated = ensureDefaultWorker(previous, true);
  expect(migrated.workers).toEqual([builtinWorker]);
  expect(migrated.settings.proxyMode).toBe("proxy");
  expect(migrated.settings.mediaRouteMode).toBe("proxy");
  expect(migrated.settings.routingDefaultsVersion).toBe(1);

  const personalWorker = { ...builtinWorker, id: "personal", token: "personal-key", enabled: false };
  const personal = {
    ...previous,
    workers: [personalWorker],
    settings: { ...previous.settings, defaultWorkerId: "personal" },
  };
  const migratedPersonal = ensureDefaultWorker(personal, true);
  expect(migratedPersonal.workers).toEqual([personalWorker]);
  expect(migratedPersonal.settings.defaultWorkerId).toBe("personal");
  expect(migratedPersonal.settings.proxyMode).toBe("proxy");
  expect(ensureDefaultWorker(migratedPersonal, true)).toBe(migratedPersonal);

  const explicitDirect = ensureDefaultWorker({
    ...previous,
    settings: { ...previous.settings, proxyMode: "direct", mediaRouteMode: "direct" },
  }, true);
  expect(explicitDirect.settings.proxyMode).toBe("direct");
  expect(explicitDirect.settings.mediaRouteMode).toBe("direct");
  expect(ensureDefaultWorker(previous).settings.proxyMode).toBe("auto");
});

test("Proxy-only defaults skip direct; explicit Direct remains direct-only", () => {
  const proxy = mediaRoutingPolicy(defaultState.workers, defaultState.settings, "https:");
  expect(proxy.candidates).toEqual([builtinWorker]);
  expect(proxy.allowDirect).toBe(false);
  expect(mediaRoutingPolicy(defaultState.workers, { ...defaultState.settings, mediaRouteMode: "direct" }, "https:")).toEqual({ candidates: [], allowDirect: true });
  const source = "https://example.org/segment.ts";
  expect(mediaAssetUrls(source, proxy.candidates, proxy.allowDirect)).toEqual([proxyUrl(source, builtinWorker)]);
});

test("real HTTP: Proxy skips direct; explicit Auto tries direct first", async () => {
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
    expect(await fetchTextWithFallback(`${base}/ok`, settings, [worker], "", false, read, undefined, "http:")).toEqual({ value: "relay", workerId: worker.id });
    expect(calls.splice(0)).toEqual(["/text"]);
    expect(await fetchTextWithFallback(`${base}/blocked`, { ...settings, proxyMode: "auto" }, [worker], "", false, read, undefined, "http:")).toEqual({ value: "relay", workerId: worker.id });
    expect(calls.splice(0)).toEqual(["/blocked", "/text"]);
    expect(await fetchTextWithFallback(`${base}/ok`, { ...settings, proxyMode: "auto" }, [worker], "", false, read, undefined, "http:")).toEqual({ value: "direct", workerId: "" });
    expect(calls.splice(0)).toEqual(["/ok"]);
    expect((await probeDirectMedia(`${base}/video.mp4`)).kind).toBe("video");
    expect(calls).toEqual(["/video.mp4"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
