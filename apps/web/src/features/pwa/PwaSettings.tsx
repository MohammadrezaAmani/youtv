import { useEffect, useState } from "react";
import { Download, RefreshCw, Smartphone, Check, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useYoutv } from "@/stores/useYoutv";
import {
  getPwaStatus,
  subscribePwa,
  installPwa,
  checkPwaUpdate,
  activatePwaUpdate,
} from "@/lib/pwa";

/** Install/update lives in Settings, never as an intrusive streaming overlay. */
export default function PwaSettings() {
  const fa = useYoutv((s) => s.settings.language) === "fa";
  const [status, setStatus] = useState(getPwaStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => subscribePwa(setStatus), []);
  const tryInstall = async () => {
    setBusy(true);
    setMessage("");
    try {
      const accepted = await installPwa();
      if (!accepted)
        setMessage(fa ? "نصب تأیید نشد." : "Installation was not confirmed.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const checkUpdate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const available = await checkPwaUpdate();
      setMessage(
        available
          ? fa
            ? "نسخه جدید آماده است."
            : "An update is ready."
          : fa
            ? "در حال حاضر نسخه جدیدی یافت نشد."
            : "No update is available right now.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="panel-card pwa-settings"
      role="region"
      aria-label="YouTV PWA"
    >
      <h3>
        <Smartphone size={20} />
        {fa ? "نصب برنامه روی دستگاه" : "Install YouTV"}
      </h3>
      {status.installed ? (
        <p className="muted pwa-state">
          <Check size={16} />
          {fa
            ? "برنامه در حالت نصب‌شده اجرا می‌شود."
            : "YouTV is running as an installed app."}
        </p>
      ) : status.installable ? (
        <Button onClick={() => void tryInstall()} disabled={busy}>
          <Download size={16} />
          {fa ? "نصب برنامه" : "Install app"}
        </Button>
      ) : status.ios ? (
        <p className="muted">
          {fa
            ? "در Safari، دکمه Share را بزن و Add to Home Screen را انتخاب کن. سپس برنامه را از آیکون صفحه اصلی اجرا کن."
            : "In Safari, tap Share → Add to Home Screen, then open YouTV from its Home Screen icon."}
        </p>
      ) : (
        <p className="muted">
          {fa
            ? "از منوی مرورگر گزینه Install App یا Add to Home Screen را انتخاب کن."
            : "Choose Install App or Add to Home Screen from your browser menu."}
        </p>
      )}
      {!status.supported && (
        <p className="muted">
          {fa
            ? "برای نصب PWA سایت باید روی HTTPS یا localhost اجرا شود."
            : "PWA installation requires HTTPS or localhost."}
        </p>
      )}
      {import.meta.env.DEV && (
        <p className="muted">
          {fa
            ? "Service Worker در حالت توسعه فعال نیست؛ برای تست نصب آفلاین از Build و Preview استفاده کن."
            : "Service Worker is disabled during development; test offline installation using Build and Preview."}
        </p>
      )}
      {status.offline && (
        <p className="muted pwa-state">
          <WifiOff size={16} />
          {fa
            ? "آفلاین: رابط ذخیره‌شده در دسترس است، اما پخش زنده اینترنت می‌خواهد."
            : "Offline: the cached interface works, but live TV requires a connection."}
        </p>
      )}
      {status.supported && (
        <div className="row-wrap">
          {status.updateAvailable ? (
            <Button onClick={activatePwaUpdate}>
              <RefreshCw size={16} />
              {fa ? "نصب نسخه جدید و بازگشایی" : "Apply update & reload"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => void checkUpdate()}
              disabled={busy || !status.registered}
            >
              <RefreshCw size={16} />
              {fa ? "بررسی به‌روزرسانی" : "Check for updates"}
            </Button>
          )}
        </div>
      )}
      {status.error && (
        <p className="pwa-error" role="alert">
          {status.error}
        </p>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      <p className="muted pwa-footnote">
        {fa
          ? "حالت آفلاین مخصوص رابط کاربری و شبکه‌های ذخیره‌شده است؛ ویدئوها، فایل‌های منابع و درخواست‌های Worker به‌صورت آفلاین ذخیره نمی‌شوند."
          : "Offline mode caches the interface, not video streams, IPTV source files or Worker traffic."}
      </p>
    </div>
  );
}
