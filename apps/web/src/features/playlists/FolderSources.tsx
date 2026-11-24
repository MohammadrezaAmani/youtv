import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import { createChannel } from "@youtv/shared";
import { ActionButton } from "@/components/ui/action-button";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchBox } from "@/components/ui/search-box";
import { FOLDER_SOURCE_PREFIX } from "@/lib/builtin";
import { parseM3u } from "@/lib/playlist";
import { normalizeError } from "@/lib/utils";
import { readCatalogAsset } from "@/lib/catalogCache";
import { useYoutv } from "@/stores/useYoutv";

type Source = {
  path: string;
  name: string;
  channelCount: number;
  bytes: number;
  kind: "playlist" | "hls" | "invalid";
};
type SourceFolder = {
  path: string;
  name: string;
  readme: string | null;
  fileCount: number;
  channelCount: number;
};
type FolderIndex = {
  version: number;
  sources: Source[];
  folders: SourceFolder[];
};
const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
const sourceUrl = (path: string) =>
  `${import.meta.env.BASE_URL}sources/${path.split("/").map(encodeURIComponent).join("/")}`;
const pathIsSafe = (path: string) =>
  path.length > 0 &&
  !path.startsWith("/") &&
  !path
    .split("/")
    .some(
      (part) =>
        part === "" || part === "." || part === ".." || part.includes("\\"),
    );
const nameWithoutExtension = (name: string) =>
  name
    .replace(/\.m3u8?$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();

/** Relative markdown images and links resolve within the matching source folder. */
function readmeUrlTransform(value: string, readmePath: string): string {
  try {
    const raw = value.trim();
    if (/^mailto:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return "";
    const root = new URL(
      `${import.meta.env.BASE_URL}sources/`,
      window.location.origin,
    );
    const base = new URL(sourceUrl(readmePath), window.location.origin);
    const resolved = new URL(raw, base);
    if (
      resolved.origin !== root.origin ||
      !resolved.pathname.startsWith(root.pathname)
    )
      return "";
    return resolved.href;
  } catch {
    return "";
  }
}

function ReadmePanel({ path, fa }: { path: string; fa: boolean }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setContent("");
    setError("");
    void fetch(sourceUrl(path), { signal: abort.signal, credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`README HTTP ${response.status}`);
        setContent(await response.text());
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(normalizeError(e));
      });
    return () => abort.abort();
  }, [path]);
  return (
    <div className="folder-readme" dir="auto">
      {error && (
        <div className="folder-source-error" role="alert">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}
      {!error && !content && (
        <span className="muted">
          {fa ? "در حال خواندن README…" : "Loading README…"}
        </span>
      )}
      {content && (
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          urlTransform={(url) => readmeUrlTransform(url, path)}
        >
          {content}
        </Markdown>
      )}
    </div>
  );
}

function isSource(value: unknown): value is Source {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Source>;
  return (
    typeof item.path === "string" &&
    pathIsSafe(item.path) &&
    typeof item.name === "string" &&
    typeof item.channelCount === "number" &&
    Number.isFinite(item.channelCount) &&
    typeof item.bytes === "number" &&
    ["playlist", "hls", "invalid"].includes(String(item.kind))
  );
}
function isFolder(value: unknown): value is SourceFolder {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SourceFolder>;
  return (
    typeof item.path === "string" &&
    (item.path === "" || pathIsSafe(item.path)) &&
    typeof item.name === "string" &&
    (item.readme === null ||
      (typeof item.readme === "string" && pathIsSafe(item.readme))) &&
    typeof item.fileCount === "number" &&
    typeof item.channelCount === "number"
  );
}

