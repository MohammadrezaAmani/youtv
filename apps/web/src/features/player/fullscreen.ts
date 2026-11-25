/** Fullscreen feature detection for Safari, iOS WebKit and standard browsers.
 * iPhone Safari does not support fullscreen on a wrapping <div>; it exposes
 * native video fullscreen via webkitEnterFullscreen() instead.
 * Keep the first API call in the click handler's activation turn.
 */
type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};
type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
};

const viewportOverflow = new WeakMap<HTMLElement, string>();

export function exitViewportFullscreen(player: HTMLElement | null, doc: Document = document): boolean {
  if (!player || player.dataset?.youtvFullscreen !== "true") return false;
  delete player.dataset.youtvFullscreen;
  if (doc.body) doc.body.style.overflow = viewportOverflow.get(player) ?? "";
  viewportOverflow.delete(player);
  doc.dispatchEvent(new Event("youtvfullscreenchange"));
  return true;
}

function enterViewportFullscreen(player: HTMLElement, doc: Document): boolean {
  if (!player.dataset || !doc.body) return false;
  viewportOverflow.set(player, doc.body.style.overflow);
  doc.body.style.overflow = "hidden";
  player.dataset.youtvFullscreen = "true";
  doc.dispatchEvent(new Event("youtvfullscreenchange"));
  return true;
}

export function isElementFullscreen(doc: Document): boolean {
  const legacy = doc as WebkitFullscreenDocument;
  return Boolean(doc.fullscreenElement || legacy.webkitFullscreenElement);
}

export function isPlayerFullscreen(
  doc: Document,
  video: HTMLVideoElement | null,
): boolean {
  return (
    isElementFullscreen(doc) ||
    Boolean(doc.querySelector?.('[data-youtv-fullscreen="true"]')) ||
    Boolean((video as WebkitFullscreenVideo | null)?.webkitDisplayingFullscreen)
  );
}

export async function enterPlayerFullscreen(
  player: HTMLElement | null,
  video: HTMLVideoElement | null,
  doc: Document = document,
  allowNativeVideo = true,
): Promise<boolean> {
  if (!player || !video) return false;
  if (isPlayerFullscreen(doc, video)) return true;

  const legacyPlayer = player as WebkitFullscreenElement;
  const legacyVideo = video as WebkitFullscreenVideo;
  const nativeVideoSupported =
    allowNativeVideo && typeof legacyVideo.webkitEnterFullscreen === "function" &&
    legacyVideo.webkitSupportsFullscreen !== false;

  // On iPhone, a method may be present but fullscreenEnabled is false.
  // Calling the native video API synchronously preserves the user gesture.
  if (doc.fullscreenEnabled === false && nativeVideoSupported) {
    try {
      legacyVideo.webkitEnterFullscreen!();
      return true;
    } catch {
      /* try other APIs */
    }
  }

  if (
    doc.fullscreenEnabled !== false &&
    typeof player.requestFullscreen === "function"
  ) {
    try {
      await player.requestFullscreen();
      return true;
    } catch {
      /* Safari may reject element fullscreen */
    }
  }
  if (typeof legacyPlayer.webkitRequestFullscreen === "function") {
    try {
      await legacyPlayer.webkitRequestFullscreen();
      return true;
    } catch {
      /* fall back to native video */
    }
  }
  if (nativeVideoSupported) {
    try {
      legacyVideo.webkitEnterFullscreen!();
      return true;
    } catch {
      /* not allowed or not ready */
    }
  }
  return !allowNativeVideo && enterViewportFullscreen(player, doc);
}

export async function togglePlayerFullscreen(
  player: HTMLElement | null,
  video: HTMLVideoElement | null,
  doc: Document = document,
  allowNativeVideo = true,
): Promise<boolean> {
  if (!player || !video) return false;
  if (exitViewportFullscreen(player, doc)) return true;
  const legacyDoc = doc as WebkitFullscreenDocument;
  const legacyVideo = video as WebkitFullscreenVideo;
  if (doc.fullscreenElement || legacyDoc.webkitFullscreenElement) {
    if (typeof doc.exitFullscreen === "function") {
      try {
        await doc.exitFullscreen();
        return true;
      } catch {
        /* try WebKit prefix */
      }
    }
    if (typeof legacyDoc.webkitExitFullscreen === "function") {
      try {
        await legacyDoc.webkitExitFullscreen();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  if (legacyVideo.webkitDisplayingFullscreen) {
    if (typeof legacyVideo.webkitExitFullscreen !== "function") return false;
    try {
      legacyVideo.webkitExitFullscreen();
      return true;
    } catch {
      return false;
    }
  }
  return enterPlayerFullscreen(player, video, doc, allowNativeVideo);
}
