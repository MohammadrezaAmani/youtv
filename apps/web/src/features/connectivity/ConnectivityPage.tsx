import {Select,SelectOption} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {SearchBox} from '@/components/ui/search-box';
import {ProgressBar} from '@/components/ui/progress';
import {ActionButton} from '@/components/ui/action-button';
import {useEffect,useMemo,useState} from 'react';
import {Activity,ArrowRight,ArrowLeft,CheckCircle2,HelpCircle,RefreshCw,StopCircle,WifiOff,Radio,FolderOpen,Clock3,SlidersHorizontal} from 'lucide-react';
import type {Channel} from '@youtv/shared';
import {useYoutv} from '@/stores/useYoutv';
import {isVisibleChannel} from '@/lib/builtin';
import {facets,searchNormalize} from '@/lib/library';
import {getScanSnapshot,startScan,stopScan,subscribeScan} from '@/lib/scanManager';
import {Button} from '@/components/ui/button';

type Status='all'|'online'|'offline'|'unknown'|'untested';
const PAGE_SIZE=100;
export default function ConnectivityPage({onWatch,onGroup}:{onWatch:(id:string)=>void;onGroup:(group:string)=>void}){
  const all=useYoutv(s=>s.channels),settings=useYoutv(s=>s.settings),workers=useYoutv(s=>s.workers);
  const health=useYoutv(s=>s.health),save=useYoutv(s=>s.setHealth),clear=useYoutv(s=>s.clearHealth);
  const fa=settings.language==='fa';
  const [scan,setScan]=useState(getScanSnapshot);
  const [query,setQuery]=useState(''),[group,setGroup]=useState(''),[tag,setTag]=useState(''),[source,setSource]=useState(''),[status,setStatus]=useState<Status>('all');
  const [page,setPage]=useState(1);
  useEffect(()=>subscribeScan(setScan),[]);
  const channels=useMemo(()=>all.filter(c=>isVisibleChannel(c,settings)),[all,settings.defaultPlaylistEnabled]);
  const options=useMemo(()=>facets(channels),[channels]);
  const filtered=useMemo(()=>channels.filter(c=>(!group||c.group===group)&&(!tag||c.tags.includes(tag))&&(!source||(source==='__personal'?!c.sourceId:c.sourceId===source))&&(!query||searchNormalize([c.name,c.group,c.country,c.language,...c.tags].join(' ')).includes(searchNormalize(query)))&&(
    status==='all'||(status==='untested'?!health[c.id]:(health[c.id]?.status??'unknown')===status)
  )),[channels,group,tag,source,query,status,health]);
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const currentPage=Math.min(page,pages);
  const shown=filtered.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  const summary=useMemo(()=>channels.reduce((acc,c)=>{const key=health[c.id]?.status??'untested';acc[key]++;return acc;},{online:0,offline:0,unknown:0,untested:0}),[channels,health]);
  const setFilteredStatus=(value:Status)=>{setStatus(value);setPage(1);};
  const start=()=>startScan(filtered,settings,workers,save);
  const reset=()=>{setQuery('');setGroup('');setTag('');setSource('');setFilteredStatus('all');};
  const canScan=filtered.length>0&&!scan.running;
  return <section className="page-content diagnostics-page">
    <header className="diagnostics-heading"><div><div className="eyebrow">{fa?'پایش وضعیت شبکه‌ها':'CHANNEL MONITOR'}</div><h1><Activity size={27}/>{fa?'تست سیگنال و دسترسی':'Signal & connectivity'}</h1>
      <p>{fa?'بررسی دسترسی HTTP/HLS برای همه شبکه‌ها یا فقط گروه انتخابی؛ نتیجه‌ها در کارت‌های کتابخانه نیز دیده می‌شوند.':'HTTP/HLS availability across all channels or any selected group. Results also appear in the channel library.'}</p></div>
      <div className="diagnostics-heading-actions"><Button disabled={!canScan} onClick={start}><RefreshCw size={17}/>{fa?'تست موارد فیلترشده':'Scan filtered'} ({filtered.length.toLocaleString()})</Button><Button disabled={!scan.running} variant="outline" onClick={stopScan}><StopCircle size={16}/>{fa?'توقف':'Stop'}</Button></div>
    </header>
    <div className="diagnostics-summary-grid" aria-label={fa?'خلاصه تست':'Scan summary'}>
      {([{value:'all',count:channels.length,label:fa?'همه شبکه‌ها':'All channels',icon:Radio},{value:'online',count:summary.online,label:fa?'متصل':'Online',icon:CheckCircle2},{value:'offline',count:summary.offline,label:fa?'قطع':'Offline',icon:WifiOff},{value:'unknown',count:summary.unknown,label:fa?'نامشخص':'Unknown',icon:HelpCircle},{value:'untested',count:summary.untested,label:fa?'تست‌نشده':'Untested',icon:Clock3}] as const).map(item=><ActionButton key={item.value} className={`diagnostics-summary-card state-${item.value} ${status===item.value?'is-selected':''}`} aria-pressed={status===item.value} onClick={()=>setFilteredStatus(item.value)}><item.icon size={21}/><b>{item.count.toLocaleString()}</b><span>{item.label}</span></ActionButton>)}
    </div>
    <div className="panel-card diagnostics-filter-panel"><div className="diagnostics-filter-title"><h2><SlidersHorizontal size={18}/>{fa?'انتخاب شبکه‌ها برای بررسی':'Select channels to scan'}</h2><ActionButton onClick={reset}>{fa?'پاک‌کردن فیلترها':'Clear filters'}</ActionButton></div>
      <div className="diagnostics-filter-grid">
        <label><span>{fa?'جست‌وجوی شبکه':'Search channels'}</span><SearchBox className="diagnostics-search" size="compact" value={query} onChange={value=>{setQuery(value);setPage(1);}} placeholder={fa?'نام، گروه، کشور یا تگ…':'Name, group, country, tag…'} ariaLabel={fa?'جست‌وجوی شبکه':'Search channels'}/></label>
        <label><span>{fa?'گروه':'Group'}</span><Select value={group} onChange={e=>{setGroup(e.target.value);setPage(1);}}><SelectOption value="">{fa?'تمام گروه‌ها':'All groups'}</SelectOption>{options.groups.map(g=><SelectOption key={g} value={g}>{g}</SelectOption>)}</Select></label>
        <label><span>{fa?'تگ':'Tag'}</span><Select value={tag} onChange={e=>{setTag(e.target.value);setPage(1);}}><SelectOption value="">{fa?'تمام تگ‌ها':'All tags'}</SelectOption>{options.tags.map(t=><SelectOption key={t} value={t}>{t}</SelectOption>)}</Select></label>
        <label><span>{fa?'منبع':'Source'}</span><Select value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><SelectOption value="">{fa?'تمام منابع':'All sources'}</SelectOption>{options.sources.map(s=><SelectOption key={s} value={s}>{s==='__personal'?(fa?'شخصی':'Personal'):s}</SelectOption>)}</Select></label>
      </div>
      <div className="diagnostics-options"><label className="checkbox-row"><Checkbox checked={settings.healthCheckOnStartup} onChange={e=>useYoutv.getState().updateSettings({healthCheckOnStartup:e.target.checked})}/>{fa?'تست خودکار هنگام ورود':'Scan on startup'}</label><span>{fa?'تست HTTP جایگزین پینگ ICMP نیست؛ محدودیت CORS می‌تواند نتیجه را نامشخص کند.':'HTTP is not ICMP; browser CORS can make a result inconclusive.'}</span></div>
      {(scan.running||scan.progress.total>0)&&<div className="diagnostics-progress"><ProgressBar value={scan.progress.completed} max={scan.progress.total||1}/><span>{scan.progress.completed.toLocaleString()} / {scan.progress.total.toLocaleString()} · {scan.running?(fa?'در حال بررسی':'Scanning'):(fa?'پایان اسکن':'Finished')}</span></div>}
      {scan.error&&<div role="alert" className="error-message">{scan.error}</div>}
    </div>
    <div className="panel-card diagnostics-results"><div className="diagnostics-results-head"><h2>{fa?'نتایج شبکه‌ها':'Channel results'} <span>{filtered.length.toLocaleString()}</span></h2><div className="diagnostics-results-actions"><Button size="sm" variant="outline" onClick={()=>{if(confirm(fa?'نتایج ذخیره‌شده پاک شود؟':'Clear saved results?'))clear();}}>{fa?'حذف نتایج':'Clear saved results'}</Button></div></div>
      <div className="diagnostics-table-header"><span>{fa?'شبکه':'Channel'}</span><span>{fa?'دسته':'Group'}</span><span>{fa?'وضعیت':'Status'}</span><span>{fa?'پاسخ':'Response'}</span><span>{fa?'عملیات':'Action'}</span></div>
      <div className="diagnostics-results-list">{shown.map((c:Channel)=>{const result=health[c.id];const state=result?.status??'untested';return <div className="diagnostics-result" key={c.id}>
        <ActionButton className="diagnostics-channel" onClick={()=>onWatch(c.id)}><span className="diagnostics-logo">{c.logo?<img src={c.logo} alt="" loading="lazy"/>:<Radio size={20}/>}</span><strong title={c.name}>{c.name}</strong></ActionButton>
        <ActionButton className="diagnostics-group" onClick={()=>onGroup(c.group||'__ungrouped__')} title={c.group||'—'}><FolderOpen size={15}/>{c.group||'—'}</ActionButton>
        <span className={`diagnostics-state state-${state}`}><i/>{state==='online'?(fa?'متصل':'Online'):state==='offline'?(fa?'قطع':'Offline'):state==='unknown'?(fa?'نامشخص':'Unknown'):(fa?'تست‌نشده':'Untested')}</span>
        <span className="diagnostics-response" title={result?.detail||''}>{result?`${result.elapsedMs}ms · ${result.httpStatus??result.mode}`:'—'}</span>
        <ActionButton className="diagnostics-play" onClick={()=>onWatch(c.id)}>{fa?'تماشا':'Watch'} {fa?<ArrowLeft size={15}/>:<ArrowRight size={15}/>}</ActionButton>
        {result?.detail&&<small className="diagnostics-result-detail" title={result.detail}>{result.detail}</small>}
      </div>;})}</div>
      {!shown.length&&<div className="category-empty">{fa?'شبکه‌ای مطابق فیلترها پیدا نشد.':'No channels match these filters.'}</div>}
      <footer className="diagnostics-pagination"><span>{filtered.length?((currentPage-1)*PAGE_SIZE+1).toLocaleString():0}–{Math.min(currentPage*PAGE_SIZE,filtered.length).toLocaleString()} / {filtered.length.toLocaleString()}</span>
        <div><Button size="sm" variant="outline" disabled={currentPage<=1} onClick={()=>setPage(p=>p-1)}>{fa?'قبلی':'Previous'}</Button><span>{currentPage} / {pages}</span><Button size="sm" variant="outline" disabled={currentPage>=pages} onClick={()=>setPage(p=>p+1)}>{fa?'بعدی':'Next'}</Button></div>
      </footer>
    </div>
  </section>;
}