export default function FolderSources() {
  const settings = useYoutv((s) => s.settings),
    channels = useYoutv((s) => s.channels),
    update = useYoutv((s) => s.updateSettings);
  const upsert = useYoutv((s) => s.upsertChannels),
    savePlaylist = useYoutv((s) => s.savePlaylist);
  const fa = settings.language === "fa";
  const [catalog, setCatalog] = useState<FolderIndex>({
    version: 2,
    sources: [],
    folders: [],
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [query, setQuery] = useState("");
  const [error, setError] = useState(""),
    [messages, setMessages] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState<Record<string, boolean>>({ "": true });
  const [readmeOpen, setReadmeOpen] = useState<Record<string, boolean>>({});
  const applyCatalog = (raw: string) => {
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !("sources" in data) ||
      !Array.isArray(data.sources)
    )
      throw new Error("Invalid source catalog");
    const entry = data as {
      version?: number;
      sources: unknown[];
      folders?: unknown[];
    };
    const sources = entry.sources.filter(isSource);
    const folders = Array.isArray(entry.folders)
      ? entry.folders.filter(isFolder)
      : [];
    setCatalog({ version: entry.version || 1, sources, folders });
  };
  const reload = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const raw = await readCatalogAsset("sources/index.json", {
        force,
        onUpdated: (text) => {
          try {
            applyCatalog(text);
          } catch {
            /* Keep last valid catalog. */
          }
        },
      });
      applyCatalog(raw);
    } catch (e) {
      setError(normalizeError(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
    if (import.meta.hot) {
      const listener = () => {
        void reload(true);
      };
      import.meta.hot.on("youtv:sources-changed", listener);
      return () => import.meta.hot?.off("youtv:sources-changed", listener);
    }
  }, []);

  const { sources, folders } = catalog;
  const normalized = query.trim().toLocaleLowerCase();
  // Old v1 catalogs had only flat paths; build an equivalent folder tree client-side.
  const effectiveFolders = useMemo(() => {
    if (folders.length) return folders;
    const paths = [
      ...new Set(
        sources.flatMap((source) => {
          const parts = source.path.split("/");
          return parts
            .slice(0, -1)
            .map((_, index) => parts.slice(0, index + 1).join("/"));
        }),
      ),
    ];
    const count = (path: string) => {
      const matches = sources.filter((source) =>
        source.path.startsWith(path ? `${path}/` : ""),
      );
      return {
        fileCount: matches.length,
        channelCount: matches.reduce(
          (sum, source) => sum + source.channelCount,
          0,
        ),
      };
    };
    return [
      { path: "", name: "sources", readme: null, ...count("") },
      ...paths.map((path) => ({
        path,
        name: path.split("/").at(-1) || path,
        readme: null,
        ...count(path),
      })),
    ] as SourceFolder[];
  }, [folders, sources]);
  const visibleSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          !normalized || source.path.toLocaleLowerCase().includes(normalized),
      ),
    [sources, normalized],
  );
  const visibleFolders = useMemo(() => {
    if (!normalized) return effectiveFolders;
    return effectiveFolders.filter(
      (folder) =>
        folder.path === "" ||
        folder.path.toLocaleLowerCase().includes(normalized) ||
        visibleSources.some((source) =>
          source.path.startsWith(folder.path ? `${folder.path}/` : ""),
        ),
    );
  }, [effectiveFolders, normalized, visibleSources]);
  const directSources = useMemo(() => {
    const out = new Map<string, Source[]>();
    for (const source of visibleSources) {
      const parent = parentOf(source.path);
      out.set(parent, [...(out.get(parent) || []), source]);
    }
    return out;
  }, [visibleSources]);
  const directFolders = useMemo(() => {
    const out = new Map<string, SourceFolder[]>();
    for (const folder of visibleFolders) {
      if (folder.path === "") continue;
      const parent = parentOf(folder.path);
      out.set(parent, [...(out.get(parent) || []), folder]);
    }
    return out;
  }, [visibleFolders]);
  const activeCount = sources.filter(
    (source) => settings.folderSourceEnabled[source.path] === true,
  ).length;
  const availableChannels = sources.reduce(
    (sum, source) => sum + source.channelCount,
    0,
  );
  const importedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const channel of channels)
      if (channel.sourceId.startsWith(FOLDER_SOURCE_PREFIX))
        counts.set(channel.sourceId, (counts.get(channel.sourceId) || 0) + 1);
    return counts;
  }, [channels]);

  const toggle = async (source: Source, enable: boolean) => {
    if (busy) return;
    if (!enable) {
      update({
        folderSourceEnabled: {
          ...settings.folderSourceEnabled,
          [source.path]: false,
        },
      });
      return;
    }
    if (source.kind === "invalid") {
      setMessages((previous) => ({
        ...previous,
        [source.path]: fa
          ? "این فایل آدرس رسانه قابل خواندن ندارد."
          : "No readable media URLs in this file.",
      }));
      return;
    }
    setBusy(source.path);
    setMessages((previous) => ({ ...previous, [source.path]: "" }));
    try {
      const response = await fetch(sourceUrl(source.path), {
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const id = FOLDER_SOURCE_PREFIX + source.path;
      const result =
        source.kind === "hls"
          ? {
              channels: [
                createChannel({
                  name: nameWithoutExtension(source.name),
                  url: new URL(sourceUrl(source.path), window.location.origin)
                    .href,
                  format: "hls",
                  group: parentOf(source.path),
                }),
              ],
              warnings: [],
            }
          : parseM3u(
              await response.text(),
              new URL(sourceUrl(source.path), window.location.origin).href,
            );
      const existing = useYoutv
        .getState()
        .playlists.find((playlist) => playlist.id === id);
      upsert(result.channels, id, true);
      savePlaylist({
        id,
        name: source.path,
        url: "",
        count: result.channels.length,
        importedAt: existing?.importedAt ?? Date.now(),
        refreshedAt: Date.now(),
        refreshWorkerId: "",
      });
      update({
        folderSourceEnabled: {
          ...useYoutv.getState().settings.folderSourceEnabled,
          [source.path]: true,
        },
      });
      setMessages((previous) => ({
        ...previous,
        [source.path]: `${result.channels.length.toLocaleString()} ${fa ? "شبکه بارگذاری شد" : "channels imported"}${result.warnings.length ? ` · ${result.warnings.length} ${fa ? "هشدار" : "warnings"}` : ""}`,
      }));
    } catch (e) {
      setMessages((previous) => ({
        ...previous,
        [source.path]: normalizeError(e),
      }));
    } finally {
      setBusy("");
    }
  };

  const renderSource = (source: Source) => {
    const enabled = settings.folderSourceEnabled[source.path] === true;
    const count = importedCounts.get(FOLDER_SOURCE_PREFIX + source.path);
    const usable = source.kind !== "invalid";
    return (
      <div className="folder-source-row" key={source.path}>
        <div className="folder-source-info">
          <strong title={source.path}>{source.name}</strong>
          <small>
            {`${count ?? source.channelCount} ${source.kind === "hls" ? (fa ? "استریم HLS" : "HLS stream") : fa ? "شبکه" : "channels"}`}{" "}
            ·{" "}
            {new Intl.NumberFormat(settings.language, {
              maximumFractionDigits: 1,
            }).format(source.bytes / 1024)}{" "}
            KB
          </small>
          {messages[source.path] && (
            <small className="folder-source-message">
              {messages[source.path]}
            </small>
          )}
        </div>
        <label className="folder-source-toggle">
          <Checkbox
            disabled={Boolean(busy) || (!usable && !enabled)}
            checked={enabled}
            onChange={(event) => void toggle(source, event.target.checked)}
          />
          <span>{enabled ? (fa ? "فعال" : "On") : fa ? "غیرفعال" : "Off"}</span>
        </label>
        {enabled && (
          <ActionButton
            className="folder-source-refresh"
            disabled={Boolean(busy)}
            onClick={() => void toggle(source, true)}
            title={fa ? "بازخوانی" : "Reload"}
          >
            <RefreshCw size={16} />
          </ActionButton>
        )}
      </div>
    );
  };
  const renderFolder = (folder: SourceFolder, depth: number): ReactNode => {
    const expanded = opened[folder.path] ?? (!normalized && folder.path === "");
    const readmeVisible = readmeOpen[folder.path] !== false;
    const children = directFolders.get(folder.path) || [];
    const files = directSources.get(folder.path) || [];
    return (
      <section
        key={folder.path || "root"}
        className={`source-tree-folder ${folder.path ? "" : "source-tree-root"}`}
      >
        {folder.path && (
          <ActionButton
            className="source-tree-folder-head"
            aria-expanded={expanded}
            onClick={() =>
              setOpened((previous) => ({
                ...previous,
                [folder.path]: !expanded,
              }))
            }
          >
            {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            {expanded ? <FolderOpen size={19} /> : <Folder size={19} />}
            <strong dir="auto">{folder.name}</strong>
            <span>
              {folder.fileCount.toLocaleString()} {fa ? "فایل" : "files"} ·{" "}
              {folder.channelCount.toLocaleString()} {fa ? "شبکه" : "channels"}
            </span>
          </ActionButton>
        )}
        {(expanded || normalized || folder.path === "") && (
          <div
            className="source-tree-contents"
            style={{ "--tree-depth": Math.min(depth, 6) } as CSSProperties}
          >
            {folder.readme && (
              <div className="source-readme-container">
                <ActionButton
                  className="source-readme-toggle"
                  onClick={() =>
                    setReadmeOpen((previous) => ({
                      ...previous,
                      [folder.path]: previous[folder.path] === false,
                    }))
                  }
                  aria-expanded={readmeVisible}
                >
                  <FileText size={17} />
                  <strong>
                    {fa
                      ? "اطلاعات و کاتالوگ منابع"
                      : "Source information & catalog"}
                  </strong>
                  <span>README.md</span>
                  {readmeVisible ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </ActionButton>
                {readmeVisible && <ReadmePanel path={folder.readme} fa={fa} />}
              </div>
            )}
            {files.length > 0 && (
              <div className="folder-sources-list">
                {files.map(renderSource)}
              </div>
            )}
            {children.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </section>
    );
  };

  const root = effectiveFolders.find((folder) => folder.path === "") || {
    path: "",
    name: "sources",
    readme: null,
    fileCount: 0,
    channelCount: 0,
  };

  return (
    <section
      className="folder-sources"
      aria-label={fa ? "منابع پوشه‌ای" : "Folder sources"}
    >
      <div className="folder-sources-heading">
        <div>
          <h2>
            <FolderOpen size={20} />
            {fa ? "منابع پوشه‌ای" : "Folder sources"}
          </h2>
          <p className="muted">
            {sources.length.toLocaleString()} {fa ? "فایل" : "files"} ·{" "}
            {activeCount.toLocaleString()} {fa ? "فعال" : "enabled"} ·{" "}
            {availableChannels.toLocaleString()}{" "}
            {fa ? "ورودی شبکه" : "channel entries"}
          </p>
        </div>
        <ActionButton
          className="folder-sources-reload"
          onClick={() => void reload(true)}
          disabled={loading}
        >
          <RefreshCw size={16} />
          {fa ? "به‌روزرسانی" : "Refresh"}
        </ActionButton>
      </div>
      {sources.length > 0 && (
        <SearchBox
          size="compact"
          className="folder-source-search"
          value={query}
          onChange={setQuery}
          placeholder={
            fa ? "جست‌وجوی پوشه یا فایل…" : "Search folders and files…"
          }
        />
      )}
      {error && (
        <p className="folder-source-error" role="alert">
          <AlertTriangle size={16} />
          {error}
        </p>
      )}
      {loading && (
        <p className="folder-source-empty">
          {fa ? "در حال خواندن منابع…" : "Reading sources…"}
        </p>
      )}
      {!loading && !error && sources.length === 0 && (
        <p className="folder-source-empty">
          {fa
            ? "فایل M3U یا M3U8 در پوشه منابع پیدا نشد."
            : "No M3U or M3U8 files found."}
        </p>
      )}
      {!loading && !error && (
        <div className="folder-source-tree">{renderFolder(root, 0)}</div>
      )}
      {normalized && visibleSources.length === 0 && (
        <p className="folder-source-empty">
          {fa ? "فایلی با این نام پیدا نشد." : "No matching files."}
        </p>
      )}
    </section>
  );
}
