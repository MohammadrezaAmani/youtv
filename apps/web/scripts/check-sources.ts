import { scanLocalSources } from "../sourceCatalog";

const entries = await scanLocalSources();
const playlist = entries.filter((item) => item.kind === "playlist");
console.log(
  `Source files: ${entries.length} | IPTV playlists: ${playlist.length} | channel entries: ${playlist.reduce((count, item) => count + item.channelCount, 0)}`,
);
for (const entry of entries)
  console.log(
    `${entry.kind.padEnd(9)}  ${String(entry.channelCount).padStart(6)}  ${entry.path}`,
  );
if (entries.length === 0) {
  console.log(
    "Place .m3u and .m3u8 files in apps/web/public/sources/, then open Playlists → Folder sources.",
  );
}
console.log("ZIP files are not scanned. Expand ZIP archives first.");
