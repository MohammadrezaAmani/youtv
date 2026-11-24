import { it, expect, describe } from "vitest";
import { createChannel, defaultState, workerSchema } from "@youtv/shared";
import {
  resolveStream,
  resolveTextSource,
  proxyUrl,
  effectiveConnectionMode,
} from "../lib/proxy";
it("builds a token-bearing, URL-encoded worker request", () => {
  const worker = {
    id: "a",
    name: "Own",
    baseUrl: "https://worker.example.com/",
    token: "my-long-key",
    enabled: true,
  };
  const channel = createChannel({
    name: "X",
    url: "https://media.example.com/live.m3u8?sig=x&ttl=1",
    proxyMode: "proxy",
    workerId: "a",
  });
  const result = resolveStream(channel, defaultState.settings, [worker]);
  expect(result.mode).toBe("proxy");
  expect(new URL(result.url).searchParams.get("url")).toBe(channel.url);
  expect(proxyUrl(channel.url, worker, "text")).toContain("/text?");
});

it("carries per-channel IPTV HTTP hints through the Worker URL", () => {
  const worker = {
    id: "w",
    name: "Personal",
    baseUrl: "https://worker.example.org/",
    token: "x".repeat(32),
    enabled: true,
  };
  const channel = createChannel({
    name: "TV",
    url: "https://media.example.org/live.m3u8",
    iptv: {
      ...createChannel({ name: "X", url: "https://media.example.org/x" }).iptv,
      userAgent: "smartlabs",
      referer: "https://player.example.org/",
    },
    proxyMode: "proxy",
    workerId: "w",
  });
  const url = new URL(
    resolveStream(channel, defaultState.settings, [worker]).url,
  );
  expect(url.searchParams.get("ua")).toBe("smartlabs");
  expect(url.searchParams.get("ref")).toBe("https://player.example.org/");
});

it("allows a configured Worker without a client token and omits key for HLS and text", () => {
  const worker = {
    id: "no-token",
    name: "Open worker",
    baseUrl: "https://public.workers.dev/",
    token: "",
    enabled: true,
  };
  const channel = createChannel({
    name: "Public stream",
    url: "https://live.presstv.co.uk/hls/ifilmfa.m3u8",
    proxyMode: "proxy",
    workerId: worker.id,
  });
  const result = resolveStream(channel, defaultState.settings, [worker]);
  expect(result.mode).toBe("proxy");
  const output = new URL(result.url);
  expect(output.pathname).toBe("/proxy");
  expect(output.searchParams.get("url")).toBe(channel.url);
  expect(output.searchParams.has("key")).toBe(false);
  expect(output.searchParams.get("hls")).toBe("1");
  expect(
    new URL(proxyUrl(channel.url, worker, "text")).searchParams.has("key"),
  ).toBe(false);
  expect(
    new URL(proxyUrl(channel.url, worker, "probe")).searchParams.has("key"),
  ).toBe(false);
});

it("new Worker profiles default to no access token when the field is absent", () => {
  const saved = workerSchema.parse({
    id: "no-secret",
    name: "Open worker",
    baseUrl: "https://demo.workers.dev/",
  });
  expect(saved.token).toBe("");
  expect(
    new URL(
      proxyUrl("https://media.example.com/live.m3u8", saved, "proxy", true),
    ).searchParams.has("key"),
  ).toBe(false);
});

it("honors saved proxy as the effective default instead of first trying direct", () => {
  const worker = {
    id: "main",
    name: "Worker",
    baseUrl: "https://worker.example.dev/",
    token: "",
    enabled: true,
  };
  const settings = {
    ...defaultState.settings,
    proxyMode: "proxy" as const,
    defaultWorkerId: worker.id,
  };
  const channel = createChannel({
    name: "News",
    url: "https://live.example.org/live.m3u8",
  });
  const route = resolveStream(channel, settings, [worker]);
  expect(channel.proxyMode).toBe("inherit");
  expect(route.mode).toBe("proxy");
  expect(new URL(route.url).hostname).toBe("worker.example.dev");
  expect(new URL(route.url).searchParams.get("hls")).toBe("1");
});

