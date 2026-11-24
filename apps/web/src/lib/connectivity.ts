import {
  type Channel,
  type HealthResult,
  type Settings,
  type WorkerProfile,
} from "@youtv/shared";
import { activeWorker, proxyUrl, needsHttpsRelay } from "./proxy";
import { readCatalogAsset } from "./catalogCache";

type ProbeAnswer = {
  ok?: boolean;
  status?: number;
  elapsedMs?: number;
  contentType?: string;
  error?: string;
};
const TIMEOUT_MS = 8000;
function elapsed(start: number) {
  return Math.max(0, Math.round(performance.now() - start));
}
function validStatus(status: number) {
  return status >= 200 && status < 400;
}
// The browser surfaces failed network requests and CORS blocks as this same
// error. In the channel monitor, the user explicitly wants these reported as
// offline. Aborts/timeouts and other errors are still inconclusive.
function isFailedToFetch(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:failed to fetch|networkerror when attempting to fetch resource|load failed)/i.test(
      error.message,
    )
  );
}
function isValidHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// DNS negatives are produced by the real resolver in GitHub Actions and
// published with the curated catalog. Never query a third-party DoH service
// from the visitor's browser: such endpoints can be blocked in Iran.
// readCatalogAsset is first-party, persisted in IndexedDB, and revalidated
// no more than once per 6 hours (except an explicit user refresh).
type DnsVerdict = "nxdomain" | "no_address" | "uncertain";
let verifiedReportRaw: string | undefined;
let verifiedDeadHosts = new Map<string, Exclude<DnsVerdict, "uncertain">>();
async function checkDns(hostname: string): Promise<DnsVerdict> {
  if (import.meta.env.VITE_YOUTV_CURATED !== "1") return "uncertain";
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (!host) return "uncertain";
  try {
    const raw = await readCatalogAsset("sources/_verified/dns-status.json");
    if (raw !== verifiedReportRaw) {
      const report = JSON.parse(raw) as {
        nxdomain?: unknown;
        noAddress?: unknown;
      };
      if (!Array.isArray(report.nxdomain) || !Array.isArray(report.noAddress))
        return "uncertain";
      const next = new Map<string, Exclude<DnsVerdict, "uncertain">>();
      for (const item of report.nxdomain) {
        if (typeof item === "string")
          next.set(item.replace(/\.$/, "").toLowerCase(), "nxdomain");
      }
      for (const item of report.noAddress) {
        if (typeof item === "string")
          next.set(item.replace(/\.$/, "").toLowerCase(), "no_address");
      }
      verifiedDeadHosts = next;
      verifiedReportRaw = raw;
    }
    return verifiedDeadHosts.get(host) ?? "uncertain";
  } catch {
    return "uncertain";
  }
}
async function dnsFailure(
  channel: Channel,
  started: number,
): Promise<HealthResult | undefined> {
  try {
    const host = new URL(channel.url).hostname;
    const result = await checkDns(host);
    if (result !== "nxdomain" && result !== "no_address") return undefined;
    return {
      status: "offline",
      mode: "direct",
      elapsedMs: elapsed(started),
      checkedAt: Date.now(),
      detail:
        result === "nxdomain"
          ? `DNS NXDOMAIN: ${host}`
          : `DNS has no A/AAAA record: ${host}`,
    };
  } catch {
    return undefined;
  }
}

