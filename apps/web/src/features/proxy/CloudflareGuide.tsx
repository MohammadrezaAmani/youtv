import {useState} from 'react';
import {BookOpen,ChevronDown,Download,ExternalLink} from 'lucide-react';
import {ActionButton} from '@/components/ui/action-button';
import {useYoutv} from '@/stores/useYoutv';

export default function CloudflareGuide(){
  const language=useYoutv(s=>s.settings.language),fa=language==='fa';
  const [open,setOpen]=useState(false);
  return <section className="panel-card cloudflare-guide">
    <ActionButton className="cloudflare-guide-toggle" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><BookOpen size={21}/>
      <span><strong>{fa?'راهنمای Cloudflare':'Cloudflare guide'}</strong></span><ChevronDown size={19} className={open?'guide-open':''}/></ActionButton>
    {open&&<div className="cloudflare-steps">
      <div className="row-wrap">
        <a className="ui-button ui-button-outline ui-button-sm" href={`${import.meta.env.BASE_URL}dashboard-worker.mjs`} download><Download size={15}/>{fa?'دانلود dashboard-worker.mjs':'Download dashboard-worker.mjs'}</a>
        <a className="ui-button ui-button-outline ui-button-sm" href={`${import.meta.env.BASE_URL}wrangler.worker.jsonc`} download><Download size={15}/>{fa?'دانلود wrangler.worker.jsonc':'Download wrangler.worker.jsonc'}</a>
        <a className="ui-button ui-button-ghost ui-button-sm" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{fa?'داشبورد Cloudflare':'Cloudflare dashboard'}</a>
      </div>
      <div className="cloudflare-step"><span className="guide-number">1</span><div><h3>{fa?'ساخت Worker':'Create the Worker'}</h3><p>{fa?'داخل Workers & Pages یک Worker جدید بساز، محتوای dashboard-worker.mjs را Paste کن و Deploy بزن.':'Create a new Worker in Workers & Pages, paste dashboard-worker.mjs and deploy it.'}</p></div></div>
      <div className="cloudflare-step"><span className="guide-number">2</span><div><h3>{fa?'تنظیم Secret و Origin':'Set secrets and origin'}</h3><p>{fa?'در Settings → Variables and Secrets این‌ها را تنظیم کن: ALLOWED_HOSTS، ALLOWED_ORIGINS، PROXY_TOKEN، ADMIN_TOKEN.':'In Settings → Variables and Secrets configure ALLOWED_HOSTS, ALLOWED_ORIGINS, PROXY_TOKEN and ADMIN_TOKEN.'}</p></div></div>
      <div className="cloudflare-step"><span className="guide-number">3</span><div><h3>{fa?'اتصال به YouTV':'Connect it to YouTV'}</h3><p>{fa?'آدرس workers.dev و همان PROXY_TOKEN را در بخش افزودن Worker وارد کن و تست بگیر.':'Enter the workers.dev URL and the same PROXY_TOKEN in Add Worker, then run the test.'}</p></div></div>
      <div className="cloudflare-step"><span className="guide-number">4</span><div><h3>{fa?'مدیریت از مرورگر':'Browser management'}</h3><p>{fa?'اگر مدیریت از داخل فرانت می‌خواهی، Account ID و API Token مخصوص Cloudflare را در بخش مدیریت وارد کن.':'If you want in-browser management, enter the Cloudflare Account ID and API Token in the management section.'}</p></div></div>
    </div>}
  </section>;
}