it("keeps per-channel route overrides while allowing manual Auto or Proxy", () => {
  const worker = {
    id: "main",
    name: "Worker",
    baseUrl: "https://worker.example.dev/",
    token: "",
    enabled: true,
  };
  const settings = {
    ...defaultState.settings,
    proxyMode: "proxy" as const,
    defaultWorkerId: worker.id,
  };
  const channel = createChannel({
    name: "News",
    url: "https://live.example.org/live.m3u8",
    proxyMode: "direct",
  });
  expect(effectiveConnectionMode(channel, settings, "default")).toBe("direct");
  expect(resolveStream(channel, settings, [worker]).mode).toBe("direct");
  const automatic = {
    ...channel,
    proxyMode: effectiveConnectionMode(channel, settings, "auto"),
  };
  expect(resolveStream(automatic, settings, [worker]).mode).toBe("direct");
  const forced = {
    ...channel,
    proxyMode: effectiveConnectionMode(channel, settings, "proxy"),
  };
  expect(resolveStream(forced, settings, [worker]).mode).toBe("proxy");
  expect(
    effectiveConnectionMode({ ...channel, proxyMode: "inherit" }, settings),
  ).toBe("proxy");
});

describe("HTTP IPTV source relay on HTTPS GitHub Pages", () => {
  const worker = {
    id: "http-worker",
    name: "HTTPS relay",
    baseUrl: "https://relay.workers.dev/",
    token: "",
    enabled: true,
  };
  const settings = {
    ...defaultState.settings,
    proxyMode: "auto" as const,
    defaultWorkerId: worker.id,
  };
  const httpChannel = createChannel({
    name: "HTTP Live",
    url: "http://live.example.org:8080/ch/index.m3u8",
    format: "auto",
    proxyMode: "inherit",
  });
  it("automatically relays HTTP sources even when the saved mode is auto or direct", () => {
    for (const proxyMode of ["auto", "direct", "proxy"] as const) {
      const result = resolveStream(
        { ...httpChannel, proxyMode },
        settings,
        [worker],
        false,
        "https:",
      );
      expect(result.mode).toBe("proxy");
      expect(result.url).toMatch(/^https:\/\//);
      const proxied = new URL(result.url);
      expect(proxied.searchParams.get("url")).toBe(httpChannel.url);
      expect(proxied.searchParams.get("hls")).toBe("1");
      expect(proxied.searchParams.has("key")).toBe(false);
    }
  });
  it("keeps direct HTTP available when the application itself runs over HTTP", () => {
    expect(
      resolveStream(
        { ...httpChannel, proxyMode: "direct" },
        settings,
        [],
        false,
        "http:",
      ).url,
    ).toBe(httpChannel.url);
  });
  it("leaves ordinary HTTPS sources in direct mode when requested", () => {
    const channel = {
      ...httpChannel,
      url: "https://live.example.org/ch/index.m3u8",
      proxyMode: "direct" as const,
    };
    expect(
      resolveStream(channel, settings, [worker], false, "https:").mode,
    ).toBe("direct");
  });
  it("explains missing HTTPS Worker without modifying the HTTP source", () => {
    expect(() =>
      resolveStream(httpChannel, settings, [], false, "https:"),
    ).toThrow(/active HTTPS Worker/);
    expect(() =>
      resolveStream(
        httpChannel,
        settings,
        [{ ...worker, baseUrl: "http://worker.example.org" }],
        false,
        "https:",
      ),
    ).toThrow(/Worker endpoint must use HTTPS/);
  });
  it("proxies HTTP playlist imports and refreshes, retaining the original URL", () => {
    const source = "http://iptv.example.org/list.m3u";
    const value = resolveTextSource(
      source,
      settings,
      [worker],
      "",
      false,
      "https:",
    );
    expect(value.workerId).toBe(worker.id);
    expect(new URL(value.url).searchParams.get("url")).toBe(source);
    expect(new URL(value.url).pathname).toBe("/text");
    expect(new URL(value.url).searchParams.has("key")).toBe(false);
    expect(
      resolveTextSource(source, settings, [worker], "", false, "http:").url,
    ).toBe(source);
    expect(() =>
      resolveTextSource(source, settings, [], "", false, "https:"),
    ).toThrow(/active HTTPS Worker/);
  });
});
