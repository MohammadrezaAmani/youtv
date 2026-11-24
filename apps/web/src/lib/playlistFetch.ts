import type { Settings, WorkerProfile } from "@youtv/shared";
import { parseM3u } from "./playlist";
import { fetchTextWithFallback, playlistResponseBase } from "./proxy";

/** Validate each attempt before replacing a saved channel list. */
export function fetchPlaylist(source: string, settings: Pick<Settings, "defaultWorkerId" | "proxyMode">,
  workers: WorkerProfile[], requestedWorkerId = "", forceProxy = false) {
  return fetchTextWithFallback(source, settings, workers, requestedWorkerId, forceProxy, async (response, workerId) => {
    const result = parseM3u(await response.text(), playlistResponseBase(response, source, Boolean(workerId)));
    if (!result.channels.length) throw new Error("No valid channels in playlist response");
    return result;
  });
}