/** Browser health checks are HTTP probes. Failed-to-fetch errors are reported offline. */
export async function probeChannel(
  channel: Channel,
  settings: Settings,
  workers: WorkerProfile[],
  signal?: AbortSignal,
  appProtocol = typeof window === "undefined"
    ? "https:"
    : window.location.protocol,
): Promise<HealthResult> {
  const started = performance.now();
  const worker = activeWorker(channel, settings, workers);
  const useProxy =
    needsHttpsRelay(channel.url, appProtocol) ||
    channel.proxyMode === "proxy" ||
    (channel.proxyMode === "inherit" && settings.proxyMode === "proxy");
  if (!isValidHttpUrl(channel.url))
    return {
      status: "offline",
      mode: "direct",
      elapsedMs: elapsed(started),
      checkedAt: Date.now(),
      detail: "Invalid stream URL",
    };
  const viaProxy = async (): Promise<HealthResult> => {
    if (!worker)
      return {
        status: "unknown",
        mode: "proxy",
        elapsedMs: elapsed(started),
        checkedAt: Date.now(),
        detail: "Worker unavailable",
      };
    if (appProtocol === "https:" && !/^https:\/\//i.test(worker.baseUrl))
      return {
        status: "unknown",
        mode: "proxy",
        elapsedMs: elapsed(started),
        checkedAt: Date.now(),
        detail: "HTTPS Worker endpoint required for secure pages",
      };
    try {
      const endpoint = proxyUrl(channel.url, worker, "probe");
      const response = await fetch(endpoint, {
        signal: AbortSignal.any([
          signal || new AbortController().signal,
          AbortSignal.timeout(TIMEOUT_MS),
        ]),
        credentials: "omit",
        cache: "no-store",
      });
      const value = (await response.json()) as ProbeAnswer;
      if (!response.ok || typeof value.status !== "number") {
        return {
          status: "unknown",
          mode: "proxy",
          elapsedMs: elapsed(started),
          checkedAt: Date.now(),
          detail: value.error || `Proxy probe HTTP ${response.status}`,
        };
      }
      return {
        status: validStatus(value.status) ? "online" : "offline",
        mode: "proxy",
        httpStatus: value.status,
        elapsedMs: value.elapsedMs ?? elapsed(started),
        checkedAt: Date.now(),
        detail: value.contentType || "",
      };
    } catch (error) {
      return {
        status: signal?.aborted
          ? "unknown"
          : isFailedToFetch(error)
            ? "offline"
            : "unknown",
        mode: "proxy",
        elapsedMs: elapsed(started),
        checkedAt: Date.now(),
        detail: signal?.aborted
          ? "Cancelled"
          : error instanceof Error
            ? error.message
            : "Proxy unreachable",
      };
    }
  };
  if (useProxy) {
    const result = await viaProxy();
    return result.status === "unknown" && !signal?.aborted
      ? ((await dnsFailure(channel, started)) ?? result)
      : result;
  }
  try {
    const response = await fetch(channel.url, {
      method: "HEAD",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(TIMEOUT_MS),
      ]),
    });
    if (response.status === 405 || response.status === 501) {
      const fallback = await fetch(channel.url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        credentials: "omit",
        signal: AbortSignal.any([
          signal || new AbortController().signal,
          AbortSignal.timeout(TIMEOUT_MS),
        ]),
      });
      await fallback.body?.cancel().catch(() => undefined);
      return {
        status: validStatus(fallback.status) ? "online" : "offline",
        mode: "direct",
        httpStatus: fallback.status,
        elapsedMs: elapsed(started),
        checkedAt: Date.now(),
        detail: "HTTP probe completed",
      };
    }
    return {
      status: validStatus(response.status) ? "online" : "offline",
      mode: "direct",
      httpStatus: response.status,
      elapsedMs: elapsed(started),
      checkedAt: Date.now(),
      detail: "HTTP probe completed",
    };
  } catch (error) {
    if (signal?.aborted)
      return {
        status: "unknown",
        mode: "direct",
        elapsedMs: elapsed(started),
        checkedAt: Date.now(),
        detail: "Cancelled",
      };
    if (worker) {
      const result = await viaProxy();
      if (result.status !== "unknown") return result;
      const dns = await dnsFailure(channel, started);
      if (dns) return dns;
      if (isFailedToFetch(error))
        return {
          status: "offline",
          mode: "direct",
          elapsedMs: elapsed(started),
          checkedAt: Date.now(),
          detail: error instanceof Error ? error.message : "Failed to fetch",
        };
      return {
        ...result,
        detail:
          result.detail || "Direct probe inconclusive; checked through Worker",
      };
    }
    const dns = await dnsFailure(channel, started);
    if (dns) return dns;
    return {
      status: isFailedToFetch(error) ? "offline" : "unknown",
      mode: "direct",
      elapsedMs: elapsed(started),
      checkedAt: Date.now(),
      detail: error instanceof Error ? error.message : "Network restriction",
    };
  }
}

export type ScanProgress = {
  completed: number;
  total: number;
  online: number;
  offline: number;
  unknown: number;
};
/** Concurrency-limited, cancellable scan. flush happens in batches to avoid thousands of storage writes. */
export async function scanChannels(
  channels: Channel[],
  settings: Settings,
  workers: WorkerProfile[],
  signal: AbortSignal,
  onBatch: (
    results: Record<string, HealthResult>,
    progress: ScanProgress,
  ) => void,
  concurrency = 8,
): Promise<void> {
  const progress: ScanProgress = {
    completed: 0,
    total: channels.length,
    online: 0,
    offline: 0,
    unknown: 0,
  };
  let cursor = 0;
  let pending: Record<string, HealthResult> = {};
  const flush = () => {
    if (Object.keys(pending).length) {
      onBatch(pending, { ...progress });
      pending = {};
    }
  };
  const worker = async () => {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= channels.length) break;
      const channel = channels[index]!;
      const result = await probeChannel(channel, settings, workers, signal);
      if (signal.aborted) break;
      pending[channel.id] = result;
      progress.completed++;
      progress[result.status]++;
      if (progress.completed % 48 === 0) flush();
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), 12, channels.length) },
      worker,
    ),
  );
  flush();
}
