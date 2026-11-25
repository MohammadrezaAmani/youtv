/** Installed PWA lifecycle. No auto-reloads during live streams or recordings. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};
export type PwaStatus = {
  supported: boolean;
  installed: boolean;
  ios: boolean;
  installable: boolean;
  updateAvailable: boolean;
  offline: boolean;
  registered: boolean;
  error: string;
};

let promptEvent: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let reloadAfterUpdate = false;
let initialized = false;
let status: PwaStatus = {
  supported: false,
  installed: false,
  ios: false,
  installable: false,
  updateAvailable: false,
  offline: false,
  registered: false,
  error: "",
};
const listeners = new Set<(value: PwaStatus) => void>();

function installed(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
function publish(patch: Partial<PwaStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}
export function getPwaStatus(): PwaStatus {
  return status;
}
export function subscribePwa(listener: (value: PwaStatus) => void) {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

export function initPwa() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  publish({
    supported: "serviceWorker" in navigator && window.isSecureContext,
    installed: installed(),
    ios:
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
    offline: !navigator.onLine,
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    publish({ installable: true });
  });
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    publish({ installed: true, installable: false });
  });
  window.addEventListener("online", () => publish({ offline: false }));
  window.addEventListener("offline", () => publish({ offline: true }));
  if (!status.supported) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadAfterUpdate) {
      reloadAfterUpdate = false;
      window.location.reload();
    } else publish({ registered: true });
  });
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}${import.meta.env.DEV ? "image-cache-sw.js" : "sw.js"}`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none",
    })
    .then((reg) => {
      registration = reg;
      const check = () =>
        publish({
          updateAvailable:
            !!reg.waiting && !!navigator.serviceWorker.controller,
        });
      publish({ registered: true, error: "" });
      check();
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", check);
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
          void reg.update().catch(() => undefined);
          publish({ installed: installed() });
        }
      });
    })
    .catch((err) =>
      publish({ error: err instanceof Error ? err.message : String(err) }),
    );
}

export async function installPwa(): Promise<boolean> {
  if (!promptEvent) return false;
  const request = promptEvent;
  promptEvent = null;
  publish({ installable: false });
  await request.prompt();
  const result = await request.userChoice;
  return result.outcome === "accepted";
}
export async function checkPwaUpdate(): Promise<boolean> {
  if (!registration) return false;
  await registration.update();
  publish({
    updateAvailable:
      !!registration.waiting && !!navigator.serviceWorker.controller,
  });
  return !!registration.waiting;
}
export function activatePwaUpdate() {
  const worker = registration?.waiting;
  if (!worker) return false;
  reloadAfterUpdate = true;
  worker.postMessage({ type: "SKIP_WAITING" });
  return true;
}
