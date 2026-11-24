import { describe, it, expect } from "vitest";
import { createChannel } from "@youtv/shared";
import {
  addMultiChannel,
  relatedToChannel,
  MAX_MULTI_VIEWS,
} from "@/lib/multiview";

describe("Multi-view", () => {
  it("adds different channels without duplicating the active one and caps the view count", () => {
    expect(addMultiChannel("a", [], "a")).toEqual([]);
    const selected = ["b", "c"];
    expect(addMultiChannel("a", selected, "b")).toEqual(["b", "c"]);
    expect(addMultiChannel("a", ["b", "c", "d"], "e")).toHaveLength(
      MAX_MULTI_VIEWS - 1,
    );
  });
  it("prioritizes channels sharing a source/group rather than mixing the library", () => {
    const make = (name: string, sourceId: string, group: string) =>
      createChannel({
        name,
        url: `https://video.example.org/${name}.m3u8`,
        sourceId,
        group,
      });
    const active = make("main", "playlist-1", "Sports");
    const candidates = [
      make("different", "playlist-2", "Movies"),
      make("same-source", "playlist-1", "News"),
      make("same-group", "playlist-2", "Sports"),
      make("both", "playlist-1", "Sports"),
    ];
    expect(
      relatedToChannel([active, ...candidates], active).map(
        (item) => item.name,
      ),
    ).toEqual(["both", "same-group", "same-source"]);
  });
});
