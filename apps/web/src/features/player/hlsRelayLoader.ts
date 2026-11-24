import Hls from "hls.js";
import type { WorkerProfile } from "@youtv/shared";
import { hlsRequestRoute, hlsResponseBase } from "./hlsRelayRoutes";

/** Preserve the library's own retries, aborts, Range and buffering. Change
 * only the request URL and the base of a playlist containing raw relative URIs. */
export function hlsRelayLoader(worker: WorkerProfile, initial: string): typeof Hls.DefaultConfig.loader {
  const BaseLoader = Hls.DefaultConfig.loader;
  type LoadArgs = Parameters<InstanceType<typeof BaseLoader>["load"]>;
  return class RelayLoader extends BaseLoader {
    load(context: LoadArgs[0], config: LoadArgs[1], callbacks: LoadArgs[2]): void {
      const playlist = ["manifest", "level", "audioTrack", "subtitleTrack"].includes(String(context.type));
      const url = hlsRequestRoute(context.url, worker, initial, playlist);
      super.load({ ...context, url }, config, {
        ...callbacks,
        onSuccess: (response, stats, loadedContext, networkDetails) => {
          const base = typeof response.data === "string"
            ? hlsResponseBase(response.data, url, worker, this.getResponseHeader?.("X-YouTV-Source-URL") ?? null)
            : undefined;
          callbacks.onSuccess(base ? { ...response, url: base } : response, stats, loadedContext, networkDetails);
        },
      });
    }
  };
}
