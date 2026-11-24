import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel, defaultState, type AppState } from "@youtv/shared";
import {
  createBackup,
  importBackupText,
  mergeBackup,
  parseBackupText,
} from "@/lib/backup";

function fixture(): AppState {
  const channel = createChannel({
    id: "channel-backup",
    name: "Personal channel",
    url: "https://stream.example.com/test.m3u8",
    tags: ["personal"],
    favorite: true,
  });
  return {
    ...structuredClone(defaultState),
    channels: [channel],
    workers: [
      {
        id: "worker-a",
        name: "Personal proxy",
        baseUrl: "https://worker.example.workers.dev",
        token: "secret-access-token",
        enabled: true,
      },
    ],
    recent: [channel.id],
    resume: { [channel.id]: 112 },
  };
}

describe("complete YouTV backup and migration", () => {
  afterEach(() => vi.restoreAllMocks());
  it("round-trips channel metadata, player settings, history, and omits proxy secrets by default", () => {
    const state = fixture();
    state.settings.preferredQuality = 720;
    state.settings.recordingBitrate = 6_000_000;
    state.settings.defaultPlaylistEnabled = false;
    const backup = createBackup(state);
    expect(backup.includesWorkerTokens).toBe(false);
    expect(backup.data.workers[0]?.token).toBe("");
    const imported = importBackupText(
      JSON.stringify(backup),
      structuredClone(defaultState),
    );
    expect(imported.channels[0]?.favorite).toBe(true);
    expect(imported.channels[0]?.tags).toEqual(["personal"]);
    expect(imported.resume["channel-backup"]).toBe(112);
    expect(imported.settings.preferredQuality).toBe(720);
    expect(imported.settings.recordingBitrate).toBe(6_000_000);
    expect(imported.settings.defaultPlaylistEnabled).toBe(false);
  });
  it("includes Worker access token only after explicit opt-in", () => {
    const parsed = parseBackupText(
      JSON.stringify(createBackup(fixture(), true)),
    );
    expect(parsed.includesWorkerTokens).toBe(true);
    expect(parsed.data.workers[0]?.token).toBe("secret-access-token");
  });
  it("merges without overwriting prior favorites, tags and retained Worker credentials", () => {
    const local = fixture(),
      remote = fixture();
    local.channels[0]!.tags = ["local"];
    local.channels[0]!.favorite = true;
    remote.channels[0]!.tags = ["remote"];
    remote.channels[0]!.favorite = false;
    remote.workers[0]!.token = "";
    const merged = mergeBackup(local, remote);
    expect(merged.channels[0]?.favorite).toBe(true);
    expect(merged.channels[0]?.tags).toEqual(["local", "remote"]);
    expect(merged.workers[0]?.token).toBe("secret-access-token");
  });
  it("restores the legacy raw v0.3 state format", () => {
    const restored = parseBackupText(JSON.stringify(fixture()));
    expect(restored.data.channels).toHaveLength(1);
  });
  it("rejects malformed and unknown backup formats", () => {
    expect(() => parseBackupText("{broken")).toThrow();
    expect(() =>
      parseBackupText(JSON.stringify({ format: "external" })),
    ).toThrow();
  });
});
