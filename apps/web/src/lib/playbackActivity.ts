import type { AppState } from "@youtv/shared";

export type PlaybackActivity = Pick<AppState, "recent" | "resume">;
export const activityKey = (key: string) => `${key}:playback:v1`;

/** The catalog is immutable in the store. History and progress do not change
 * its references, so neither operation needs a new multi-megabyte snapshot. */
export function sameLibrarySnapshot(previous: AppState | undefined, next: AppState): boolean {
  return Boolean(previous && previous.version === next.version &&
    previous.channels === next.channels && previous.playlists === next.playlists &&
    previous.workers === next.workers && previous.settings === next.settings &&
    previous.health === next.health);
}

export function playbackActivity(state: AppState): PlaybackActivity {
  return { recent: state.recent, resume: state.resume };
}

export function readPlaybackActivity(value: unknown): PlaybackActivity | null {
  if (!value || typeof value !== "object") return null;
  const { recent, resume } = value as Partial<PlaybackActivity>;
  if (!Array.isArray(recent) || !recent.every(id => typeof id === "string") ||
    !resume || typeof resume !== "object" || Array.isArray(resume) ||
    !Object.values(resume).every(seconds => typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0)) return null;
  return { recent, resume };
}
