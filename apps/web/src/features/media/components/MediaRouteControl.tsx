import { useId } from "react";
import { Settings2, Cloud, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useYoutv } from "@/stores/useYoutv";
import "./media-route.css";

export default function MediaRouteControl({ disabled = false, onChange, status, manage = true }: {
  disabled?: boolean; onChange?: () => void; status?: string; manage?: boolean;
}) {
  const settings = useYoutv(s => s.settings), workers = useYoutv(s => s.workers), update = useYoutv(s => s.updateSettings);
  const fa = settings.language === "fa", id = useId();
  const direct = settings.mediaRouteMode === "direct";
  const selected = direct ? "direct" : workers.some(w => w.enabled && w.id === settings.mediaWorkerId) ? `worker:${settings.mediaWorkerId}` : "default";
  const change = (value: string) => {
    update(value === "direct" ? { mediaRouteMode: "direct" } : { mediaRouteMode: "proxy", mediaWorkerId: value === "default" ? "" : value.slice(7) });
    onChange?.();
  };
  return <div className="media-route-bar">
    <label htmlFor={id} className="media-route-label">{direct ? <Globe size={16} /> : <Cloud size={16} />}{fa ? "مسیر اتصال" : "Connection"}</label>
    <Select id={id} value={selected} disabled={disabled} onChange={e => change(e.target.value)}>
      <SelectOption value="direct">{fa ? "مستقیم · بدون پروکسی" : "Direct · no proxy"}</SelectOption>
      <SelectOption value="default">{fa ? "پروکسی پیش‌فرض" : "Default proxy"}</SelectOption>
      {workers.filter(w => w.enabled).map(w => <SelectOption key={w.id} value={`worker:${w.id}`}>{w.name}</SelectOption>)}
    </Select>
    <Dialog>
      <DialogTrigger asChild><Button size="icon" variant="outline" disabled={disabled} aria-label={fa ? "تنظیمات اتصال" : "Connection settings"} title={fa ? "تنظیمات اتصال" : "Connection settings"}><Settings2 size={18} /></Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>{fa ? "تنظیمات اتصال رسانه" : "Media connection settings"}</DialogTitle>
        <DialogDescription>{fa ? "انتخاب مسیر برای پخش، دانلود و تصاویر ذخیره می‌شود." : "The selected route is saved for playback, downloads and images."}</DialogDescription>
        <div className="form-stack media-route-dialog-fields">
          <label className="checkbox-row"><Checkbox disabled={direct || disabled} checked={settings.mediaWorkerFallback} onChange={e => { update({ mediaWorkerFallback: e.target.checked }); onChange?.(); }} />{fa ? "تلاش با Workerهای دیگر" : "Try other Workers"}</label>
          <label className="checkbox-row"><Checkbox disabled={direct || disabled} checked={settings.mediaDirectFallback} onChange={e => { update({ mediaDirectFallback: e.target.checked }); onChange?.(); }} />{fa ? "اجازه اتصال مستقیم در صورت شکست Worker" : "Allow direct fallback if Workers fail"}</label>
          {direct && <p className="muted">{fa ? "در حالت مستقیم هیچ Worker استفاده نمی‌شود." : "Direct mode never uses a Worker."}</p>}
          {manage && <Button asChild variant="outline"><Link to="/proxy">{fa ? "مدیریت Workerها" : "Manage Workers"}</Link></Button>}
        </div>
      </DialogContent>
    </Dialog>
    {status && <span className="media-route-status" role="status">{status}</span>}
  </div>;
}
