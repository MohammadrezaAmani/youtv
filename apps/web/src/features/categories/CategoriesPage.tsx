import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  FolderOpen,
  Radio,
  Heart,
  CheckCircle2,
} from "lucide-react";
import { useYoutv } from "@/stores/useYoutv";
import { isVisibleChannel } from "@/lib/builtin";
import { searchNormalize } from "@/lib/library";
import { SearchBox } from "@/components/ui/search-box";
import { Select, SelectOption } from "@/components/ui/select";
import { ActionButton } from "@/components/ui/action-button";

type Sort = "count" | "name" | "favorites";
export default function CategoriesPage({
  onOpen,
}: {
  onOpen: (group: string) => void;
}) {
  const channels = useYoutv((s) => s.channels),
    settings = useYoutv((s) => s.settings),
    health = useYoutv((s) => s.health);
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState<Sort>("count");
  const fa = settings.language === "fa";
  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      {
        name: string;
        total: number;
        favorites: number;
        online: number;
        logo: string;
      }
    >();
    for (const c of channels) {
      if (!isVisibleChannel(c, settings)) continue;
      const group = c.group.trim() || (fa ? "بدون دسته" : "Uncategorized");
      const item = grouped.get(group) || {
        name: group,
        total: 0,
        favorites: 0,
        online: 0,
        logo: "",
      };
      item.total++;
      if (c.favorite) item.favorites++;
      if (health[c.id]?.status === "online") item.online++;
      if (!item.logo && c.logo) item.logo = c.logo;
      grouped.set(group, item);
    }
    return [...grouped.values()]
      .filter((g) => searchNormalize(g.name).includes(searchNormalize(query)))
      .sort((a, b) =>
        sort === "name"
          ? a.name.localeCompare(b.name, fa ? "fa" : "en")
          : sort === "favorites"
            ? b.favorites - a.favorites || b.total - a.total
            : b.total - a.total || a.name.localeCompare(b.name),
      );
  }, [channels, settings, health, query, sort, fa]);
  return (
    <section className="page-content categories-page">
      <header className="category-page-header">
        <div className="eyebrow">
          {fa ? "کتابخانه / دسته‌بندی‌ها" : "LIBRARY / CATEGORIES"}
        </div>
        <h1>
          <FolderOpen size={27} />
          {fa ? "دسته‌بندی شبکه‌ها" : "Channel categories"}
        </h1>
        <p>
          {fa
            ? "همه گروه‌های واقعی پلی‌لیست‌ها، با تعداد کانال، علاقه‌مندی‌ها و نتیجه تست اتصال."
            : "Every group from your real playlists, with counts, favorites and connection results."}
        </p>
      </header>
      <div className="category-toolbar">
        <SearchBox
          className="category-search"
          size="compact"
          value={query}
          onChange={setQuery}
          placeholder={fa ? "جست‌وجوی گروه‌ها…" : "Search categories…"}
          ariaLabel={fa ? "جست‌وجوی گروه‌ها" : "Search categories"}
        />
        <Select
          aria-label={fa ? "مرتب‌سازی گروه‌ها" : "Sort groups"}
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <SelectOption value="count">
            {fa ? "بیشترین شبکه" : "Most channels"}
          </SelectOption>
          <SelectOption value="name">{fa ? "نام گروه" : "Name"}</SelectOption>
          <SelectOption value="favorites">
            {fa ? "بیشترین محبوب‌ها" : "Most favorites"}
          </SelectOption>
        </Select>
        <span className="category-total">
          {groups.length.toLocaleString()} {fa ? "گروه" : "groups"}
        </span>
      </div>
      <div className="category-grid">
        {groups.map((group) => (
          <ActionButton
            key={group.name}
            className="category-tile"
            onClick={() =>
              onOpen(
                group.name === (fa ? "بدون دسته" : "Uncategorized")
                  ? "__ungrouped__"
                  : group.name,
              )
            }
          >
            <div className="category-tile-art">
              {group.logo ? (
                <img loading="lazy" src={group.logo} alt="" />
              ) : (
                <Radio size={32} />
              )}
              <span>
                <ArrowUpRight size={18} />
              </span>
            </div>
            <div className="category-tile-body">
              <strong title={group.name}>{group.name}</strong>
              <span>
                {group.total.toLocaleString()} {fa ? "شبکه" : "channels"}
              </span>
            </div>
            <div className="category-tile-meta">
              <span>
                <Heart size={14} /> {group.favorites}
              </span>
              <span>
                <CheckCircle2 size={14} /> {group.online}{" "}
                {fa ? "متصل" : "online"}
              </span>
            </div>
          </ActionButton>
        ))}
      </div>
      {!groups.length && (
        <div className="category-empty">
          {fa ? "دسته‌ای با این جست‌وجو پیدا نشد." : "No matching categories."}
        </div>
      )}
    </section>
  );
}
