import { createReadStream, existsSync } from "node:fs";
import { readdir, stat, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** Scan only at development/build time. The deployed client reads a static JSON catalog. */
export type LocalSourceEntry = {
  path: string;
  name: string;
  channelCount: number;
  bytes: number;
  kind: "playlist" | "hls" | "invalid";
};
export type LocalSourceFolder = {
  path: string;
  name: string;
  readme: string | null;
  fileCount: number;
  channelCount: number;
};
export type LocalSourceCatalog = {
  version: 2;
  sources: LocalSourceEntry[];
  folders: LocalSourceFolder[];
};

/** Vitest can transform import.meta.url into an HTTP URL; avoid fileURLToPath(import.meta.url). */
const defaultRoot = () => {
  const local = resolve(process.cwd(), "public", "sources");
  const monorepo = resolve(process.cwd(), "apps", "web", "public", "sources");
  // Vite runs from apps/web; `bun run sources:check` runs from the monorepo root.
  return existsSync(local) ? local : existsSync(monorepo) ? monorepo : local;
};
const webPath = (root: string, full: string) =>
  relative(root, full).split(sep).join("/");
const hlsTag =
  /^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|PART-INF|PLAYLIST-TYPE|MAP|KEY|ENDLIST|PART|PRELOAD-HINT|SERVER-CONTROL|I-FRAME-STREAM-INF|DISCONTINUITY-SEQUENCE)(?=[:\s]|$)/i;
const streamUrl =
  /^(?:https?:\/\/|\/\/|\.\.?\/|[^\s#]+\.(?:m3u8?|mp4|ts|m4s)(?:[?#].*)?$)/i;

/** Stream line by line: files of any size can be catalogued without a 15 MB cut-off. */
async function classify(
  full: string,
): Promise<Pick<LocalSourceEntry, "kind" | "channelCount">> {
  let urls = 0;
  let hls = false;
  let awaitingUri = false;
  const lines = createInterface({
    input: createReadStream(full, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const raw of lines) {
      const line = raw.replace(/^\uFEFF/, "").trim();
      if (hlsTag.test(line)) {
        hls = true;
        continue;
      }
      if (/^#EXTINF:/i.test(line)) {
        awaitingUri = true;
        continue;
      }
      if (!line || line.startsWith("#")) continue;
      if (streamUrl.test(line) || (awaitingUri && !/\s/.test(line))) urls++;
      awaitingUri = false;
    }
  } finally {
    lines.close();
  }
  if (hls) return { kind: "hls", channelCount: 1 };
  // Headerless IPTV sources and bare URL lists are valid as long as there are streams.
  if (urls > 0) return { kind: "playlist", channelCount: urls };
  return { kind: "invalid", channelCount: 0 };
}

export async function scanSourceCatalog(
  root = defaultRoot(),
): Promise<LocalSourceCatalog> {
  const sources: LocalSourceEntry[] = [];
  const folders: LocalSourceFolder[] = [];
  async function visit(dir: string): Promise<void> {
    let children;
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const folderPath = webPath(root, dir);
    const folder: LocalSourceFolder = {
      path: folderPath === "." ? "" : folderPath,
      name:
        folderPath === "." ? "sources" : dir.split(sep).at(-1) || folderPath,
      readme: null,
      fileCount: 0,
      channelCount: 0,
    };
    folders.push(folder);
    for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "_verified") continue;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (/^readme\.(?:md|txt)$/i.test(entry.name)) {
        folder.readme = webPath(root, full);
        continue;
      }
      if (!/\.m3u8?$/i.test(entry.name)) continue;
      const path = webPath(root, full);
      const bytes = (await stat(full)).size;
      const classified = await classify(full);
      sources.push({ path, name: entry.name, bytes, ...classified });
    }
  }
  await visit(root);
  for (const folder of folders) {
    const prefix = folder.path ? `${folder.path}/` : "";
    const relevant = sources.filter((source) => source.path.startsWith(prefix));
    folder.fileCount = relevant.length;
    folder.channelCount = relevant.reduce(
      (sum, source) => sum + source.channelCount,
      0,
    );
  }
  return {
    version: 2,
    sources: sources.sort((a, b) => a.path.localeCompare(b.path)),
    folders: folders.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Backwards-compatible entry point for old tests and integrations. */
export async function scanLocalSources(
  root = defaultRoot(),
): Promise<LocalSourceEntry[]> {
  return (await scanSourceCatalog(root)).sources;
}

export function sourceCatalogPlugin(): Plugin {
  let root = defaultRoot();
  let outputRoot = "";
  const catalog = () => scanSourceCatalog(root);
  return {
    name: "youtv-source-catalog",
    configResolved(config) {
      root = resolve(config.root, "public", "sources");
      outputRoot = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.watcher.add(root);
      const publish = (path: string) => {
        const absolute = resolve(path);
        if (
          absolute.startsWith(root + sep) &&
          /(?:\.m3u8?|readme\.(?:md|txt))$/i.test(absolute)
        ) {
          server.ws.send({ type: "custom", event: "youtv:sources-changed" });
        }
      };
      server.watcher.on("add", publish);
      server.watcher.on("unlink", publish);
      server.watcher.on("change", publish);
      server.middlewares.use(async (req, res, next) => {
        if (!(req.url || "").split("?")[0]?.endsWith("/sources/index.json"))
          return next();
        try {
          const result = await catalog();
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(result));
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sources/index.json",
        source: JSON.stringify(await catalog()),
      });
    },
    async closeBundle() {
      if (outputRoot) await rm(resolve(outputRoot, "sources", "_verified"), { recursive: true, force: true });
    },
  };
}
