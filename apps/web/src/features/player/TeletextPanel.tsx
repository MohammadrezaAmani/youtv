import { ActionButton } from "@/components/ui/action-button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X, Info } from "lucide-react";
import type { WorkerProfile } from "@youtv/shared";
import { makeTeletextUrl } from "./mediaUtils";
import { resolveTextSource } from "@/lib/proxy";
import { useYoutv } from "@/stores/useYoutv";
import { useTranslation } from "react-i18next";

type Props = {
  template: string;
  worker?: WorkerProfile;
  usingProxy: boolean;
  onClose: () => void;
};
export function TeletextPanel({
  template,
  worker,
  usingProxy,
  onClose,
}: Props) {
  const [page, setPage] = useState(100);
  const [input, setInput] = useState("100");
  const [reload, setReload] = useState(0);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const settings = useYoutv((s) => s.settings),
    workers = useYoutv((s) => s.workers);
  const language = settings.language;
  const { t } = useTranslation();
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      setLoading(true);
      setError("");
      setBody("");
      try {
        const source = makeTeletextUrl(template, page);
        const url = resolveTextSource(
          source,
          settings,
          workers,
          worker?.id || "",
          usingProxy,
        ).url;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const contentType = response.headers.get("content-type") || "";
        let output = text;
        if (/json/i.test(contentType)) {
          const json = JSON.parse(text) as Record<string, unknown>;
          output = String(json.text ?? json.content ?? json.body ?? "");
        } else if (/html/i.test(contentType)) {
          const doc = new DOMParser().parseFromString(text, "text/html");
          for (const unsafe of doc.querySelectorAll("script,style,iframe"))
            unsafe.remove();
          output = doc.body.textContent || "";
        }
        if (!controller.signal.aborted) setBody(output);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void read();
    return () => controller.abort();
  }, [template, page, reload, usingProxy, worker, settings, workers]);
  const change = (n: number) => {
    if (n < 100 || n > 899) return;
    setPage(n);
    setInput(String(n));
  };
  return (
    <div className="ttx-panel" role="region" aria-label="Teletext" dir="ltr">
      <div className="ttx-top">
        <strong>
          TELETEXT <span>{page}</span>
        </strong>
        <ActionButton
          className="media-icon"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X size={18} />
        </ActionButton>
      </div>
      <div className="ttx-navigation">
        <ActionButton onClick={() => change(page - 1)} disabled={page === 100}>
          <ChevronLeft size={16} />
        </ActionButton>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change(Number(input));
          }}
        >
          <Input
            value={input}
            onChange={(e) =>
              setInput(e.target.value.replace(/\D/g, "").slice(0, 3))
            }
            inputMode="numeric"
            aria-label="Teletext page"
          />
          <ActionButton type="submit">GO</ActionButton>
        </form>
        <ActionButton onClick={() => change(page + 1)} disabled={page === 899}>
          <ChevronRight size={16} />
        </ActionButton>
        <ActionButton onClick={() => setReload((n) => n + 1)} title="Refresh">
          <RefreshCw size={16} />
        </ActionButton>
      </div>
      {template ? (
        <pre className="ttx-content" aria-live="polite">
          {loading
            ? "Loading…"
            : error
              ? `Error: ${error}`
              : body || "No content returned for this page."}
        </pre>
      ) : (
        <div className="ttx-unavailable">
          <Info size={22} />
          <p>
            {language === "fa"
              ? "این شبکه آدرس صفحه Teletext ندارد. داده خام DVB Teletext داخل MPEG-TS در مرورگر بدون استخراج‌کننده جداگانه قابل خواندن نیست."
              : "This channel has no Teletext page endpoint. Embedded DVB Teletext in MPEG-TS requires a dedicated decoder or upstream extraction."}
          </p>
        </div>
      )}
    </div>
  );
}
