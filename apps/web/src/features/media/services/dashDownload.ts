import type { WorkerProfile } from "@youtv/shared";
import { proxyUrl } from "@/lib/proxy";
import type { ZipEntrySource } from "./download";
import { textByteStream } from "./byteStream";
import { archiveResourceRoutes, fetchArchiveResource } from "./mediaRoutes";

type SegmentSpec = { url: string; filename: string; range?: string };
function directChild(parent: Element, name: string): Element | null {
  return (
    Array.from(parent.children).find((node) => node.localName === name) || null
  );
}
function childText(parent: Element, name: string): string {
  return directChild(parent, name)?.textContent?.trim() || "";
}
function parseDuration(value: string): number | null {
  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  return (
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0)
  );
}
function expandTemplate(
  template: string,
  representationId: string,
  bandwidth: number,
  number: number,
  time: number,
): string {
  return template
    .replace(/\$\$/g, "\u0000")
    .replace(/\$RepresentationID\$/g, representationId)
    .replace(/\$Bandwidth\$/g, String(bandwidth))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (_m, width: string) =>
      String(number).padStart(Number(width) || 0, "0"),
    )
    .replace(/\$Time\$/g, String(time))
    .replace(/\u0000/g, "$");
}
function inheritedBase(nodes: Element[], initial: string): string {
  let result = initial;
  for (const node of nodes) {
    const value = childText(node, "BaseURL");
    if (value) result = new URL(value, result).toString();
  }
  return result;
}
function addSegment(
  entries: SegmentSpec[],
  url: string,
  filename: string,
  range?: string,
) {
  entries.push({ url: new URL(url).toString(), filename, range });
}
function mergedSegmentNode(nodes: Element[], name: string): Element | null {
  const found = nodes
    .map((node) => directChild(node, name))
    .filter((item): item is Element => Boolean(item));
  if (!found.length) return null;
  const base = found[0]!.cloneNode(false) as Element;
  for (const node of found) {
    for (const attribute of Array.from(node.attributes))
      base.setAttribute(attribute.name, attribute.value);
    const childNames = new Set(
      Array.from(node.children).map((child) => child.localName),
    );
    for (const childName of childNames) {
      for (const old of Array.from(base.children).filter(
        (child) => child.localName === childName,
      ))
        base.removeChild(old);
      for (const child of Array.from(node.children).filter(
        (child) => child.localName === childName,
      ))
        base.appendChild(child.cloneNode(true));
    }
  }
  return base;
}
function buildTimeline(
  template: Element,
  periodSeconds: number | null,
): { number: number; time: number; duration: number }[] {
  const timescale = Number(template.getAttribute("timescale") || 1) || 1;
  const defaultDuration = Number(template.getAttribute("duration") || 0);
  const startNumber = Number(template.getAttribute("startNumber") || 1) || 1;
  const timeline = directChild(template, "SegmentTimeline");
  const result: { number: number; time: number; duration: number }[] = [];
  let currentTime = 0,
    number = startNumber;
  if (timeline) {
    const entries = Array.from(timeline.children).filter(
      (node) => node.localName === "S",
    );
    for (let index = 0; index < entries.length; index++) {
      const item = entries[index]!;
      const duration = Number(item.getAttribute("d") || 0);
      if (!duration)
        throw new Error("DASH SegmentTimeline contains an invalid duration");
      const explicitTime = item.getAttribute("t");
      if (explicitTime !== null) currentTime = Number(explicitTime);
      let repeat = Number(item.getAttribute("r") || 0);
      if (repeat < 0) {
        const nextTime = entries[index + 1]?.getAttribute("t");
        const end =
          nextTime !== null && nextTime !== undefined
            ? Number(nextTime)
            : periodSeconds !== null
              ? Math.ceil(periodSeconds * timescale)
              : null;
        if (end === null)
          throw new Error(
            "DASH timeline uses r=-1 without a finite Period duration",
          );
        repeat = Math.max(0, Math.ceil((end - currentTime) / duration) - 1);
      }
      if (repeat > 5000 || result.length + repeat + 1 > 5000)
        throw new Error("DASH archive exceeds the 5000-segment safety limit");
      for (let n = 0; n <= repeat; n++) {
        result.push({ number: number++, time: currentTime, duration });
        currentTime += duration;
      }
    }
  } else {
    if (!defaultDuration || periodSeconds === null)
      throw new Error(
        "DASH SegmentTemplate requires a finite duration or SegmentTimeline",
      );
    const count = Math.ceil((periodSeconds * timescale) / defaultDuration);
    if (count > 5000)
      throw new Error("DASH archive exceeds the 5000-segment safety limit");
    for (let n = 0; n < count; n++)
      result.push({
        number: number++,
        time: n * defaultDuration,
        duration: defaultDuration,
      });
  }
  return result;
}
async function fetchManifest(
  url: string,
  signal?: AbortSignal,
): Promise<{ xml: string; finalUrl: string }> {
  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`DASH manifest HTTP ${response.status}`);
  const xml = await response.text();
  if (!/<MPD(?:\s|>)/i.test(xml))
    throw new Error("Response is not a DASH MPD manifest");
  return { xml, finalUrl: response.url || url };
}
export async function buildDashArchiveEntries(
  sourceUrl: string,
  worker: WorkerProfile | undefined,
  signal?: AbortSignal,
  fallbacks: WorkerProfile[] = [],
): Promise<{ entries: ZipEntrySource[]; name: string; segments: number }> {
  const requestUrl = new URL(worker ? proxyUrl(sourceUrl, worker) : sourceUrl);
  if (worker) requestUrl.searchParams.set("dash", "1");
  const loaded = await fetchManifest(requestUrl.toString(), signal);
  const doc = new DOMParser().parseFromString(loaded.xml, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("DASH MPD XML is malformed");
  const mpd = doc.documentElement;
  if (doc.getElementsByTagNameNS("*", "ContentProtection").length)
    throw new Error(
      "DRM-protected DASH content cannot be archived by the Media Center",
    );
  if (mpd.getAttribute("type") === "dynamic")
    throw new Error(
      "این MPD زنده است. دانلود آرشیوی فقط برای DASH VOD با مدت محدود پشتیبانی می‌شود.",
    );
  const mpdDuration = parseDuration(
    mpd.getAttribute("mediaPresentationDuration") || "",
  );
  const periods = Array.from(mpd.children).filter(
    (node) => node.localName === "Period",
  );
  if (!periods.length) throw new Error("DASH MPD contains no Period");
  const assets: SegmentSpec[] = [];
  let segmentCount = 0;
  const segmentBasePaths = new Map<Element, string>();
  periods.forEach((period, periodIndex) => {
    const periodDuration =
      parseDuration(period.getAttribute("duration") || "") || mpdDuration;
    const periodBase = inheritedBase([mpd, period], loaded.finalUrl);
    const adaptationSets = Array.from(period.children).filter(
      (node) => node.localName === "AdaptationSet",
    );
    adaptationSets.forEach((adaptation, adaptationIndex) => {
      const adaptationBase = inheritedBase([adaptation], periodBase);
      const representations = Array.from(adaptation.children).filter(
        (node) => node.localName === "Representation",
      );
      if (!representations.length)
        throw new Error("DASH AdaptationSet has no Representation");
      representations.forEach((representation, representationIndex) => {
        const representationId =
          representation.getAttribute("id") || `rep-${representationIndex + 1}`;
        const bandwidth = Number(representation.getAttribute("bandwidth") || 0);
        const representationBase = inheritedBase(
          [representation],
          adaptationBase,
        );
        const hierarchy = [mpd, period, adaptation, representation];
        const template = mergedSegmentNode(hierarchy, "SegmentTemplate");
        const segmentList = mergedSegmentNode(hierarchy, "SegmentList");
        const segmentBase = mergedSegmentNode(hierarchy, "SegmentBase");
        const folder = `period-${periodIndex + 1}/adaptation-${adaptationIndex + 1}/${safePart(representationId)}`;
        if (template) {
          const media = template.getAttribute("media") || "";
          const initialization = template.getAttribute("initialization") || "";
          if (!media)
            throw new Error("DASH SegmentTemplate media attribute is missing");
          const timeline = buildTimeline(template, periodDuration);
          if (initialization) {
            const url = expandTemplate(
              initialization,
              representationId,
              bandwidth,
              timeline[0]?.number || 1,
              timeline[0]?.time || 0,
            );
            addSegment(
              assets,
              new URL(url, representationBase).toString(),
              `${folder}/init.mp4`,
            );
          }
          timeline.forEach((segment, index) => {
            const url = expandTemplate(
              media,
              representationId,
              bandwidth,
              segment.number,
              segment.time,
            );
            const localNumber = index + 1;
            addSegment(
              assets,
              new URL(url, representationBase).toString(),
              `${folder}/segment-${String(localNumber).padStart(6, "0")}.m4s`,
            );
            segmentCount++;
          });
          const replacement = doc.createElementNS(
            template.namespaceURI,
            template.nodeName,
          );
          for (const name of [
            "timescale",
            "duration",
            "presentationTimeOffset",
          ]) {
            const value = template.getAttribute(name);
            if (value !== null) replacement.setAttribute(name, value);
          }
          replacement.setAttribute("startNumber", "1");
          replacement.setAttribute(
            "media",
            `${folder}/segment-$Number%06d$.m4s`,
          );
          if (initialization)
            replacement.setAttribute("initialization", `${folder}/init.mp4`);
          const oldTimeline = directChild(template, "SegmentTimeline");
          if (oldTimeline) replacement.appendChild(oldTimeline.cloneNode(true));
          const old = directChild(representation, "SegmentTemplate");
          if (old) representation.replaceChild(replacement, old);
          else representation.appendChild(replacement);
        } else if (segmentList) {
          const replacement = segmentList.cloneNode(true) as Element;
          const init = directChild(replacement, "Initialization");
          const initUrl = init?.getAttribute("sourceURL");
          if (init) {
            const range = init.getAttribute("range") || undefined;
            const target = initUrl
              ? new URL(initUrl, representationBase).toString()
              : representationBase;
            addSegment(assets, target, `${folder}/init.mp4`, range);
            init.setAttribute("sourceURL", `${folder}/init.mp4`);
            init.removeAttribute("range");
          }
          const segmentUrls = Array.from(replacement.children).filter(
            (node) => node.localName === "SegmentURL",
          );
          segmentUrls.forEach((segment, index) => {
            const media = segment.getAttribute("media");
            if (!media) throw new Error("DASH SegmentURL media is missing");
            const range = segment.getAttribute("mediaRange") || undefined;
            addSegment(
              assets,
              new URL(media, representationBase).toString(),
              `${folder}/segment-${String(index + 1).padStart(6, "0")}.m4s`,
              range,
            );
            segment.setAttribute(
              "media",
              `${folder}/segment-${String(index + 1).padStart(6, "0")}.m4s`,
            );
            segment.removeAttribute("mediaRange");
            segmentCount++;
          });
          const old = directChild(representation, "SegmentList");
          if (old) representation.replaceChild(replacement, old);
          else representation.appendChild(replacement);
        } else if (segmentBase) {
          const baseUrl = new URL(representationBase);
          if (baseUrl.pathname.endsWith("/"))
            throw new Error(
              "DASH SegmentBase does not resolve to a single media file",
            );
          const baseExtension =
            (baseUrl.pathname.split(".").at(-1) || "mp4")
              .replace(/[^A-Za-z0-9]/g, "")
              .slice(0, 8) || "mp4";
          const baseLocal = `${folder}/base.${baseExtension}`;
          addSegment(assets, representationBase, baseLocal);
          segmentBasePaths.set(representation, baseLocal);
          segmentCount++;
          const initialization = directChild(segmentBase, "Initialization");
          const initUrl = initialization?.getAttribute("sourceURL");
          if (initialization && initUrl) {
            addSegment(
              assets,
              new URL(initUrl, representationBase).toString(),
              `${folder}/initialization.bin`,
              initialization.getAttribute("range") || undefined,
            );
            initialization.setAttribute(
              "sourceURL",
              `${folder}/initialization.bin`,
            );
            initialization.removeAttribute("range");
          }
          const index = directChild(segmentBase, "RepresentationIndex");
          const indexUrl = index?.getAttribute("sourceURL");
          if (index && indexUrl) {
            addSegment(
              assets,
              new URL(indexUrl, representationBase).toString(),
              `${folder}/index.bin`,
              index.getAttribute("range") || undefined,
            );
            index.setAttribute("sourceURL", `${folder}/index.bin`);
            index.removeAttribute("range");
          }
          const old = directChild(representation, "SegmentBase");
          if (old) representation.replaceChild(segmentBase, old);
          else representation.appendChild(segmentBase);
        } else {
          throw new Error(
            "DASH representation has no SegmentTemplate, SegmentList or SegmentBase",
          );
        }
      });
    });
  });
  if (!segmentCount) throw new Error("No DASH media segments found");
  // All remote BaseURL values are removed. SegmentBase representations receive
  // a local BaseURL to the downloaded single-file resource.
  for (const node of Array.from(doc.getElementsByTagName("*"))) {
    if (
      ["BaseURL", "Location", "UTCTiming", "ContentSteering"].includes(
        node.localName,
      )
    )
      node.parentNode?.removeChild(node);
  }
  for (const [representation, localPath] of segmentBasePaths) {
    const base = doc.createElementNS(representation.namespaceURI, "BaseURL");
    base.textContent = localPath;
    const segmentBaseNode = directChild(representation, "SegmentBase");
    if (segmentBaseNode) representation.insertBefore(base, segmentBaseNode);
    else representation.appendChild(base);
  }
  mpd.setAttribute("type", "static");
  for (const name of [
    "minimumUpdatePeriod",
    "availabilityStartTime",
    "publishTime",
    "timeShiftBufferDepth",
  ])
    mpd.removeAttribute(name);
  const serialized = new XMLSerializer().serializeToString(doc);
  const entries: ZipEntrySource[] = [
    { filename: "manifest.mpd", open: async () => textByteStream(serialized) },
    ...assets.map((asset) => ({
      filename: asset.filename,
      open: async (entrySignal?: AbortSignal) => {
        const headers = new Headers();
        if (asset.range) headers.set("Range", `bytes=${asset.range}`);
        const response = await fetchArchiveResource(worker ? archiveResourceRoutes(asset.url, worker, fallbacks) : [asset.url], {
          headers, credentials: "omit", cache: "no-store", signal: entrySignal || signal,
        }, response => {
          if (!response.ok) throw new Error(`DASH segment HTTP ${response.status}`);
          if (asset.range && response.status !== 206)
            throw new Error("DASH origin ignored a byte-range request; refusing to create a corrupt archive");
        });
        if (!response.body) throw new Error("DASH segment has no body");
        return response.body;
      },
    })),
  ];
  return {
    entries,
    name: `${safePart(new URL(sourceUrl).pathname.split("/").at(-1) || "dash-stream")}-dash.zip`,
    segments: segmentCount,
  };
}
function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "media";
}
