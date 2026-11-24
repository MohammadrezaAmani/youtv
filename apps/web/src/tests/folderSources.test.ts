import { describe, expect, it } from "vitest";
import { BUILTIN_PLAYLIST_ID, DEFAULT_COUNTRY_SOURCE, createChannel, defaultState, settingsSchema } from "@youtv/shared";
import { DEFAULT_COUNTRY_ID, FOLDER_SOURCE_PREFIX, isFolderSourceEnabled, isVisibleChannel } from "@/lib/builtin";
import { sourceDisplayName } from "@/lib/sourceNames";

describe("original source folder defaults", () => {
  it("enables Iran only on new and old profiles without a country preference", () => {
    expect(defaultState.settings.folderSourceEnabled[DEFAULT_COUNTRY_SOURCE]).toBe(true);
    expect(settingsSchema.parse({}).folderSourceEnabled[DEFAULT_COUNTRY_SOURCE]).toBe(true);
    const settings = { folderSourceEnabled: {} };
    expect(isFolderSourceEnabled(DEFAULT_COUNTRY_SOURCE, settings)).toBe(true);
    expect(isFolderSourceEnabled("world-iptv/countries/us.m3u", settings)).toBe(false);
    expect(isFolderSourceEnabled("world-iptv/master/world.m3u", settings)).toBe(false);
  });
  it("respects explicit disabling of Iran and other country selections", () => {
    const settings = { folderSourceEnabled: { [DEFAULT_COUNTRY_SOURCE]: false, "world-iptv/countries/us.m3u": true } };
    expect(isFolderSourceEnabled(DEFAULT_COUNTRY_SOURCE, settings)).toBe(false);
    expect(isFolderSourceEnabled("world-iptv/countries/us.m3u", settings)).toBe(true);
  });
  it("hides obsolete aggregates and indexes while preserving personal sources", () => {
    const settings = { folderSourceEnabled: { "_verified/online.m3u8": true, "world-iptv/indexes/by-country.m3u": true } };
    const channel = createChannel({ name: "Test", url: "https://example.org/live.m3u8" });
    for (const id of [BUILTIN_PLAYLIST_ID, FOLDER_SOURCE_PREFIX + "_verified/online.m3u8", FOLDER_SOURCE_PREFIX + "world-iptv/indexes/by-country.m3u"]) {
      expect(isVisibleChannel({ ...channel, sourceId: id }, settings)).toBe(false);
    }
    expect(isVisibleChannel({ ...channel, sourceId: DEFAULT_COUNTRY_ID }, settings)).toBe(true);
    expect(isVisibleChannel({ ...channel, sourceId: "personal" }, settings)).toBe(true);
  });
  it("localizes country names and handles UK and XK without renaming files", () => {
    expect(sourceDisplayName(DEFAULT_COUNTRY_SOURCE, "fa")).toBe("ایران");
    expect(sourceDisplayName("world-iptv/countries/us.m3u", "en")).toBe("United States");
    expect(sourceDisplayName("world-iptv/countries/uk.m3u", "en")).toBe("United Kingdom");
    expect(sourceDisplayName("world-iptv/countries/xk.m3u", "en")).toBe("Kosovo");
    expect(sourceDisplayName("custom/foo.m3u", "en")).toBe("foo.m3u");
  });
});
