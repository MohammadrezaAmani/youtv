import { ChannelImage } from "@/components/common/RoutedAsset";
import { Select, SelectOption } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionButton } from "@/components/ui/action-button";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownWideNarrow,
  CheckSquare2,
  ChevronDown,
  Filter,
  Grid2x2,
  Heart,
  LayoutList,
  List,
  Pin,
  Play,
  Plus,
  Radio,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { Channel } from "@youtv/shared";
import ChannelCard from "@/features/channels/ChannelCard";
import { Button } from "@/components/ui/button";
import { useYoutv } from "@/stores/useYoutv";
import {
  defaultFilters,
  facets,
  filterChannels,
  parseTags,
  type LayoutMode,
  type LibraryFilters,
  type SortMode,
} from "@/lib/library";
import { ui } from "@/lib/labels";
import { isVisibleChannel } from "@/lib/builtin";

type Props = {
  initialGroup?: string;
  home?: boolean;
  kind: "all" | "favorites" | "recent";
  search: string;
  onSearch: (value: string) => void;
  onWatch: (id: string) => void;
  onEdit: (channel: Channel) => void;
  onAdd: () => void;
  onImport: () => void;
  onNavigate: (route: string) => void;
};
const sorts: SortMode[] = [
  "name",
  "name-desc",
  "newest",
  "oldest",
  "last-played",
  "group",
];
const sortLabels: Record<SortMode, Parameters<typeof ui>[0]> = {
  name: "sortName",
  "name-desc": "sortNameDesc",
  newest: "sortNewest",
  oldest: "sortOldest",
  "last-played": "sortRecent",
  group: "sortGroup",
};

