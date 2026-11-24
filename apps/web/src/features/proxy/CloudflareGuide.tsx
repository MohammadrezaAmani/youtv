import {useState} from 'react';
import {BookOpen,ChevronDown,Check,ClipboardCopy,Download,ExternalLink} from 'lucide-react';
import {ActionButton} from '@/components/ui/action-button';
import {useYoutv} from '@/stores/useYoutv';

type CopyState='idle'|'loading'|'copied'|'error';
const WORKER_RELEASE='0.33.1';
const scriptUrl=()=>`${import.meta.env.BASE_URL}dashboard-worker.mjs?v=${WORKER_RELEASE}`;

export default function CloudflareGuide(){
  const language=useYoutv(s=>s.settings.language),fa=language==='fa';
  const [open,setOpen]=useState(true);
  const [copyState,setCopyState]=useState<CopyState>('idle');

  const copyCode=async()=>{
    if(copyState==='loading')return;
    setCopyState('loading');
    try{
      const response=await fetch(scriptUrl(),{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const code=await response.text();
      if(code.length>250_000||!/(?:\bexport\s+default\b|\bas\s+default\b)/.test(code)||!code.startsWith(`// YouTV Worker bundle version: v${WORKER_RELEASE}\n`))throw new Error('Invalid or outdated Worker script');
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(code);
      setCopyState('copied');
    }catch{
      setCopyState('error');
    }
  };

  return <section className="panel-card cloudflare-guide">
    <ActionButton className="cloudflare-guide-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <BookOpen size={20}/>
      <span><strong>{fa?'راه‌اندازی Worker در Cloudflare':'Deploy Worker in Cloudflare'}</strong></span>
      <ChevronDown size={18} className={open?'guide-open':''}/>
    </ActionButton>
    {open&&<div className="cloudflare-steps">
      <div className="row-wrap">
        <ActionButton className="ui-button ui-button-primary ui-button-sm" onClick={()=>void copyCode()} disabled={copyState==='loading'}>
          {copyState==='copied'?<Check size={16}/>:<ClipboardCopy size={16}/>}
          {copyState==='loading'?(fa?'در حال خواندن...':'Loading...'):copyState==='copied'?(fa?'کد کپی شد':'Code copied'):(fa?'کپی کد Worker':'Copy Worker code')}
        </ActionButton>
        <a className="ui-button ui-button-outline ui-button-sm" href={scriptUrl()} download={`YouTV-Worker-v${WORKER_RELEASE}.mjs`}><Download size={15}/>{fa?'دانلود کد':'Download code'}</a>
        <a className="ui-button ui-button-ghost ui-button-sm" href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{fa?'بازکردن Cloudflare':'Cloudflare dashboard'}</a>
      </div>
      {copyState==='error'&&<p role="alert" className="error-message">{fa?'کپی مستقیم انجام نشد؛ فایل را دانلود کن، در ویرایشگر متنی باز کن و محتوایش را کپی کن.':'Copy failed. Download the script and copy its content from a text editor.'}</p>}
      <div className="cloudflare-step"><span className="guide-number">1</span><div>
        <h3>{fa?'ساخت Worker جدید':'Create a new Worker'}</h3>
        <p>{fa?'Workers & Pages → Create application → Create Worker یا Hello World → Deploy. گزینه Upload and deploy را انتخاب نکن.':'Workers & Pages → Create application → Create Worker / Hello World → Deploy. Do not use Upload and deploy.'}</p>
      </div></div>
      <div className="cloudflare-step"><span className="guide-number">2</span><div>
        <h3>{fa?'جایگزینی کد در ویرایشگر':'Replace the code in the editor'}</h3>
        <p>{fa?'Worker ساخته‌شده را باز کن → Edit code → فایل index.js را باز کن → محتوای فعلی را کامل پاک کن → کد کپی‌شده را Paste کن → Deploy. فایل .mjs را در بخش آپلود استاتیک بارگذاری نکن.':'Open the deployed Worker → Edit code → index.js → replace the existing code with the copied script → Deploy. Do not upload the .mjs file as a static asset.'}</p>
      </div></div>
      <div className="cloudflare-step"><span className="guide-number">3</span><div>
        <h3>{fa?'تنظیم Variables و Secrets':'Configure variables and secrets'}</h3>
        <p>{fa?'ALLOWED_HOSTS به‌صورت پیش‌فرض * است؛ بنابراین برای هر کانال نیازی به ثبت دامنه نیست. Origin سایت https://mohammadrezaamani.github.io و localhost با تمام پورت‌ها به‌صورت پیش‌فرض مجازند. ALLOWED_ORIGINS برای افزودن سایت‌های دیگر اختیاری است. PROXY_TOKEN اختیاری است: اگر تنظیمش کنی، همه درخواست‌ها باید کلید یکسان داشته باشند. Worker بدون توکن به‌صورت عمومی قابل استفاده است.':'ALLOWED_HOSTS defaults to *, allowing public streaming domains without per-host setup. https://mohammadrezaamani.github.io and localhost on any port are allowed browser origins by default. ALLOWED_ORIGINS optionally adds more sites. PROXY_TOKEN is optional; when set, every request must provide the matching key. Without a token, the Worker is publicly accessible.'}</p>
      </div></div>
      <div className="cloudflare-step"><span className="guide-number">4</span><div>
        <h3>{fa?'اتصال YouTV':'Connect YouTV'}</h3>
        <p>{fa?'آدرس workers.dev را وارد کن. گزینه «این Worker توکن دسترسی دارد» در حالت پیش‌فرض خاموش است؛ فقط اگر PROXY_TOKEN را در Cloudflare تعریف کرده‌ای روشنش کن و توکن را وارد کن. تست سلامت فقط در دسترس‌بودن Worker را بررسی می‌کند؛ برای آزمودن ALLOWED_HOSTS و پاسخ واقعی منبع، از «تست آدرس استریم» در مدیریت پروکسی استفاده کن.':'Enter the workers.dev URL; the access-token option is OFF by default. Enable it only if you set PROXY_TOKEN in Cloudflare. Health check only verifies the Worker responds. Use the stream URL test in Proxy Manager to verify ALLOWED_HOSTS and actual upstream access.'}</p>
        <a href="https://developers.cloudflare.com/learning-paths/workers/get-started/first-worker/" target="_blank" rel="noopener noreferrer">{fa?'مستندات رسمی Cloudflare':'Official Cloudflare instructions'} <ExternalLink size={14}/></a>
      </div></div>
    </div>}
  </section>;
}
