import type { Channel } from "@youtv/shared";

export type SortMode =
  "name" | "name-desc" | "newest" | "oldest" | "last-played" | "group";
export type LayoutMode = "grid" | "list" | "compact";
export type LibraryFilters = {
  query: string;
  group: string;
  tag: string;
  country: string;
  language: string;
  source: string;
  favoritesOnly: boolean;
  sort: SortMode;
};
export const defaultFilters: LibraryFilters = {
  query: "",
  group: "",
  tag: "",
  country: "",
  language: "",
  source: "",
  favoritesOnly: false,
  sort: "name",
};

export function searchNormalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670\u200C\u200D]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function channelMatches(channel: Channel, query: string): boolean {
  const words = searchNormalize(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const fields = [
    channel.name,
    channel.group,
    channel.country,
    channel.language,
    channel.tvgId,
    channel.description,
    ...channel.tags,
  ];
  const joined = searchNormalize(fields.join(" "));
  return words.every(
    (word) =>
      joined.includes(word) ||
      (word.length >= 5 &&
        joined.split(" ").some((token) => editDistanceAtMostOne(token, word))),
  );
}
function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}
export function facets(channels: Channel[]) {
  const unique = (values: string[]) =>
    [...new Set(values.map((s) => s.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "fa"),
    );
  return {
    groups: unique(channels.map((c) => c.group)),
    tags: unique(channels.flatMap((c) => c.tags)),
    countries: unique(channels.map((c) => c.country)),
    languages: unique(channels.map((c) => c.language)),
    sources: [
      ...(channels.some((c) => !c.sourceId) ? ["__personal"] : []),
      ...unique(channels.map((c) => c.sourceId)),
    ],
  };
}
export function filterChannels(
  channels: Channel[],
  filters: LibraryFilters,
  recent: string[],
): Channel[] {
  const recentIndex = new Map(recent.map((id, index) => [id, index]));
  const collator = new Intl.Collator("fa", {
    numeric: true,
    sensitivity: "base",
  });
  const output = channels.filter(
    (c) =>
      (!filters.group ||
        (filters.group === "__ungrouped__"
          ? !c.group
          : c.group === filters.group)) &&
      (!filters.tag || c.tags.includes(filters.tag)) &&
      (!filters.country || c.country === filters.country) &&
      (!filters.language || c.language === filters.language) &&
      (!filters.source ||
        (filters.source === "__personal"
          ? !c.sourceId
          : c.sourceId === filters.source)) &&
      (!filters.favoritesOnly || c.favorite) &&
      channelMatches(c, filters.query),
  );
  const compare = (a: Channel, b: Channel) => {
    if (filters.sort === "newest") return b.createdAt - a.createdAt;
    if (filters.sort === "oldest") return a.createdAt - b.createdAt;
    if (filters.sort === "last-played")
      return (
        (recentIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (recentIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    if (filters.sort === "group")
      return (
        collator.compare(a.group, b.group) || collator.compare(a.name, b.name)
      );
    return (
      (filters.sort === "name-desc" ? -1 : 1) * collator.compare(a.name, b.name)
    );
  };
  return output.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || compare(a, b),
  );
}
export function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,،\n;]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);
}
