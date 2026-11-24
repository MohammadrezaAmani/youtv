import { describe, expect, it } from "vitest";
import { defaultState } from "@youtv/shared";
import { activityKey, playbackActivity, readPlaybackActivity, sameLibrarySnapshot } from "@/lib/playbackActivity";

describe("lightweight playback persistence", () => {
  it("does not require a catalog snapshot for a channel switch or a progress update", () => {
    const previous = structuredClone(defaultState);
    const next = { ...previous, recent: ["channel-b"], resume: { "channel-a": 25 } };
    expect(sameLibrarySnapshot(previous, next)).toBe(true);
    expect(playbackActivity(next)).toEqual({ recent: ["channel-b"], resume: { "channel-a": 25 } });
  });
  it("still writes a full snapshot for library, settings, workers or health changes", () => {
    const previous = structuredClone(defaultState);
    expect(sameLibrarySnapshot(undefined, previous)).toBe(false);
    for (const next of [ { ...previous, channels: [...previous.channels] }, { ...previous, playlists: [...previous.playlists] }, { ...previous, workers: [...previous.workers] }, { ...previous, settings: { ...previous.settings } }, { ...previous, health: { ...previous.health } } ])
      expect(sameLibrarySnapshot(previous, next)).toBe(false);
  });
  it("restores an empty history after reset and rejects corrupt activity", () => {
    expect(readPlaybackActivity({ recent: [], resume: {} })).toEqual({ recent: [], resume: {} });
    expect(readPlaybackActivity({ recent: [1], resume: {} })).toBe(null);
    expect(readPlaybackActivity({ recent: [], resume: { a: -1 } })).toBe(null);
    expect(activityKey("youtv:v1")).toBe("youtv:v1:playback:v1");
  });
});
