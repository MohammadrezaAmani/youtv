/** Display names only: never rename source files or change their stored IDs. */
const displayNames = new Map<string, Intl.DisplayNames>();
function regionName(code: string, language: string): string {
  const region = code.toUpperCase() === "UK" ? "GB" : code.toUpperCase();
  try {
    let names = displayNames.get(language);
    if (!names) {
      names = new Intl.DisplayNames([language], { type: "region", fallback: "none" });
      displayNames.set(language, names);
    }
    return names.of(region) || region;
  } catch {
    return region;
  }
}
const folderNames: Record<string, [string, string]> = {
  "world-iptv": ["تلویزیون جهان", "World IPTV"],
  "countries": ["کشورها", "Countries"],
  "regions": ["مناطق", "Regions"],
  "master": ["مجموعه جهانی", "Global collection"],
  "indexes": ["نمایه‌ها", "Indexes"],
  "special": ["بین‌المللی", "Special"],
};
const regionLabels: Record<string, [string, string]> = {
  afr: ["آفریقا", "Africa"], amer: ["قاره آمریکا", "Americas"], apac: ["آسیا و اقیانوسیه", "Asia-Pacific"],
  arab: ["جهان عرب", "Arab world"], asean: ["آسه‌آن", "ASEAN"], asia: ["آسیا", "Asia"],
  balkan: ["بالکان", "Balkans"], benelux: ["بنلوکس", "Benelux"], carib: ["کارائیب", "Caribbean"],
  cas: ["آسیای مرکزی", "Central Asia"], cee: ["اروپای مرکزی و شرقی", "Central and Eastern Europe"],
  cenamer: ["آمریکای مرکزی", "Central America"], ceu: ["اروپای مرکزی", "Central Europe"],
  cis: ["کشورهای مستقل مشترک‌المنافع", "CIS"], eaf: ["شرق آفریقا", "East Africa"], eas: ["شرق آسیا", "East Asia"],
  emea: ["اروپا، خاورمیانه و آفریقا", "Europe, Middle East and Africa"], eu: ["اتحادیه اروپا", "European Union"],
  eur: ["اروپا", "Europe"], gcc: ["شورای همکاری خلیج فارس", "Gulf Cooperation Council"],
  hispam: ["آمریکای اسپانیایی‌زبان", "Hispanic America"], lac: ["آمریکای لاتین و کارائیب", "Latin America and Caribbean"],
  latam: ["آمریکای لاتین", "Latin America"], maghreb: ["مغرب عربی", "Maghreb"], mena: ["خاورمیانه و شمال آفریقا", "Middle East and North Africa"],
  mideast: ["خاورمیانه", "Middle East"], nam: ["شمال آمریکا", "Northern America"], neu: ["شمال اروپا", "Northern Europe"],
  noram: ["آمریکای شمالی", "North America"], nord: ["کشورهای نوردیک", "Nordic countries"], oce: ["اقیانوسیه", "Oceania"],
  saf: ["جنوب آفریقا", "Southern Africa"], sas: ["جنوب آسیا", "South Asia"], sea: ["جنوب شرق آسیا", "Southeast Asia"],
  ser: ["جنوب اروپا", "Southern Europe"], southam: ["آمریکای جنوبی", "South America"], ssa: ["آفریقای زیر صحرا", "Sub-Saharan Africa"],
  un: ["سازمان ملل", "United Nations"], waf: ["غرب آفریقا", "West Africa"], was: ["غرب آسیا", "Western Asia"],
  wer: ["غرب اروپا", "Western Europe"], ww: ["سراسر جهان", "Worldwide"],
};
export function sourceDisplayName(path: string, language: string): string {
  const country = /^world-iptv\/countries\/([a-z]{2})\.m3u8?$/i.exec(path);
  if (country?.[1]) return regionName(country[1], language);
  const name = path.split("/").at(-1) || path;
  const key = name.replace(/\.m3u8?$/i, "");
  const label = path.startsWith("world-iptv/regions/") ? regionLabels[key] :
    path === "world-iptv" || /^world-iptv\/[^/]+$/.test(path) ? folderNames[key] : undefined;
  if (label) return label[language === "fa" ? 0 : 1];
  if (path === "world-iptv/indexes/by-country.m3u") return language === "fa" ? "نمایه بر اساس کشور" : "By country";
  if (path === "world-iptv/indexes/by-category.m3u") return language === "fa" ? "نمایه بر اساس دسته‌بندی" : "By category";
  if (path === "world-iptv/indexes/by-language.m3u") return language === "fa" ? "نمایه بر اساس زبان" : "By language";
  if (path === "world-iptv/master/world.m3u") return language === "fa" ? "همه کشورهای جهان" : "World playlist";
  if (path === "world-iptv/special/international.m3u") return language === "fa" ? "شبکه‌های بین‌المللی" : "International channels";
  return name;
}
