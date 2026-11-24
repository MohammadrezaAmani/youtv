import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = process.env.VITE_BASE_PATH;
if (!base || !base.startsWith("/") || !base.endsWith("/")) {
  throw new Error(`Invalid VITE_BASE_PATH: ${base}`);
}

const dist = resolve("apps/web/dist");
const html = readFileSync(resolve(dist, "index.html"), "utf8");
const manifest = JSON.parse(
  readFileSync(resolve(dist, "manifest.webmanifest"), "utf8"),
);
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value && !/^(?:https?:|data:|#)/i.test(value));

for (const reference of references) {
  const pathname = new URL(reference, `https://pages.invalid${base}`).pathname;
  if (!pathname.startsWith(base)) {
    throw new Error(
      `Asset escaped GitHub Pages base path: ${reference} -> ${pathname}`,
    );
  }
}

if (
  manifest.scope !== base ||
  manifest.id !== base ||
  typeof manifest.start_url !== "string" ||
  !manifest.start_url.startsWith(base)
) {
  throw new Error(`PWA manifest is not scoped to ${base}`);
}

for (const icon of manifest.icons ?? []) {
  if (typeof icon.src !== "string" || !icon.src.startsWith(base)) {
    throw new Error(`PWA icon escaped GitHub Pages base path: ${icon.src}`);
  }
}
for (const shortcut of manifest.shortcuts ?? []) {
  if (typeof shortcut.url !== "string" || !shortcut.url.startsWith(base)) {
    throw new Error(`PWA shortcut escaped GitHub Pages base path: ${shortcut.url}`);
  }
}

const serviceWorker = readFileSync(resolve(dist, "sw.js"), "utf8");
if (!serviceWorker.includes("new URL(path,self.registration.scope)")) {
  throw new Error(
    "Service worker assets are not resolved relative to its registration scope",
  );
}

console.log(
  `Verified ${references.length} HTML references and PWA manifest under ${base}`,
);
