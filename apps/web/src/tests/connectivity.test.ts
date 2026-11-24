import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel, defaultState, type WorkerProfile } from "@youtv/shared";
import { probeChannel, scanChannels } from "@/lib/connectivity";
import { readCatalogAsset } from "@/lib/catalogCache";

vi.mock("@/lib/catalogCache", () => ({ readCatalogAsset: vi.fn() }));

const channel = createChannel({
  id: "connectivity-a",
  name: "My TV",
  url: "https://stream.example.com/live.m3u8",
});
const settings = structuredClone(defaultState.settings);
const worker: WorkerProfile = {
  id: "worker-a",
  name: "A",
  baseUrl: "https://worker.example.workers.dev",
  token: "x".repeat(32),
  enabled: true,
};

describe("channel connectivity probes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("counts a successful HEAD response as reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const result = await probeChannel(channel, settings, []);
    expect(result.status).toBe("online");
    expect(result.httpStatus).toBe(200);
  });
  it("classifies Failed to fetch as offline for the channel monitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await probeChannel(channel, settings, []);
    expect(result.status).toBe("offline");
    expect(result.detail).toContain("Failed to fetch");
  });
  it("can use /probe in personal Worker and record actual HTTP response", async () => {
    const proxyChannel = {
      ...channel,
      proxyMode: "proxy" as const,
      workerId: worker.id,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        expect(String(input)).toContain("/probe?");
        return new Response(
          JSON.stringify({ status: 206, ok: true, elapsedMs: 42 }),
          { status: 200 },
        );
      }),
    );
    const result = await probeChannel(proxyChannel, settings, [worker]);
    expect(result.status).toBe("online");
    expect(result.httpStatus).toBe(206);
    expect(result.elapsedMs).toBe(42);
  });
  it("uses an open Worker /probe even without a token", async () => {
    const openWorker = { ...worker, id: "worker-open", token: "" };
    const proxyChannel = {
      ...channel,
      proxyMode: "proxy" as const,
      workerId: openWorker.id,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        expect(new URL(String(input)).pathname).toBe("/probe");
        expect(new URL(String(input)).searchParams.has("key")).toBe(false);
        return new Response(
          JSON.stringify({ ok: true, status: 200, elapsedMs: 23 }),
          { status: 200 },
        );
      }),
    );
    const result = await probeChannel(proxyChannel, settings, [openWorker]);
    expect(result.status).toBe("online");
    expect(result.elapsedMs).toBe(23);
  });
  it("uses the first-party verified DNS report for NXDOMAIN, without a public DNS request", async () => {
    vi.stubEnv("VITE_YOUTV_CURATED", "1");
    vi.mocked(readCatalogAsset).mockResolvedValue(
      JSON.stringify({
        generatedAt: "2026-11-24T00:00:00Z",
        nxdomain: ["removed-domain.example.invalid"],
        noAddress: [],
      }),
    );
    const missing = {
      ...channel,
      id: "dead-dns",
      url: "https://removed-domain.example.invalid/live.m3u8",
    };
    const fetching = vi.fn(async (_input: string | URL) => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(missing, settings, []);
    expect(result.status).toBe("offline");
    expect(result.detail).toContain("NXDOMAIN");
    expect(readCatalogAsset).toHaveBeenCalledWith(
      "sources/_verified/dns-status.json",
    );
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(fetching.mock.calls[0]?.[0]).toBe(missing.url);
  });
  it("uses the verified no-address report for missing A/AAAA records", async () => {
    vi.stubEnv("VITE_YOUTV_CURATED", "1");
    vi.mocked(readCatalogAsset).mockResolvedValue(
      JSON.stringify({
        nxdomain: [],
        noAddress: ["no-address.example.invalid"],
      }),
    );
    const missing = {
      ...channel,
      id: "no-address",
      url: "https://no-address.example.invalid/live.m3u8",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await probeChannel(missing, settings, []);
    expect(result.status).toBe("offline");
    expect(result.detail).toContain("no A/AAAA");
  });
  it("does not call any DoH service when the first-party report is unavailable", async () => {
    vi.stubEnv("VITE_YOUTV_CURATED", "1");
    vi.mocked(readCatalogAsset).mockRejectedValue(
      new Error("No saved report and offline"),
    );
    const fetching = vi.fn(async (_input: string | URL) => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(
      { ...channel, id: "no-report" },
      settings,
      [],
    );
    expect(result.status).toBe("offline");
    expect(result.detail).toContain("Failed to fetch");
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(fetching.mock.calls[0]?.[0]).toBe(channel.url);
  });
  it("keeps genuine timeouts inconclusive without consulting a third-party resolver", async () => {
    vi.stubEnv("VITE_YOUTV_CURATED", "0");
    const timedOut = {
      ...channel,
      id: "dns-timeout-unknown",
      url: "https://unknown-timeout.example.invalid/live.m3u8",
    };
    const fetching = vi.fn(async (_input: string | URL) => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(timedOut, settings, []);
    expect(result.status).toBe("unknown");
    expect(fetching).toHaveBeenCalledTimes(1);
  });
  it("classifies a failed-to-fetch Worker probe as offline without DNS-over-HTTPS", async () => {
    const proxyChannel = {
      ...channel,
      proxyMode: "proxy" as const,
      workerId: worker.id,
      url: "https://proxy-fetch-failure.example.invalid/live.m3u8",
    };
    const fetching = vi.fn(async (_input: string | URL) => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(proxyChannel, settings, [worker]);
    expect(result.status).toBe("offline");
    expect(result.mode).toBe("proxy");
    expect(fetching).toHaveBeenCalledTimes(1);
    expect(String(fetching.mock.calls[0]?.[0])).toContain("/probe?");
  });
  it("keeps user-cancelled failed requests out of the offline count", async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        abort.abort();
        throw new TypeError("Failed to fetch");
      }),
    );
    const result = await probeChannel(channel, settings, [], abort.signal);
    expect(result.status).toBe("unknown");
    expect(result.detail).toBe("Cancelled");
  });
  it("limits concurrent checks and emits progress for all channels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const repeated = Array.from({ length: 9 }, (_, i) => ({
      ...channel,
      id: `connectivity-${i}`,
    }));
    const results: Record<string, unknown> = {};
    await scanChannels(
      repeated,
      settings,
      [],
      new AbortController().signal,
      (batch, progress) => {
        Object.assign(results, batch);
        expect(progress.completed).toBeLessThanOrEqual(9);
      },
      3,
    );
    expect(Object.keys(results)).toHaveLength(9);
  });
});

