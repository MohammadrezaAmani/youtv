import { describe, it, expect } from "vitest";
import { pwaManifest, pwaServiceWorker } from "../../pwaBuild";

describe("installable, scoped PWA configuration", () => {
  it("keeps GitHub Pages routing inside the project subdirectory", () => {
    const manifest = pwaManifest("/my-repository/");
    expect(manifest.id).toBe("/my-repository/");
    expect(manifest.start_url).toBe("/my-repository/#/");
    expect(manifest.scope).toBe("/my-repository/");
    expect(
      manifest.icons.every((icon) => icon.src.startsWith("/my-repository/")),
    ).toBe(true);
    expect(
      manifest.shortcuts.every((shortcut) =>
        shortcut.url.startsWith("/my-repository/"),
      ),
    ).toBe(true);
    expect(manifest.display).toBe("standalone");
    expect(
      manifest.icons.some(
        (icon) => icon.purpose === "maskable" && icon.sizes === "512x512",
      ),
    ).toBe(true);
  });
  it("precaches only the build JS/CSS/icons and never channel sources or streams", () => {
    const code = pwaServiceWorker(
      "/my-repository/",
      ["assets/index-A.js", "assets/index-B.css"],
      "release-1",
    );
    expect(code).toContain("new URL(path,self.registration.scope)");
    expect(code).toContain("assets/index-A.js");
    expect(code).toContain("assets/index-B.css");
    expect(code).not.toContain("default.m3u8");
    expect(code).not.toContain("sources/index.json");
    expect(code).toContain("if(request.method!=='GET')return;");
    expect(code).toContain(
      "if(request.headers.has('range')||url.search||!STATIC.has(url.href))return;",
    );
    expect(code).toContain("if(request.mode==='navigate')");
  });
  it("versions caches within one deployment scope and requires permission to activate a waiting update", () => {
    const first = pwaServiceWorker("/one/", ["assets/app-a.js"], "first");
    const second = pwaServiceWorker("/two/", ["assets/app-a.js"], "first");
    expect(first).toContain("youtv-pwa-_one_-first");
    expect(second).toContain("youtv-pwa-_two_-first");
    expect(first).toContain("event.data.type==='SKIP_WAITING'");
    expect(first).not.toContain(
      "self.skipWaiting();\n});\nself.addEventListener('activate'",
    );
  });
});

it("development caches public assets without capturing HMR or app code", async () => {
 const {devAssetServiceWorker}=await import('../../pwaBuild');
 const code=devAssetServiceWorker('/test/');
 expect(code).toContain('publicImageRequest(event.request');
 expect(code).not.toContain('cache.addAll');
 expect(code).not.toContain("request.mode==='navigate'");
 expect(code).toContain('youtv-pwa-_test_-images-v1');
});
