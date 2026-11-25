import type { Channel, Settings, WorkerProfile } from "@youtv/shared";
import { effectiveConnectionMode, needsHttpsRelay, proxyUrl, workerEndpoint, type ConnectionMode } from "./proxy";

const protocol = () => typeof window === "undefined" ? "https:" : window.location.protocol;

/** Only unwrap URLs built for a known Worker /proxy endpoint. Never interpret
 * arbitrary third-party query parameters as relay URLs. */
export function originalAssetUrl(raw: string, workers: WorkerProfile[]): string {
  try {
    const source = new URL(raw);
    for (const worker of workers) {
      try {
        const endpoint = new URL(workerEndpoint(worker, "proxy"));
        if (endpoint.origin !== source.origin || endpoint.pathname !== source.pathname) continue;
        const value = source.searchParams.get("url");
        if (value && /^https?:\/\//i.test(value)) return value;
      } catch { /* invalid profile */ }
    }
  } catch { /* local or invalid URL */ }
  return raw;
}

/** Build only allowed routes. A proxy-only request with no usable Worker must
 * yield no remote URL, never silently contact the origin. */
export function assetRoutes(raw: string | undefined, candidates: WorkerProfile[], allowDirect: boolean,
  appProtocol = protocol(), knownWorkers = candidates, directFirst = false): string[] {
  const value = raw?.trim();
  if (!value) return [];
  let source = originalAssetUrl(value, knownWorkers);
  if (/^(?:data:image\/|blob:)/i.test(source)) return [source];
  // Relative application assets are local; protocol-relative CDN URLs are not.
  if (source.startsWith("//")) source = `${appProtocol}${source}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(source)) {
    if (/^[\\/]{2}|\\/.test(source)) return [];
    return [source];
  }
  let target: URL;
  try { target = new URL(source); } catch { return []; }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password) return [];
  const relays: string[] = [];
  for (const worker of candidates) {
    if (!worker.enabled || (appProtocol === "https:" && !/^https:\/\//i.test(worker.baseUrl))) continue;
    try { relays.push(proxyUrl(target.toString(), worker)); } catch { /* skip invalid profile */ }
  }
  const direct = allowDirect && !needsHttpsRelay(target.toString(), appProtocol) ? [target.toString()] : [];
  return [...new Set(directFirst ? [...direct, ...relays] : [...relays, ...direct])];
}

export function channelAssetRoutes(raw: string | undefined, channel: Pick<Channel, "url" | "proxyMode" | "workerId">,
  settings: Pick<Settings, "proxyMode" | "defaultWorkerId">, workers: WorkerProfile[],
  route?: { mode: ConnectionMode; worker?: WorkerProfile }, appProtocol = protocol()): string[] {
  const mode = route?.mode ?? effectiveConnectionMode(channel, settings);
  const preferred = route?.worker?.id || channel.workerId || settings.defaultWorkerId;
  const first = workers.find(worker => worker.id === preferred && worker.enabled);
  const ordered = first ? [first, ...workers.filter(worker => worker.id !== first.id)] : workers;
  const mixed = needsHttpsRelay(raw?.trim() || "", appProtocol);
  const proxyRequired = mode === "proxy" || mixed || (!!route?.worker && mode !== "auto");
  return assetRoutes(raw, mode === "direct" && !proxyRequired ? [] : ordered,
    !proxyRequired, appProtocol, workers, mode === "auto" && !proxyRequired);
}
