import { describe, expect, it } from "vitest";
import {
  isAppleMobileBrowser,
  isBlockedMixedMedia,
  isInterruptedPlay,
  needsUserPlayGesture,
  selectPlaybackEngine,
} from "../features/player/playbackSupport";

describe("mobile playback choices", () => {
  it("detects iOS Safari, in-app browsers, and desktop-mode iPads", () => {
    expect(
      isAppleMobileBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      ),
    ).toBe(true);
    expect(
      isAppleMobileBrowser("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"),
    ).toBe(true);
    expect(
      isAppleMobileBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        "MacIntel",
        5,
      ),
    ).toBe(true);
    expect(
      isAppleMobileBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
        "MacIntel",
        0,
      ),
    ).toBe(false);
    expect(
      isAppleMobileBrowser("Mozilla/5.0 (Linux; Android 15)", "Linux", 5),
    ).toBe(false);
  });
  it("uses the supported JavaScript engine on iPhone without forcing native by User-Agent", () => {
    expect(
      selectPlaybackEngine({
        isHls: true,
        nativeHls: true,
        hlsJsSupported: true,
        appleMobile: true,
      }),
    ).toBe("hlsjs");
    expect(
      selectPlaybackEngine({
        isHls: true,
        nativeHls: true,
        hlsJsSupported: true,
        appleMobile: false,
      }),
    ).toBe("hlsjs");
    expect(
      selectPlaybackEngine({
        isHls: true,
        nativeHls: true,
        hlsJsSupported: false,
        appleMobile: true,
      }),
    ).toBe("native");
    expect(
      selectPlaybackEngine({
        isHls: true,
        nativeHls: false,
        hlsJsSupported: false,
        appleMobile: true,
      }),
    ).toBe("unsupported");
    expect(
      selectPlaybackEngine({
        isHls: false,
        nativeHls: false,
        hlsJsSupported: false,
        appleMobile: true,
      }),
    ).toBe("native");
  });
  it("retains relay buffering on Apple mobile and falls back when MSE is unavailable", () => {
    const capabilities = { isHls: true, nativeHls: true, hlsJsSupported: true, relayed: true };
    expect(selectPlaybackEngine({ ...capabilities, appleMobile: false })).toBe("hlsjs");
    expect(selectPlaybackEngine({ ...capabilities, appleMobile: true })).toBe("hlsjs");
    expect(selectPlaybackEngine({ ...capabilities, appleMobile: true, nativeHls: false })).toBe("hlsjs");
    expect(selectPlaybackEngine({ ...capabilities, appleMobile: true, hlsJsSupported: false })).toBe("native");
  });
  it("does not report interrupted video play promises as permanent failures", () => {
    expect(
      isInterruptedPlay(
        Object.assign(
          new Error(
            "The play() request was interrupted by a new load request.",
          ),
          { name: "AbortError" },
        ),
      ),
    ).toBe(true);
    expect(
      isInterruptedPlay(
        Object.assign(
          new Error("The play() request was interrupted by a call to pause()."),
          { name: "AbortError" },
        ),
      ),
    ).toBe(true);
    expect(
      isInterruptedPlay(
        Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        }),
      ),
    ).toBe(true);
    expect(
      isInterruptedPlay(
        Object.assign(new Error("The request is not allowed"), {
          name: "NotAllowedError",
        }),
      ),
    ).toBe(false);
    expect(isInterruptedPlay(new Error("HTTP 403"))).toBe(false);
    expect(isInterruptedPlay("AbortError")).toBe(false);
  });
  it("distinguishes mixed-content blocks and autoplay permissions", () => {
    expect(isBlockedMixedMedia("https:", "http://example.net/live.m3u8")).toBe(
      true,
    );
    expect(isBlockedMixedMedia("http:", "http://example.net/live.m3u8")).toBe(
      false,
    );
    expect(isBlockedMixedMedia("https:", "https://example.net/live.m3u8")).toBe(
      false,
    );
    expect(
      needsUserPlayGesture(
        Object.assign(new Error("The request is not allowed"), {
          name: "NotAllowedError",
        }),
      ),
    ).toBe(true);
    expect(needsUserPlayGesture(new Error("Network error"))).toBe(false);
  });
});

it("can select the alternate engine once after a real decoder failure", () => {
 const options={isHls:true,nativeHls:true,hlsJsSupported:true,appleMobile:true};
 expect(selectPlaybackEngine({...options,failedEngines:["hlsjs"]})).toBe("native");
 expect(selectPlaybackEngine({...options,failedEngines:["native"]})).toBe("hlsjs");
 expect(selectPlaybackEngine({...options,failedEngines:["hlsjs","native"]})).toBe("unsupported");
});
