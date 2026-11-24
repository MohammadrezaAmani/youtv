import { describe, expect, it } from "vitest";
import { resolveStream } from "../lib/proxy";
import { createChannel, defaultState, type WorkerProfile } from "@youtv/shared";

describe("HLS Worker route with inferred source format", () => {
  const worker: WorkerProfile = {
    id: "w1",
    name: "My Worker",
    enabled: true,
    baseUrl: "https://example.workers.dev/",
    token: "test-token",
  };
  it("rewrites .m3u8 master/segment URLs even for auto-formatted channels", () => {
    const channel = createChannel({
      id: "channel-1",
      name: "Real source",
      url: "http://example.org/live/index.m3u8",
      format: "auto",
      proxyMode: "proxy",
    });
    const settings = { ...defaultState.settings, defaultWorkerId: "w1" };
    const result = resolveStream(channel, settings, [worker]);
    expect(result.mode).toBe("proxy");
    expect(new URL(result.url).searchParams.get("hls")).toBe("1");
    expect(new URL(result.url).searchParams.get("url")).toBe(
      "http://example.org/live/index.m3u8",
    );
  });
});