describe("HTTP status checks from secure deployment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });
  it("probes HTTP stream through the Worker regardless of Direct routing preference", async () => {
    const source = {
      ...channel,
      url: "http://public.example.org/live.m3u8",
      proxyMode: "direct" as const,
    };
    const fetching = vi.fn(async (input: string | URL) => {
      const endpoint = new URL(String(input));
      expect(endpoint.protocol).toBe("https:");
      expect(endpoint.pathname).toBe("/probe");
      expect(endpoint.searchParams.get("url")).toBe(source.url);
      return new Response(
        JSON.stringify({ ok: true, status: 200, elapsedMs: 12 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(
      source,
      { ...settings, defaultWorkerId: worker.id },
      [worker],
      undefined,
      "https:",
    );
    expect(result.status).toBe("online");
    expect(result.mode).toBe("proxy");
    expect(fetching).toHaveBeenCalledTimes(1);
  });
  it("does not mark HTTP offline merely because a Worker has not been configured", async () => {
    const source = {
      ...channel,
      url: "http://public.example.org/live.m3u8",
      proxyMode: "direct" as const,
    };
    const fetching = vi.fn();
    vi.stubGlobal("fetch", fetching);
    const result = await probeChannel(
      source,
      settings,
      [],
      undefined,
      "https:",
    );
    expect(result.status).toBe("unknown");
    expect(result.detail).toContain("Worker unavailable");
    expect(fetching).not.toHaveBeenCalled();
  });
});
