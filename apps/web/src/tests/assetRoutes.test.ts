import { expect, test } from "vitest";
import { assetRoutes, channelAssetRoutes, originalAssetUrl } from "../lib/assetRoutes";
import { proxyUrl } from "../lib/proxy";
import type { WorkerProfile } from "@youtv/shared";

const a: WorkerProfile = { id: "a", name: "A", baseUrl: "https://a.example/proxy", token: "token-a", enabled: true };
const b: WorkerProfile = { id: "b", name: "B", baseUrl: "https://b.example/mount/", token: "token-b", enabled: true };
const disabled: WorkerProfile = { ...a, id: "disabled", enabled: false };
const image = "https://i.imgur.com/BCC123A.jpg";
const channel = { url: "https://tv.example/live.m3u8", proxyMode: "inherit" as const, workerId: "" };
const settings = { proxyMode: "proxy" as const, defaultWorkerId: "b" };

test("proxy mode routes the Imgur logo through the preferred Worker, then the other enabled Worker", () => {
  const routes = channelAssetRoutes(image, channel, settings, [disabled, a, b], undefined, "https:");
  expect(routes).toEqual([proxyUrl(image, b), proxyUrl(image, a)]);
  expect(new URL(routes[0]!).searchParams.get("url")).toBe(image);
  expect(new URL(routes[0]!).searchParams.get("key")).toBe("token-b");
});
test("proxy-only mode never leaks an external image when there is no usable Worker", () => {
  expect(channelAssetRoutes(image, channel, settings, [], undefined, "https:")).toEqual([]);
  expect(assetRoutes(image, [disabled, { ...a, baseUrl: "http://insecure.example" }], false, "https:")).toEqual([]);
});
test("a channel-specific Worker and the actual playback route take priority", () => {
  expect(channelAssetRoutes(image, { ...channel, workerId: "a" }, settings, [b, a], undefined, "https:")[0]).toBe(proxyUrl(image, a));
  expect(channelAssetRoutes(image, { ...channel, workerId: "a" }, settings, [a, b], { mode: "proxy", worker: b }, "https:")[0]).toBe(proxyUrl(image, b));
});
test("explicit direct mode and automatic mode retain their respective routing policies", () => {
  expect(channelAssetRoutes(image, { ...channel, proxyMode: "direct" }, settings, [a, b], undefined, "https:")).toEqual([image]);
  expect(channelAssetRoutes(image, { ...channel, proxyMode: "auto" }, settings, [a, b], undefined, "https:")).toEqual([image, proxyUrl(image, b), proxyUrl(image, a)]);
});
test("Auto images remain direct-first when playback selected a Worker or the channel is HTTP",()=>{
  const automatic={...settings,proxyMode:"auto" as const};
  expect(channelAssetRoutes(image,channel,automatic,[a,b],{mode:"auto",worker:b},"https:")).toEqual([image,proxyUrl(image,b),proxyUrl(image,a)]);
  expect(channelAssetRoutes(image,{...channel,url:"http://tv.example/live.m3u8"},automatic,[b],undefined,"https:")).toEqual([image,proxyUrl(image,b)]);
  const http="http://cdn.example/logo.png";
  expect(channelAssetRoutes(http,channel,automatic,[b],undefined,"https:")).toEqual([proxyUrl(http,b)]);
});
test("media fallback is proxy-first and direct is appended only when explicitly allowed", () => {
  expect(assetRoutes(image, [a, b], false, "https:")).toEqual([proxyUrl(image, a), proxyUrl(image, b)]);
  expect(assetRoutes(image, [a, b], true, "https:")).toEqual([proxyUrl(image, a), proxyUrl(image, b), image]);
});
test("known relay URLs are unwrapped, rotated and never nested or sent with another Worker's token", () => {
  const old = proxyUrl(image, a);
  expect(originalAssetUrl(old, [a, b])).toBe(image);
  expect(assetRoutes(old, [b], false, "https:", [a, b])).toEqual([proxyUrl(image, b)]);
  const unrelated = "https://cdn.example/image?url=https%3A%2F%2Fother.example%2Fx";
  expect(originalAssetUrl(unrelated, [a, b])).toBe(unrelated);
});
test("HTTPS pages relay HTTP assets and protocol-relative CDN assets; local images do not consume a Worker", () => {
  const http = "http://cdn.example/logo.png";
  expect(assetRoutes(http, [a], true, "https:")).toEqual([proxyUrl(http, a)]);
  expect(channelAssetRoutes(http, { ...channel, proxyMode: "direct" }, settings, [a], undefined, "https:")).toEqual([proxyUrl(http, a)]);
  expect(assetRoutes("//i.imgur.com/BCC123A.jpg", [a], false, "https:")).toEqual([proxyUrl(image, a)]);
  for (const local of ["/assets/logo.png", "./logo.svg", "data:image/png;base64,AA==", "blob:https://app.example/abc"]) {
    expect(assetRoutes(local, [], false, "https:")).toEqual([local]);
  }
});
test("blank, credential-bearing and unsupported URLs do not generate requests", () => {
  for (const url of ["", "javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com/logo", "/\\evil.example/logo"]) {
    expect(assetRoutes(url, [a], true, "https:")).toEqual([]);
  }
});
