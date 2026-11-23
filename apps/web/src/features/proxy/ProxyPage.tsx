import {Select,SelectOption} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {useState,type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {Cloud,Plus,Trash2,Activity,ShieldCheck,Pencil,X,Check} from 'lucide-react';
import {workerSchema} from '@youtv/shared';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useYoutv} from '@/stores/useYoutv';
import {normalizeError} from '@/lib/utils';
import {ui} from '@/lib/labels';
import CloudflareManager from './CloudflareManager';
import CloudflareGuide from './CloudflareGuide';

export default function ProxyPage(){
  const {t}=useTranslation();
  const workers=useYoutv(s=>s.workers),settings=useYoutv(s=>s.settings),save=useYoutv(s=>s.saveWorker),remove=useYoutv(s=>s.removeWorker),update=useYoutv(s=>s.updateSettings);
  const [name,setName]=useState(''),[url,setUrl]=useState(''),[token,setToken]=useState(''),[error,setError]=useState('');
  const [results,setResults]=useState<Record<string,string>>({});
  const [editingToken,setEditingToken]=useState<string>(''),[replacementToken,setReplacementToken]=useState('');
  const [editingWorker,setEditingWorker]=useState(''),[editName,setEditName]=useState(''),[editUrl,setEditUrl]=useState('');
  const add=(e:FormEvent)=>{
    e.preventDefault();setError('');
    try{
      const normalized=new URL(url.trim());if(!['http:','https:'].includes(normalized.protocol))throw new Error(t('invalidUrl'));
      if(normalized.protocol==='http:'&&!['localhost','127.0.0.1'].includes(normalized.hostname))throw new Error('HTTPS required for remote Workers');
      const value=workerSchema.parse({id:crypto.randomUUID(),name:name.trim(),baseUrl:normalized.toString(),token,enabled:true});
      save(value);if(!settings.defaultWorkerId)update({defaultWorkerId:value.id});
      setName('');setUrl('');setToken('');
    }catch(e){setError(normalizeError(e));}
  };
  const editWorker=(id:string)=>{const worker=workers.find(w=>w.id===id);if(!worker)return;setEditingWorker(id);setEditName(worker.name);setEditUrl(worker.baseUrl);setError('');};
  const commitWorkerEdit=(id:string)=>{
    const worker=workers.find(w=>w.id===id);if(!worker)return;
    try{
      const target=new URL(editUrl.trim());
      if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw new Error(t('invalidUrl'));
      if(target.protocol==='http:'&&!['localhost','127.0.0.1'].includes(target.hostname))throw new Error('HTTPS required for remote Workers');
      const parsed=workerSchema.parse({...worker,name:editName.trim(),baseUrl:target.toString()});
      save(parsed);setEditingWorker('');setError('');
    }catch(err){setError(normalizeError(err));}
  };
  const health=async(id:string,base:string)=>{
    setResults(s=>({...s,[id]:'Checking…'}));
    try{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
      const endpoint=new URL('health',base.endsWith('/')?base:base+'/');
      let result:Response;
      try{result=await fetch(endpoint,{signal:controller.signal,credentials:'omit'});}finally{clearTimeout(timer);}
      const body:unknown=await result.json();
      if(!result.ok||typeof body!=='object'||body===null||!('ok' in body)||body.ok!==true)throw new Error('Health response invalid');
      setResults(s=>({...s,[id]:t('testOk')}));
    }catch(e){setResults(s=>({...s,[id]:`${t('testFail')} ${normalizeError(e)}`}));}
  };
  return <section className="page-content">
    <div className="page-heading"><div><div className="eyebrow">CLOUDFLARE WORKERS</div><h1><Cloud size={29}/>{t('proxy')}</h1><p>{t('proxyHelp')}</p></div></div>
    <CloudflareGuide/>
    <div className="settings-grid"><div className="panel-card"><h3><Plus size={20}/>{t('addWorker')}</h3>
      <form className="form-stack" onSubmit={add}>
        <label>{t('workerName')}<Input value={name} onChange={e=>setName(e.target.value)} required placeholder="My Worker"/></label>
        <label>{t('workerUrl')}<Input value={url} onChange={e=>setUrl(e.target.value)} type="url" dir="ltr" required placeholder="https://your-worker.workers.dev/"/></label>
        <label>{t('accessToken')}<Input value={token} onChange={e=>setToken(e.target.value)} type="password" dir="ltr" required minLength={24} placeholder="Your PROXY_TOKEN secret"/></label>
        {error&&<div className="error-message" role="alert">{error}</div>}
        <Button type="submit"><Plus size={17}/>{t('addWorker')}</Button>
      </form>
    </div><div className="panel-card"><h3><ShieldCheck size={20}/>{t('security')}</h3>
      <p className="muted">{settings.language==='fa'?'این پروکسی فقط برای منابعی که اجازه استفاده از آن‌ها را داری تنظیم شود. دامنه‌های منبع را در Allowlist تعریف کن و هیچ توکن مدیریتی را در URL عمومی قرار نده.':'Use the Worker only for authorized sources. Restrict upstream hosts and keep management credentials out of public URLs.'}</p>
      <div className="info-box">{settings.language==='fa'?'برای کارکرد صحیح این Worker باید ALLOWED_HOSTS و ALLOWED_ORIGINS و PROXY_TOKEN تنظیم شده باشند. کلید API مدیریت Cloudflare با توکن پخش یکی نیست.':'Configure ALLOWED_HOSTS, ALLOWED_ORIGINS and PROXY_TOKEN. Cloudflare API Token and playback token are different credentials.'}</div>
    </div></div>
    <div className="panel-card"><h3>{t('defaultWorker')}</h3>
      <div className="settings-row"><label>{t('proxyMode')}<Select value={settings.proxyMode} className="ui-input" onChange={e=>update({proxyMode:e.target.value as 'direct'|'proxy'|'auto'})}><SelectOption value="direct">{t('direct')}</SelectOption><SelectOption value="proxy">{t('viaProxy')}</SelectOption><SelectOption value="auto">{t('automatic')}</SelectOption></Select></label>
      <label>{t('defaultWorker')}<Select className="ui-input" value={settings.defaultWorkerId} onChange={e=>update({defaultWorkerId:e.target.value})}><SelectOption value="">—</SelectOption>{workers.filter(w=>w.enabled).map(w=><SelectOption value={w.id} key={w.id}>{w.name}</SelectOption>)}</Select></label></div>
    </div>
    <CloudflareManager/>
    <div className="worker-list">{workers.length===0&&<div className="empty-subpanel"><Cloud size={25}/>{t('notConfigured')}</div>}
    {workers.map(w=><div key={w.id} className="worker-item">
      <div className="worker-icon"><Cloud size={23}/></div><div className="worker-details"><b>{w.name}</b><small dir="ltr">{w.baseUrl}</small><small className="muted">{results[w.id]||''}</small></div>
      <div className="row-wrap"><label className="checkbox-row"><Checkbox checked={w.enabled} onChange={e=>save({...w,enabled:e.target.checked})}/>{t('active')}</label>
        <Button variant="outline" size="sm" onClick={()=>void health(w.id,w.baseUrl)}><Activity size={16}/>{t('healthCheck')}</Button>
        <Button variant="outline" size="sm" onClick={()=>editWorker(w.id)}><Pencil size={15}/>{t('edit')}</Button>
        <Button variant="outline" size="sm" onClick={()=>{setEditingToken(editingToken===w.id?'':w.id);setReplacementToken('');}}>{ui('changeToken',settings.language)}</Button>
        <Button variant="ghost" size="icon" onClick={()=>{if(confirm(t('deleteConfirm')))remove(w.id);}} aria-label={t('delete')}><Trash2 size={18}/></Button>
      </div>
      {editingWorker===w.id&&<div className="worker-editor">
        <label>{t('workerName')}<Input value={editName} onChange={e=>setEditName(e.target.value)} required/></label>
        <label>{t('workerUrl')}<Input dir="ltr" type="url" value={editUrl} onChange={e=>setEditUrl(e.target.value)} required/></label>
        <div className="row-wrap"><Button size="sm" onClick={()=>commitWorkerEdit(w.id)}><Check size={15}/>{t('save')}</Button><Button size="sm" variant="ghost" onClick={()=>setEditingWorker('')}><X size={15}/>{t('cancel')}</Button></div>
        {error&&<div className="error-message">{error}</div>}
      </div>}
      {editingToken===w.id&&<div className="worker-token-edit"><Input type="password" dir="ltr" minLength={24} placeholder="New token (minimum 24 characters)" value={replacementToken} onChange={e=>setReplacementToken(e.target.value)}/><Button size="sm" disabled={replacementToken.length<24} onClick={()=>{save({...w,token:replacementToken});setEditingToken('');setReplacementToken('');}}>{ui('saveToken',settings.language)}</Button></div>}
    </div>)}</div>
  </section>;
}
