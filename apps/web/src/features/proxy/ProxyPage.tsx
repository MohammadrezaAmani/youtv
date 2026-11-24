import { Select, SelectOption } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Cloud,
  Plus,
  Trash2,
  Activity,
  ShieldCheck,
  Pencil,
  X,
  Check,
} from "lucide-react";
import { workerSchema } from "@youtv/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useYoutv } from "@/stores/useYoutv";
import { normalizeError } from "@/lib/utils";
import { proxyUrl } from "@/lib/proxy";
import { ui } from "@/lib/labels";
import CloudflareManager from "./CloudflareManager";
import CloudflareGuide from "./CloudflareGuide";

export default function ProxyPage() {
  const { t } = useTranslation();
  const workers = useYoutv((s) => s.workers),
    settings = useYoutv((s) => s.settings),
    channels = useYoutv((s) => s.channels),
    save = useYoutv((s) => s.saveWorker),
    remove = useYoutv((s) => s.removeWorker),
    update = useYoutv((s) => s.updateSettings),
    bulkUpdate = useYoutv((s) => s.bulkUpdate);
  const [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [withToken, setWithToken] = useState(false),
    [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [probeSource, setProbeSource] = useState("");
  const customizedChannelIds = channels
    .filter(
      (channel) => channel.proxyMode !== "inherit" || Boolean(channel.workerId),
    )
    .map((channel) => channel.id);
  const [editingToken, setEditingToken] = useState<string>(""),
    [replacementToken, setReplacementToken] = useState("");
  const [editingWorker, setEditingWorker] = useState(""),
    [editName, setEditName] = useState(""),
    [editUrl, setEditUrl] = useState("");
  const add = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const normalized = new URL(url.trim());
      if (!["http:", "https:"].includes(normalized.protocol))
        throw new Error(t("invalidUrl"));
      if (
        normalized.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(normalized.hostname)
      )
        throw new Error(
          settings.language === "fa"
            ? "آدرس خود Worker باید HTTPS باشد؛ اما آدرس کانال‌ها و Playlistها می‌تواند HTTP باشد و از Worker عبور کند."
            : "The Worker endpoint must use HTTPS; channel streams and playlists may still use HTTP through that Worker.",
        );
      if (withToken && !token.trim())
        throw new Error(
          settings.language === "fa"
            ? "توکن این Worker را وارد کن یا گزینه توکن را غیرفعال کن."
            : "Enter this Worker’s token or turn off the token option.",
        );
      const value = workerSchema.parse({
        id: crypto.randomUUID(),
        name: name.trim(),
        baseUrl: normalized.toString(),
        token: withToken ? token.trim() : "",
        enabled: true,
      });
      save(value);
      if (!settings.defaultWorkerId) update({ defaultWorkerId: value.id });
      setName("");
      setUrl("");
      setToken("");
      setWithToken(false);
    } catch (e) {
      setError(normalizeError(e));
    }
  };
  const editWorker = (id: string) => {
    const worker = workers.find((w) => w.id === id);
    if (!worker) return;
    setEditingWorker(id);
    setEditName(worker.name);
    setEditUrl(worker.baseUrl);
    setError("");
  };
  const commitWorkerEdit = (id: string) => {
    const worker = workers.find((w) => w.id === id);
    if (!worker) return;
    try {
      const target = new URL(editUrl.trim());
      if (
        !["http:", "https:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        throw new Error(t("invalidUrl"));
      if (
        target.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(target.hostname)
      )
        throw new Error(
          settings.language === "fa"
            ? "آدرس خود Worker باید HTTPS باشد؛ اما آدرس کانال‌ها و Playlistها می‌تواند HTTP باشد و از Worker عبور کند."
            : "The Worker endpoint must use HTTPS; channel streams and playlists may still use HTTP through that Worker.",
        );
      const parsed = workerSchema.parse({
        ...worker,
        name: editName.trim(),
        baseUrl: target.toString(),
      });
      save(parsed);
      setEditingWorker("");
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };
  const probe = async (worker: (typeof workers)[number]) => {
    setResults((current) => ({
      ...current,
      [worker.id]:
        settings.language === "fa" ? "در حال تست استریم…" : "Testing stream…",
    }));
    try {
      const source = new URL(probeSource.trim());
      if (!["http:", "https:"].includes(source.protocol))
        throw new Error("Only HTTP(S) sources are supported");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 12000);
      let response: Response;
      try {
        response = await fetch(proxyUrl(source.toString(), worker, "probe"), {
          signal: controller.signal,
          credentials: "omit",
          cache: "no-store",
        });
      } finally {
        clearTimeout(timer);
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object")
        throw new Error(`Invalid Worker response (HTTP ${response.status})`);
      const data = body as {
        ok?: boolean;
        status?: number;
        code?: string;
        error?: string;
      };
      if (!response.ok) {
        const hint =
          data.code === "blocked_host"
            ? settings.language === "fa"
              ? "Cloudflare Worker آدرس‌های IP مستقیم و شبکه محلی را پشتیبانی نمی‌کند؛ برای منبع از نام دامنه عمومی استفاده کن."
              : "Cloudflare Worker fetch does not support direct IP sources or local hosts; use a public DNS hostname."
            : data.code === "host_not_allowed"
              ? settings.language === "fa"
                ? "ALLOWED_HOSTS را روی * بگذار یا کد Worker جدید را Deploy کن"
                : "Set ALLOWED_HOSTS to * or deploy the new Worker code"
              : data.code === "origin_not_allowed"
                ? settings.language === "fa"
                  ? "سایت پیش‌فرض https://mohammadrezaamani.github.io باید بدون تنظیم دستی مجاز باشد؛ کد Worker را به‌روزرسانی کن"
                  : "The default https://mohammadrezaamani.github.io origin should work automatically; update the Worker code"
                : data.code === "unauthorized"
                  ? settings.language === "fa"
                    ? "کلید ذخیره‌شده در YouTV با PROXY_TOKEN یکسان نیست"
                    : "YouTV token does not match PROXY_TOKEN"
                  : data.error || data.code || "Request failed";
        throw new Error(
          `Worker HTTP ${response.status} (${data.code || "error"}): ${hint}`,
        );
      }
      if (!data.ok)
        throw new Error(
          `Upstream HTTP ${data.status ?? "?"} — ${settings.language === "fa" ? "مبدأ استریم پاسخ موفق نداده" : "The stream origin did not respond successfully"}`,
        );
      setResults((current) => ({
        ...current,
        [worker.id]: `${settings.language === "fa" ? "استریم قابل دسترسی است" : "Stream reachable"} · HTTP ${data.status}`,
      }));
    } catch (e) {
      const message = normalizeError(e);
      const browserFailure =
        /failed to fetch|load failed|networkerror|network request failed/i.test(
          message,
        );
      const hint = browserFailure
        ? settings.language === "fa"
          ? "دسترسی مرورگر به Worker ممکن نیست؛ وضعیت استقرار Worker، اتصال و CORS را بررسی کن. Origin سایت به‌صورت پیش‌فرض مجاز است."
          : "The browser cannot access the Worker; verify its deployment, network and CORS. The YouTV site origin is allowed by default."
        : message;
      setResults((current) => ({
        ...current,
        [worker.id]: `${settings.language === "fa" ? "تست ناموفق" : "Stream test failed"}: ${hint}`,
      }));
    }
  };
  const health = async (id: string, base: string) => {
    setResults((s) => ({ ...s, [id]: "Checking…" }));
    try {
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 7000);
      const endpoint = new URL(
        "health",
        base.endsWith("/") ? base : base + "/",
      );
      let result: Response;
      try {
        result = await fetch(endpoint, {
          signal: controller.signal,
          credentials: "omit",
        });
      } finally {
        clearTimeout(timer);
      }
      const body: unknown = await result.json();
      if (
        !result.ok ||
        typeof body !== "object" ||
        body === null ||
        !("ok" in body) ||
        body.ok !== true
      )
        throw new Error("Health response invalid");
      setResults((s) => ({ ...s, [id]: t("testOk") }));
    } catch (e) {
      setResults((s) => ({
        ...s,
        [id]: `${t("testFail")} ${normalizeError(e)}`,
      }));
    }
  };
  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CLOUDFLARE WORKERS</div>
          <h1>
            <Cloud size={29} />
            {t("proxy")}
          </h1>
          <p>{t("proxyHelp")}</p>
        </div>
      </div>
      <CloudflareGuide />
      <div className="settings-grid">
        <div className="panel-card">
          <h3>
            <Plus size={20} />
            {t("addWorker")}
          </h3>
          <form className="form-stack" onSubmit={add}>
            <label>
              {t("workerName")}
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="My Worker"
              />
            </label>
            <label>
              {t("workerUrl")}
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                type="url"
                dir="ltr"
                required
                placeholder="https://your-worker.workers.dev/"
              />
            </label>
            <label className="checkbox-row">
              <Checkbox
                checked={withToken}
                onChange={(e) => {
                  setWithToken(e.target.checked);
                  if (!e.target.checked) setToken("");
                }}
              />
              {settings.language === "fa"
                ? "این Worker توکن دسترسی دارد (اختیاری)"
                : "This Worker uses an access token (optional)"}
            </label>
            {withToken && (
              <label>
                {t("accessToken")}
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  required
                  placeholder="PROXY_TOKEN"
                />
              </label>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
            <Button type="submit">
              <Plus size={17} />
              {t("addWorker")}
            </Button>
          </form>
        </div>
        <div className="panel-card">
          <h3>
            <ShieldCheck size={20} />
            {t("security")}
          </h3>
          <p className="muted">
            {settings.language === "fa"
              ? "این پروکسی فقط برای منابع مجاز استفاده شود. دامنه‌های عمومی با ALLOWED_HOSTS=* پذیرفته می‌شوند؛ توکن مدیریتی Cloudflare را هرگز در URL عمومی قرار نده."
              : "Use the Worker only for authorized sources. ALLOWED_HOSTS=* permits public domains; never place Cloudflare management credentials in public URLs."}
          </p>
          <div className="info-box">
            {settings.language === "fa"
              ? "ALLOWED_HOSTS پیش‌فرض * است. Origin اصلی https://mohammadrezaamani.github.io و localhost بدون نیاز به تنظیم ALLOWED_ORIGINS مجاز هستند. افزودن Worker بدون توکن، حالت پیش‌فرض است؛ فقط اگر PROXY_TOKEN را در Cloudflare ست کرده‌ای، گزینه توکن را روشن کن."
              : "ALLOWED_HOSTS defaults to *. https://mohammadrezaamani.github.io and localhost are allowed without configuring ALLOWED_ORIGINS. New Workers are token-free by default; enable the token option only if PROXY_TOKEN is set in Cloudflare."}
          </div>
        </div>
      </div>
      <div className="panel-card">
        <h3>{t("defaultWorker")}</h3>
        <div className="settings-row">
          <label>
            {t("proxyMode")}
            <Select
              value={settings.proxyMode}
              className="ui-input"
              onChange={(e) =>
                update({
                  proxyMode: e.target.value as "direct" | "proxy" | "auto",
                })
              }
            >
              <SelectOption value="direct">{t("direct")}</SelectOption>
              <SelectOption value="proxy">{t("viaProxy")}</SelectOption>
              <SelectOption value="auto">{t("automatic")}</SelectOption>
            </Select>
          </label>
          <label>
            {t("defaultWorker")}
            <Select
              className="ui-input"
              value={settings.defaultWorkerId}
              onChange={(e) => update({ defaultWorkerId: e.target.value })}
            >
              <SelectOption value="">—</SelectOption>
              {workers
                .filter((w) => w.enabled)
                .map((w) => (
                  <SelectOption value={w.id} key={w.id}>
                    {w.name}
                  </SelectOption>
                ))}
            </Select>
          </label>
        </div>
        <div className="row-wrap">
          <Button
            variant="outline"
            type="button"
            disabled={!customizedChannelIds.length}
            onClick={() => {
              const message =
                settings.language === "fa"
                  ? `تنظیم مسیر و Worker اختصاصی ${customizedChannelIds.length} کانال حذف شود تا همگی از تنظیمات پیش‌فرض پیروی کنند؟`
                  : `Reset route and Worker overrides for ${customizedChannelIds.length} channels so they all inherit the saved defaults?`;
              if (window.confirm(message))
                bulkUpdate(customizedChannelIds, {
                  proxyMode: "inherit",
                  workerId: "",
                });
            }}
          >
            {settings.language === "fa"
              ? "اعمال تنظیمات پیش‌فرض به همه کانال‌ها"
              : "Use saved defaults for all channels"}
          </Button>
          <span className="muted">
            {settings.language === "fa"
              ? `${customizedChannelIds.length} کانال دارای مسیر یا Worker اختصاصی`
              : `${customizedChannelIds.length} channels have custom routing`}
          </span>
        </div>
      </div>
      <CloudflareManager />
      <div className="panel-card form-stack">
        <h3>
          {settings.language === "fa"
            ? "تست آدرس استریم از طریق Worker"
            : "Test a stream URL through the Worker"}
        </h3>
        <label>
          {settings.language === "fa"
            ? "آدرس اصلی کانال (نه لینک /proxy)"
            : "Original channel URL (not the /proxy link)"}
          <Input
            type="url"
            dir="ltr"
            value={probeSource}
            onChange={(e) => setProbeSource(e.target.value)}
            placeholder="http://stream.example.com/live.m3u8"
          />
        </label>
        <p className="muted">
          {settings.language === "fa"
            ? "تست سلامت فقط /health را بررسی می‌کند و تأییدی بر دسترسی به استریم نیست. برای بررسی واقعی دامنه، توکن و پاسخ سرور اصلی، نشانی بالا را وارد و روی «تست استریم» کنار Worker کلیک کن."
            : "Health checks only /health; they do not verify the source allowlist, token or upstream. Enter an original stream URL and click Test stream for a Worker."}
        </p>
      </div>
      <div className="worker-list">
        {workers.length === 0 && (
          <div className="empty-subpanel">
            <Cloud size={25} />
            {t("notConfigured")}
          </div>
        )}
        {workers.map((w) => (
          <div key={w.id} className="worker-item">
            <div className="worker-icon">
              <Cloud size={23} />
            </div>
            <div className="worker-details">
              <b>{w.name}</b>
              <small dir="ltr">{w.baseUrl}</small>
              <small className="muted">
                {w.token
                  ? settings.language === "fa"
                    ? "توکن تنظیم شده"
                    : "Access token configured"
                  : settings.language === "fa"
                    ? "بدون توکن دسترسی"
                    : "No access token"}
              </small>
              <small className="muted">{results[w.id] || ""}</small>
            </div>
            <div className="row-wrap">
              <label className="checkbox-row">
                <Checkbox
                  checked={w.enabled}
                  onChange={(e) => save({ ...w, enabled: e.target.checked })}
                />
                {t("active")}
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void health(w.id, w.baseUrl)}
              >
                <Activity size={16} />
                {t("healthCheck")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!probeSource.trim()}
                onClick={() => void probe(w)}
              >
                {settings.language === "fa" ? "تست استریم" : "Test stream"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => editWorker(w.id)}
              >
                <Pencil size={15} />
                {t("edit")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingToken(editingToken === w.id ? "" : w.id);
                  setReplacementToken("");
                }}
              >
                {ui("changeToken", settings.language)}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (confirm(t("deleteConfirm"))) remove(w.id);
                }}
                aria-label={t("delete")}
              >
                <Trash2 size={18} />
              </Button>
            </div>
            {editingWorker === w.id && (
              <div className="worker-editor">
                <label>
                  {t("workerName")}
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </label>
                <label>
                  {t("workerUrl")}
                  <Input
                    dir="ltr"
                    type="url"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    required
                  />
                </label>
                <div className="row-wrap">
                  <Button size="sm" onClick={() => commitWorkerEdit(w.id)}>
                    <Check size={15} />
                    {t("save")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingWorker("")}
                  >
                    <X size={15} />
                    {t("cancel")}
                  </Button>
                </div>
                {error && <div className="error-message">{error}</div>}
              </div>
            )}
            {editingToken === w.id && (
              <div className="worker-token-edit">
                <Input
                  type="password"
                  dir="ltr"
                  placeholder="Optional token (leave empty to clear)"
                  value={replacementToken}
                  onChange={(e) => setReplacementToken(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    save({ ...w, token: replacementToken });
                    setEditingToken("");
                    setReplacementToken("");
                  }}
                >
                  {ui("saveToken", settings.language)}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
