/** Media helpers are deliberately framework-independent and tested. */
export function srtToVtt(srt: string): string {
  const normalized = srt
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const lines = normalized.split("\n");
  const converted = lines.map((line) =>
    line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"),
  );
  return "WEBVTT\n\n" + converted.join("\n") + "\n";
}
export function secondsToClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const n = Math.floor(seconds);
  const s = String(n % 60).padStart(2, "0");
  const m = String(Math.floor(n / 60) % 60).padStart(2, "0");
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${m}:${s}`
    : `${Math.floor(n / 60)}:${s}`;
}
export function makeTeletextUrl(template: string, page: number): string {
  if (!Number.isInteger(page) || page < 100 || page > 899)
    throw new Error("Invalid Teletext page");
  if (!template.includes("{page}"))
    throw new Error("Teletext URL must contain {page}");
  const url = new URL(template.replaceAll("{page}", String(page)));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid Teletext endpoint");
  return url.toString();
}
export function isProbablyHls(url: string, format: "auto" | "hls" | "video") {
  return (
    format === "hls" || (format === "auto" && /\.m3u8?(?:[?#]|$)/i.test(url))
  );
}
