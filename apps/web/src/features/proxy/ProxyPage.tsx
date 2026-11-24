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
  Settings2,
  BookOpen,
} from "lucide-react";
import { workerSchema } from "@youtv/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useYoutv } from "@/stores/useYoutv";
import { normalizeError } from "@/lib/utils";
import { normalizeWorkerBaseUrl, proxyUrl, workerEndpoint } from "@/lib/proxy";
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
  const fa = settings.language === "fa";
  const [section, setSection] = useState<"workers" | "routing" | "advanced">("workers");
  const sections = [
    { id: "workers", label: fa ? "Workerها" : "Workers", icon: Cloud },
    { id: "routing", label: fa ? "مسیریابی و fallback" : "Routing & fallback", icon: Settings2 },
    { id: "advanced", label: fa ? "استقرار و مدیریت Cloudflare" : "Deployment & Cloudflare", icon: BookOpen },
  ] as const;
  const [addOpen, setAddOpen] = useState(false);
  const [busyWorkers, setBusyWorkers] = useState<string[]>([]);
  const [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [withToken, setWithToken] = useState(false),
    [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [probeSource, setProbeSource] = useState("");
  const [probeWorkerId, setProbeWorkerId] = useState("");
  const [probingWorkerId, setProbingWorkerId] = useState("");
  const probeWorker = workers.find(w => w.id === probeWorkerId);
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
        baseUrl: normalizeWorkerBaseUrl(normalized.toString()),
        token: withToken ? token.trim() : "",
        enabled: true,
      });
      save(value);

      setName("");
      setUrl("");
      setToken("");
      setWithToken(false);
      setAddOpen(false);
    } catch (e) {
      setError(normalizeError(e));
    }
  };
  const editWorker = (id: string) => {
    const worker = workers.find((w) => w.id === id);
    if (!worker) return;
    setEditingWorker(id);
    setEditingToken("");
    setReplacementToken("");
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
        baseUrl: normalizeWorkerBaseUrl(target.toString()),
      });
      save(parsed);
      setEditingWorker("");
      setError("");
    } catch (err) {
      setError(normalizeError(err));
    }
  };
  const probe = async (worker: (typeof workers)[number]) => {
    setProbingWorkerId(worker.id);
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
    } finally {
      setProbingWorkerId("");
    }
  };
  const health = async (id: string, base: string) => {
    setBusyWorkers(current => [...current, id]);
    setResults((s) => ({ ...s, [id]: fa ? "در حال بررسی نسخه و قابلیت‌ها…" : "Checking version & capabilities…" }));
    try {
      const worker = workers.find((item) => item.id === id);
      if (!worker) throw new Error("Worker not found");
      const endpoint = workerEndpoint({ ...worker, baseUrl: base, token: "" }, "health");
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 7000);
      let result: Response;
      try {
        result = await fetch(endpoint, {
          signal: controller.signal,
          credentials: "omit",
        });
      } finally {
        clearTimeout(timer);
      }
      if (!result.ok) throw new Error(`Worker /health HTTP ${result.status}; check the Worker base URL and deployment`);
      const body: unknown = await result.json();
      if (
        !result.ok ||
        typeof body !== "object" ||
        body === null ||
        !("ok" in body) ||
        body.ok !== true
      )
        throw new Error("Health response invalid");
      const version = "version" in body && typeof body.version === "string" ? body.version : "?";
      const capabilityResponse = await fetch(workerEndpoint({ ...worker, token: "" }, "capabilities"), {
        signal: AbortSignal.timeout(7000), credentials: "omit", cache: "no-store",
      });
      if (!capabilityResponse.ok) throw new Error(`v${version} · /capabilities HTTP ${capabilityResponse.status}`);
      const caps = await capabilityResponse.json() as Record<string, unknown>;
      if (!caps || typeof caps !== "object" || Array.isArray(caps)) throw new Error(`v${version} · Invalid capabilities response`);
      const supported = ["youtubeRelay", "instagramPublicRelay", "attachmentDownload", "dash"].filter(key => caps[key] === true);
      const missing = supported.length !== 4;
      setResults((s) => ({ ...s, [id]: `v${version} · ${fa ? "سلامت: موفق" : "Health: OK"} · ${supported.length ? supported.join(", ") : (fa ? "فقط قابلیت‌های پایه" : "Basic capabilities only")}${missing ? (fa ? " · نیازمند به‌روزرسانی برای مرکز رسانه" : " · Update required for Media Center") : ""}${caps.authentication === "query-token" && !worker.token ? (fa ? " · توکن لازم است" : " · Token required") : ""}` }));
    } catch (e) {
      setResults((s) => ({
        ...s,
        [id]: `${t("testFail")} ${normalizeError(e)}`,
      }));
    } finally { setBusyWorkers(current => current.filter(value => value !== id)); }
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
      <nav className="preferences-nav" aria-label={t("proxy")}>
        {sections.map(({ id, label, icon: Icon }) => <Button key={id} size="sm" variant={section === id ? "secondary" : "ghost"} aria-pressed={section === id} onClick={() => setSection(id)}><Icon size={17} />{label}</Button>)}
      </nav>
      <div className="proxy-section" hidden={section !== "workers"}>
      <div className="panel-card worker-summary">
        <div className="worker-summary-main">
          <h3><Cloud size={20} />{fa ? "Workerهای من" : "My Workers"}</h3>
          <p className="muted">{workers.length} {fa ? "ثبت‌شده" : "registered"} · {workers.filter(w => w.enabled).length} {fa ? "فعال" : "enabled"}</p>
          <p className="muted">{fa ? "پیش‌فرض:" : "Default:"} {workers.find(w => w.id === settings.defaultWorkerId && w.enabled)?.name || "—"}</p>
        </div>
        <div className="row-wrap worker-summary-actions">
          <Button variant="outline" disabled={!workers.some(w => w.enabled) || busyWorkers.length > 0} onClick={async () => { for (const worker of workers.filter(w => w.enabled)) await health(worker.id, worker.baseUrl); }}><Activity size={16} />{fa ? "بررسی سلامت" : "Check health"}</Button>
          <Button onClick={() => { setError(""); setAddOpen(true); }}><Plus size={17} />{t("addWorker")}</Button>
        </div>
      </div>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogTitle className="modal-title">{t("addWorker")}</DialogTitle>
          <DialogDescription className="modal-subtitle">{fa ? "آدرس پایه Worker مستقرشده را وارد کن. توکن فقط در صورت فعال بودن PROXY_TOKEN لازم است." : "Enter the deployed Worker base URL. A token is only required when PROXY_TOKEN is configured."}</DialogDescription>
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
            <div className="modal-actions">
              <Button variant="outline" type="button" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
              <Button type="submit"><Plus size={17} />{t("addWorker")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(probeWorker)} onOpenChange={open => { if (!open) setProbeWorkerId(""); }}>
        <DialogContent>
          <DialogTitle className="modal-title">{fa ? "تست استریم" : "Test stream"}{probeWorker ? ` · ${probeWorker.name}` : ""}</DialogTitle>
          <DialogDescription className="modal-subtitle">{fa ? "آدرس اصلی رسانه را وارد کن تا پاسخ سرور مبدأ از همین Worker بررسی شود." : "Enter the original media URL to verify upstream access through this Worker."}</DialogDescription>
          <form className="form-stack" onSubmit={event => { event.preventDefault(); if (probeWorker && !probingWorkerId) void probe(probeWorker); }}>
            <label>
              {fa ? "آدرس اصلی رسانه" : "Original media URL"}
              <Input type="url" dir="ltr" required value={probeSource} onChange={event => setProbeSource(event.target.value)} placeholder="https://example.com/live.m3u8" />
            </label>
            {probeWorker && results[probeWorker.id] && <div className="info-box" role="status">{results[probeWorker.id]}</div>}
            <div className="modal-actions">
              <Button variant="outline" type="button" onClick={() => setProbeWorkerId("")}>{t("cancel")}</Button>
              <Button type="submit" disabled={!probeSource.trim() || Boolean(probingWorkerId)}><Activity size={16} />{fa ? "تست استریم" : "Test stream"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <div className="worker-list">
        {workers.length === 0 && (
          <div className="empty-subpanel">
            <Cloud size={25} />
            {t("notConfigured")}
            <Button size="sm" onClick={() => { setError(""); setAddOpen(true); }}><Plus size={16} />{t("addWorker")}</Button>
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
              {w.id === settings.defaultWorkerId && <span className="worker-default-label">{fa ? "پیش‌فرض" : "Default"}</span>}
            </div>
            <div className="row-wrap worker-actions">
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
                disabled={busyWorkers.includes(w.id)}
                onClick={() => void health(w.id, w.baseUrl)}
              >
                <Activity size={16} />
                {t("healthCheck")}
              </Button>
              <Button variant="outline" size="sm" disabled={!w.enabled || w.id === settings.defaultWorkerId} onClick={() => update({ defaultWorkerId: w.id })}>{fa ? "انتخاب پیش‌فرض" : "Set default"}</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(probingWorkerId)}
                onClick={() => { setProbeWorkerId(w.id); setResults(current => ({ ...current, [w.id]: "" })); }}
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
                  setEditingWorker("");
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
            {results[w.id] && <div className="info-box worker-check-result" role="status">{results[w.id]}</div>}
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
                  placeholder={fa ? "توکن جدید (خالی = حذف توکن)" : "Optional token (leave empty to clear)"}
                  value={replacementToken}
                  onChange={(e) => setReplacementToken(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    save({ ...w, token: replacementToken.trim() });
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
      </div>
      <div className="proxy-section" hidden={section !== "routing"}>
      <div className="panel-card">
        <h3>{t("defaultWorker")}</h3>
        <div className="settings-row">
          <label>
            {t("proxyMode")}
            <Select
              value={settings.proxyMode}
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
        <div className="panel-card form-stack">
          <h3>{fa ? "مسیر پیش‌فرض مرکز رسانه" : "Media Center default route"}</h3>
          <label>{fa ? "Worker مرکز رسانه" : "Media Worker"}
            <Select value={workers.some(w => w.enabled && w.id === settings.mediaWorkerId) ? settings.mediaWorkerId : ""} onChange={e => update({ mediaWorkerId: e.target.value })}>
              <SelectOption value="">{fa ? "پیروی از Worker پیش‌فرض" : "Follow default Worker"}</SelectOption>
              {workers.filter(w => w.enabled).map(w => <SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}
            </Select>
          </label>
          <label className="checkbox-row"><Checkbox checked={settings.mediaWorkerFallback} onChange={e => update({ mediaWorkerFallback: e.target.checked })} />{fa ? "جابه‌جایی خودکار بین Workerها" : "Automatic Worker fallback"}</label>
          <label className="checkbox-row"><Checkbox checked={settings.mediaDirectFallback} onChange={e => update({ mediaDirectFallback: e.target.checked })} />{fa ? "اجازه اتصال مستقیم در صورت شکست پروکسی" : "Allow direct fallback"}</label>
          <p className="muted">{fa ? "این تنظیمات با مرکز رسانه مشترک هستند و پس از Reload باقی می‌مانند." : "Shared with Media Center and retained after reload."}</p>
        </div>
      </div>
      <div className="proxy-section" hidden={section !== "advanced"}>
        <CloudflareGuide />
        <CloudflareManager />
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
    </section>
  );
}