export default function ChannelLibrary({
  initialGroup = "",
  home = false,
  kind,
  search,
  onSearch,
  onWatch,
  onEdit,
  onAdd,
  onImport,
  onNavigate,
}: Props) {
  const { t } = useTranslation();
  const allChannels = useYoutv((s) => s.channels),
    recent = useYoutv((s) => s.recent),
    playlists = useYoutv((s) => s.playlists),
    settings = useYoutv((s) => s.settings),
    updateSettings = useYoutv((s) => s.updateSettings);
  const health = useYoutv((s) => s.health);
  const channels = useMemo(
    () => allChannels.filter((c) => isVisibleChannel(c, settings)),
    [
      allChannels,
      settings.defaultPlaylistEnabled,
      settings.folderSourceEnabled,
    ],
  );
  const [healthFilter, setHealthFilter] = useState<
    "all" | "online" | "offline" | "unknown"
  >("all");
  const [pageLimit, setPageLimit] = useState(120);
  const bulkUpdate = useYoutv((s) => s.bulkUpdate),
    bulkDelete = useYoutv((s) => s.bulkDelete),
    bulkAddTags = useYoutv((s) => s.bulkAddTags),
    bulkRemoveTags = useYoutv((s) => s.bulkRemoveTags);
  const [filters, setFilters] = useState<Omit<LibraryFilters, "query">>({
    ...defaultFilters,
    group: initialGroup,
    sort: kind === "recent" ? "last-played" : settings.librarySort,
  });
  const layout: LayoutMode = settings.libraryLayout;
  const setLayout = (value: LayoutMode) =>
    updateSettings({ libraryLayout: value });
  const [advanced, setAdvanced] = useState(false),
    [bulk, setBulk] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const text = (key: Parameters<typeof ui>[0]) => ui(key, settings.language);
  const allFacets = useMemo(() => facets(channels), [channels]);
  const recently = useMemo(
    () =>
      recent
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is Channel => !!c)
        .slice(0, 5),
    [recent, channels],
  );
  const online = useMemo(
    () => channels.filter((c) => health[c.id]?.status === "online").length,
    [channels, health],
  );
  const offline = useMemo(
    () => channels.filter((c) => health[c.id]?.status === "offline").length,
    [channels, health],
  );
  const starred = useMemo(
    () => channels.filter((c) => c.favorite).slice(0, 5),
    [channels],
  );
  const base = useMemo(
    () =>
      kind === "favorites"
        ? channels.filter((c) => c.favorite)
        : kind === "recent"
          ? recent
              .map((id) => channels.find((c) => c.id === id))
              .filter((c): c is Channel => !!c)
          : channels,
    [channels, recent, kind],
  );
  const visible = useMemo(
    () =>
      filterChannels(base, { ...filters, query: search }, recent).filter(
        (c) =>
          healthFilter === "all" ||
          (health[c.id]?.status ?? "unknown") === healthFilter,
      ),
    [base, filters, search, recent, healthFilter, health],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const isFiltering = Boolean(
    search ||
    filters.group ||
    filters.tag ||
    filters.country ||
    filters.language ||
    filters.source ||
    filters.favoritesOnly ||
    healthFilter !== "all",
  );
  const adjust = <K extends keyof typeof filters>(
    key: K,
    value: (typeof filters)[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === "sort") updateSettings({ librarySort: value as SortMode });
  };
  const clear = () => {
    if (initialGroup) onNavigate("/channels");
    setPageLimit(120);
    setFilters({ ...defaultFilters, sort: settings.librarySort });
    setHealthFilter("all");
    onSearch("");
  };
  const toggleSelect = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  const batch = (
    action:
      | "fav"
      | "unfav"
      | "pin"
      | "unpin"
      | "delete"
      | "tags"
      | "remove-tags"
      | "group",
  ) => {
    if (!selected.length) return;
    if (action === "delete") {
      if (!confirm(text("bulkConfirm"))) return;
      bulkDelete(selected);
      setSelected([]);
      setBulk(false);
      return;
    }
    if (action === "tags") {
      const value = prompt(text("bulkTagPrompt"));
      if (value === null) return;
      const tags = parseTags(value);
      if (tags.length) bulkAddTags(selected, tags);
      return;
    }
    if (action === "remove-tags") {
      const value = prompt(text("bulkTagPrompt"));
      if (value === null) return;
      const tags = parseTags(value);
      if (tags.length) bulkRemoveTags(selected, tags);
      return;
    }
    if (action === "group") {
      const value = prompt(text("bulkGroupPrompt"));
      if (value === null) return;
      bulkUpdate(selected, { group: value.trim() });
      return;
    }
    bulkUpdate(
      selected,
      action === "fav"
        ? { favorite: true }
        : action === "unfav"
          ? { favorite: false }
          : action === "pin"
            ? { pinned: true }
            : { pinned: false },
    );
  };
  const select = <K extends keyof typeof filters>(
    key: K,
    label: string,
    values: string[],
    format?: (v: string) => string,
  ) => (
    <label className="filter-field" key={key}>
      <span>{label}</span>
      <Select
        className="ui-input"
        value={String(filters[key])}
        onChange={(e) => adjust(key, e.target.value as (typeof filters)[K])}
      >
        <SelectOption value="">{text("all")}</SelectOption>
        {values.map((v) => (
          <SelectOption key={v} value={v}>
            {format ? format(v) : v}
          </SelectOption>
        ))}
      </Select>
    </label>
  );
  const title =
    kind === "favorites"
      ? text("favoritesTitle")
      : kind === "recent"
        ? text("recentTitle")
        : text("library");
  return (
    <section className="page-content library-view">
      <div className="library-hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            {text("sidebarHeadline")}
          </div>
          <h1>{kind === "all" ? text("heroTitle") : title}</h1>
          <p>
            {kind === "all"
              ? text("heroDescription")
              : kind === "favorites"
                ? text("favoritesDescription")
                : text("recentDescription")}
          </p>
          <div className="hero-actions">
            <Button onClick={onAdd}>
              <Plus size={17} />
              {t("addChannel")}
            </Button>
            <Button variant="outline" onClick={onImport}>
              <Upload size={16} />
              {t("importPlaylist")}
            </Button>
          </div>
        </div>
        <div className="hero-decoration" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-screen">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      {home && channels.length > 0 && recently.length > 0 && (
        <div className="personal-strip">
          <div className="personal-strip-heading">
            <h3>{text("featured")}</h3>
            <ActionButton onClick={() => onNavigate("/recent")}>
              {text("viewAll")}
            </ActionButton>
          </div>
          <div className="personal-strip-cards">
            {recently.map((c) => (
              <ActionButton
                key={c.id}
                onClick={() => onWatch(c.id)}
                className="personal-mini-card"
              >
                <span className="personal-mini-logo">
                  {c.logo ? (
                    <ChannelImage channel={c} loading="lazy" alt="" />
                  ) : (
                    <Radio size={28} />
                  )}
                </span>
                <span>
                  <b>{c.name}</b>
                  <small>{c.group || text("directSource")}</small>
                </span>
                <Play size={16} />
              </ActionButton>
            ))}
          </div>
        </div>
      )}
      {home && channels.length > 0 && starred.length > 0 && (
        <div className="personal-strip">
          <div className="personal-strip-heading">
            <h3>{text("favoritesTitle")}</h3>
            <ActionButton onClick={() => onNavigate("/favorites")}>
              {text("viewAll")}
            </ActionButton>
          </div>
          <div className="personal-strip-cards">
            {starred.map((c) => (
              <ActionButton
                key={c.id}
                onClick={() => onWatch(c.id)}
                className="personal-mini-card"
              >
                <span className="personal-mini-logo">
                  {c.logo ? (
                    <ChannelImage channel={c} loading="lazy" alt="" />
                  ) : (
                    <Heart size={27} />
                  )}
                </span>
                <span>
                  <b>{c.name}</b>
                  <small>{c.group || text("directSource")}</small>
                </span>
                <Play size={16} />
              </ActionButton>
            ))}
          </div>
        </div>
      )}
      <div className="library-statstrip">
        <div>
          <strong>{channels.length.toLocaleString()}</strong>
          <span>{t("totalChannels")}</span>
        </div>
        <div>
          <strong>
            {channels.filter((c) => c.favorite).length.toLocaleString()}
          </strong>
          <span>{t("favorites")}</span>
        </div>
        <div>
          <strong>{allFacets.groups.length.toLocaleString()}</strong>
          <span>{t("groups")}</span>
        </div>
        <div>
          <strong>{playlists.length.toLocaleString()}</strong>
          <span>{t("playlists")}</span>
        </div>
      </div>
      <div className="library-section-header">
        <div>
          <span className="eyebrow">{text("curated")}</span>
          <h2>
            {title}
            <small>
              {visible.length.toLocaleString()} {text("results")}
            </small>
          </h2>
        </div>
        <div
          className="library-layout-actions"
          role="group"
          aria-label="Layout"
        >
          <ActionButton
            aria-label={text("grid")}
            title={text("grid")}
            className={layout === "grid" ? "is-active" : ""}
            onClick={() => setLayout("grid")}
          >
            <Grid2x2 size={17} />
          </ActionButton>
          <ActionButton
            aria-label={text("list")}
            title={text("list")}
            className={layout === "list" ? "is-active" : ""}
            onClick={() => setLayout("list")}
          >
            <LayoutList size={18} />
          </ActionButton>
          <ActionButton
            aria-label={text("compact")}
            title={text("compact")}
            className={layout === "compact" ? "is-active" : ""}
            onClick={() => setLayout("compact")}
          >
            <List size={17} />
          </ActionButton>
        </div>
      </div>
      <div className="library-toolbar">
        <div
          className="library-status-shortcuts"
          role="group"
          aria-label={
            settings.language === "fa" ? "فیلتر اتصال" : "Connection filters"
          }
        >
          <ActionButton
            className={healthFilter === "all" ? "active" : ""}
            onClick={() => setHealthFilter("all")}
          >
            {settings.language === "fa" ? "همه" : "All"}{" "}
            <b>{channels.length}</b>
          </ActionButton>
          <ActionButton
            className={healthFilter === "online" ? "active status-online" : ""}
            onClick={() => setHealthFilter("online")}
          >
            {settings.language === "fa" ? "متصل" : "Online"} <b>{online}</b>
          </ActionButton>
          <ActionButton
            className={
              healthFilter === "offline" ? "active status-offline" : ""
            }
            onClick={() => setHealthFilter("offline")}
          >
            {settings.language === "fa" ? "قطع" : "Offline"} <b>{offline}</b>
          </ActionButton>
          <ActionButton
            className={
              healthFilter === "unknown" ? "active status-unknown" : ""
            }
            onClick={() => setHealthFilter("unknown")}
          >
            {settings.language === "fa" ? "نامشخص / تست‌نشده" : "Unknown"}{" "}
            <b>{channels.length - online - offline}</b>
          </ActionButton>
          <ActionButton
            className="library-scan-link"
            onClick={() => onNavigate("/connectivity")}
          >
            {settings.language === "fa"
              ? "مدیریت تست سیگنال"
              : "Signal monitor"}
          </ActionButton>
          <ActionButton
            className="library-groups-link"
            onClick={() => onNavigate("/groups")}
          >
            {settings.language === "fa" ? "دسته‌بندی‌ها" : "Categories"}
          </ActionButton>
        </div>
        <div className="toolbar-actions">
          <ActionButton
            className={`toolbar-button ${advanced ? "active" : ""}`}
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            <SlidersHorizontal size={17} />
            <span>{text("filters")}</span>
            {isFiltering && <span className="filter-alert" />}
          </ActionButton>
          <label className="sort-select" title={text("sort")}>
            <ArrowDownWideNarrow size={17} />
            <Select
              value={filters.sort}
              onChange={(e) => adjust("sort", e.target.value as SortMode)}
              aria-label={text("sort")}
            >
              {sorts.map((s) => (
                <SelectOption value={s} key={s}>
                  {text(sortLabels[s])}
                </SelectOption>
              ))}
            </Select>
            <ChevronDown size={14} />
          </label>
          <ActionButton
            className={`toolbar-button ${bulk ? "active" : ""}`}
            onClick={() => {
              setBulk((v) => !v);
              setSelected([]);
            }}
          >
            <CheckSquare2 size={17} />
            <span>{text("select")}</span>
          </ActionButton>
        </div>
      </div>
      {advanced && (
        <div className="filters-panel">
          <div className="filters-panel-title">
            <strong>
              <Filter size={16} />
              {text("advanced")}
            </strong>
            <ActionButton
              onClick={() => setAdvanced(false)}
              aria-label={t("close")}
            >
              <X size={17} />
            </ActionButton>
          </div>
          <div className="filters-grid">
            {select("group", t("group"), allFacets.groups)}
            {select("tag", text("tag"), allFacets.tags)}
            {select("country", t("country"), allFacets.countries)}
            {select("language", t("language"), allFacets.languages)}
            {select("source", text("selectSource"), allFacets.sources, (id) =>
              id === "__personal"
                ? text("directSource")
                : playlists.find((p) => p.id === id)?.name || id,
            )}
            <label className="filter-field">
              <span>
                {settings.language === "fa"
                  ? "وضعیت اتصال"
                  : "Connection status"}
              </span>
              <Select
                className="ui-input"
                value={healthFilter}
                onChange={(e) =>
                  setHealthFilter(e.target.value as typeof healthFilter)
                }
              >
                <SelectOption value="all">All</SelectOption>
                <SelectOption value="online">Online</SelectOption>
                <SelectOption value="offline">Offline</SelectOption>
                <SelectOption value="unknown">Unknown / untested</SelectOption>
              </Select>
            </label>
            <label className="filter-field filter-check">
              <Checkbox
                checked={filters.favoritesOnly}
                onChange={(e) => adjust("favoritesOnly", e.target.checked)}
              />
              <Heart size={15} />
              {text("filterFavorites")}
            </label>
          </div>
          <div className="filter-footer">
            <ActionButton onClick={clear}>
              <X size={15} />
              {text("clearFilters")}
            </ActionButton>
            <Button size="sm" onClick={() => setAdvanced(false)}>
              {text("apply")}
            </Button>
          </div>
        </div>
      )}
      {isFiltering && (
        <div className="active-filter-line">
          <span>
            {text("showing")} <b>{visible.length}</b> {text("of")}{" "}
            <b>{base.length}</b>
          </span>
          {filters.tag && (
            <ActionButton onClick={() => adjust("tag", "")}>
              <Tags size={13} />
              {filters.tag} <X size={12} />
            </ActionButton>
          )}
          {filters.country && (
            <ActionButton onClick={() => adjust("country", "")}>
              {filters.country} <X size={12} />
            </ActionButton>
          )}
          {filters.language && (
            <ActionButton onClick={() => adjust("language", "")}>
              {filters.language} <X size={12} />
            </ActionButton>
          )}
          <ActionButton onClick={clear}>
            <X size={13} />
            {text("clearFilters")}
          </ActionButton>
        </div>
      )}
      {bulk && (
        <div
          className="bulk-toolbar"
          role="toolbar"
          aria-label={text("select")}
        >
          <span>
            <CheckSquare2 size={17} />
            <b>{selected.length}</b> {text("selected")}
          </span>
          <ActionButton onClick={() => setSelected(visible.map((c) => c.id))}>
            {text("selectAll")}
          </ActionButton>
          <ActionButton onClick={() => setSelected([])}>
            {text("deselectAll")}
          </ActionButton>
          <div className="bulk-divider" />
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("fav")}
          >
            <Heart size={15} />
            {text("bulkFavorite")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("unfav")}
          >
            {text("bulkRemoveFavorite")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("tags")}
          >
            <Tags size={15} />
            {text("bulkAddTags")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("remove-tags")}
          >
            {text("bulkRemoveTags")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("group")}
          >
            {text("bulkSetGroup")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("pin")}
          >
            <Pin size={15} />
            {text("bulkPin")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            onClick={() => batch("unpin")}
          >
            {text("bulkUnpin")}
          </ActionButton>
          <ActionButton
            disabled={!selected.length}
            className="danger"
            onClick={() => batch("delete")}
          >
            <Trash2 size={15} />
            {text("bulkDelete")}
          </ActionButton>
        </div>
      )}
      {visible.length > 0 ? (
        <div className={`channels-grid channels-${layout}`}>
          {visible.slice(0, pageLimit).map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              healthStatus={health[c.id]?.status || "untested"}
              onOpen={() => (bulk ? toggleSelect(c.id) : onWatch(c.id))}
              onEdit={() => onEdit(c)}
              selectable={bulk}
              selected={selectedSet.has(c.id)}
              onToggleSelect={() => toggleSelect(c.id)}
              onTagClick={(tag) => {
                adjust("tag", tag);
                setAdvanced(false);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="refined-empty">
          <div className="empty-orb">
            <Search size={36} />
          </div>
          <h2>
            {channels.length && !isFiltering
              ? kind === "favorites"
                ? text("favoritesTitle")
                : text("recentTitle")
              : channels.length
                ? text("noSearchResults")
                : text("emptyHeading")}
          </h2>
          <p>
            {channels.length
              ? kind === "favorites"
                ? text("noFavorites")
                : kind === "recent"
                  ? text("noRecent")
                  : text("tryClear")
              : text("emptyBody")}
          </p>
          <div className="row-wrap">
            {isFiltering ? (
              <Button variant="outline" onClick={clear}>
                {text("clearFilters")}
              </Button>
            ) : (
              <>
                <Button onClick={onAdd}>
                  <Plus size={16} />
                  {t("addChannel")}
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <Upload size={16} />
                  {t("importPlaylist")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {visible.length > pageLimit && (
        <div
          className="row-wrap"
          style={{ justifyContent: "center", marginBlock: 24 }}
        >
          <Button
            variant="outline"
            onClick={() => setPageLimit((n) => n + 120)}
          >
            {settings.language === "fa"
              ? "نمایش کانال‌های بیشتر"
              : "Load more channels"}{" "}
            ({Math.min(pageLimit, visible.length)} / {visible.length})
          </Button>
        </div>
      )}
    </section>
  );
}
