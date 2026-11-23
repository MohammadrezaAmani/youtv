import {Select,SelectOption} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {useState} from 'react';
import {CloudCog,Eye,EyeOff,RefreshCw,ShieldAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cloudflareRequest,parseCfScripts,type CfScript} from '@/lib/cloudflare';
import {useYoutv} from '@/stores/useYoutv';

export default function CloudflareManager(){
  const settings=useYoutv(s=>s.settings),saveSettings=useYoutv(s=>s.updateSettings);
  const lang=settings.language,workers=useYoutv(s=>s.workers);
  const [workerId,setWorkerId]=useState(''),[accountId,setAccountId]=useState(settings.cloudflareAccountId),[apiToken,setApiToken]=useState(''),[adminToken,setAdminToken]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[scripts,setScripts]=useState<CfScript[]>([]),[selectedScript,setSelectedScript]=useState(settings.cloudflareScriptName);
  const [subdomain,setSubdomain]=useState<boolean|null>(null),[settingsText,setSettingsText]=useState('');
  const [show,setShow]=useState(false);
  const [secretName,setSecretName]=useState<'PROXY_TOKEN'|'ADMIN_TOKEN'>('PROXY_TOKEN');
  const [secretValue,setSecretValue]=useState('');
  const worker=workers.find(w=>w.id===workerId);
  const call=async(operation:'verify'|'list'|'getSubdomain'|'setSubdomain'|'getSettings'|'setSecret',enabled?:boolean)=>{
    if(!worker)throw Error('Select a deployed Worker first');
    if(!apiToken||!adminToken)throw Error('Enter Cloudflare API Token and Worker ADMIN_TOKEN');
    return cloudflareRequest({workerUrl:worker.baseUrl,adminToken,apiToken,accountId,operation,scriptName:selectedScript,enabled,secretName:operation==='setSecret'?secretName:undefined,secretValue:operation==='setSecret'?secretValue:undefined});
  };
  const run=async(op:'verify'|'list'|'getSubdomain'|'setSubdomain'|'getSettings'|'setSecret',enabled?:boolean)=>{
    setBusy(true);setMessage('');
    try{
      const data=await call(op,enabled);
      if(op==='list')setScripts(parseCfScripts(data));
      if(op==='getSubdomain'||op==='setSubdomain'){
        const result=data.result as {enabled?:boolean}|undefined;
        setSubdomain(result?.enabled??enabled??null);
      }
      if(op==='getSettings')setSettingsText(JSON.stringify(data.result,null,2));
      if(op==='setSecret')setSecretValue('');
      setMessage(`${op}: success`);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  return <div className="panel-card cloudflare-manager"><h3><CloudCog size={20}/>{lang==='fa'?'مدیریت Cloudflare از مرورگر':'Cloudflare management in browser'}</h3>
    <p className="muted">{lang==='fa'?'توکن API فقط در حافظه همین صفحه نگه داشته می‌شود و با Refresh پاک می‌شود. لازم است یک‌بار Worker را از داشبورد Cloudflare راه‌اندازی و ADMIN_TOKEN را تنظیم کرده باشی.':'API token stays in this page memory only. Bootstrap your Worker in Cloudflare dashboard once and configure ADMIN_TOKEN.'}</p>
    <div className="info-box"><ShieldAlert size={17}/> {lang==='fa'?'هرگز Global API Key را وارد نکن. از API Token با دسترسی محدود Workers Scripts Read/Edit و یک ADMIN_TOKEN مستقل از PROXY_TOKEN استفاده کن.':'Never enter a Global API Key. Use a narrowly-scoped API Token (Workers Scripts Read/Edit) and a dedicated ADMIN_TOKEN distinct from PROXY_TOKEN.'}</div>
    <div className="form-stack">
      <label>Management Worker<Select className="ui-input" value={workerId} onChange={e=>setWorkerId(e.target.value)}><SelectOption value="">{lang==='fa'?'انتخاب Worker…':'Select Worker…'}</SelectOption>{workers.filter(w=>w.enabled).map(w=><SelectOption value={w.id} key={w.id}>{w.name}</SelectOption>)}</Select></label>
      <label>Cloudflare Account ID<Input dir="ltr" autoComplete="off" value={accountId} onChange={e=>{setAccountId(e.target.value);saveSettings({cloudflareAccountId:e.target.value});}} placeholder="32-character Account ID"/></label>
      <label>Cloudflare API Token<Input dir="ltr" type={show?'text':'password'} autoComplete="off" value={apiToken} onChange={e=>setApiToken(e.target.value)}/></label>
      <label>Worker ADMIN_TOKEN<Input dir="ltr" type={show?'text':'password'} autoComplete="off" value={adminToken} onChange={e=>setAdminToken(e.target.value)}/></label>
      <Button variant="ghost" onClick={()=>setShow(v=>!v)}>{show?<EyeOff size={15}/>:<Eye size={15}/>} {show?'Hide':'Show'} tokens</Button>
    </div>
    <div className="row-wrap"><Button disabled={busy||!worker} onClick={()=>void run('verify')}>{lang==='fa'?'اعتبارسنجی API Token':'Verify API Token'}</Button>
      <Button variant="outline" disabled={busy||!worker||!accountId} onClick={()=>void run('list')}><RefreshCw size={15}/>{lang==='fa'?'فهرست Workerها':'List Workers'}</Button></div>
    {scripts.length>0&&<div className="form-stack"><label>Worker Script<Select className="ui-input" value={selectedScript} onChange={e=>{setSelectedScript(e.target.value);saveSettings({cloudflareScriptName:e.target.value});setSubdomain(null);setSettingsText('');}}><SelectOption value="">Choose…</SelectOption>{scripts.map(s=><SelectOption value={s.id} key={s.id}>{s.id}</SelectOption>)}</Select></label>
      <div className="row-wrap"><Button disabled={busy||!selectedScript} onClick={()=>void run('getSubdomain')}>{lang==='fa'?'مشاهده زیردامنه':'Read subdomain'}</Button>
        <Button variant="outline" disabled={busy||!selectedScript} onClick={()=>void run('getSettings')}>{lang==='fa'?'نمایش تنظیمات':'Inspect settings'}</Button></div>
      {subdomain!==null&&<label className="checkbox-row"><Checkbox checked={subdomain} disabled={busy} onChange={e=>{const enabled=e.target.checked;if(confirm(`Set workers.dev enabled=${enabled} for ${selectedScript}?`))void run('setSubdomain',enabled);}}/> workers.dev enabled</label>}
      <div className="form-stack"><h4>{lang==='fa'?'ویرایش Secretهای YouTV':'Update YouTV Worker secrets'}</h4>
        <p className="muted">{lang==='fa'?'این تغییر به API کلادفلر ارسال می‌شود و ممکن است نسخه جدید Worker ایجاد کند. تغییر ADMIN_TOKEN خود Worker مدیریتی دسترسی مدیریتی فعلی را باطل می‌کند.':'Writes a secret through the Cloudflare API. Rotating the management Worker ADMIN_TOKEN will invalidate the currently entered admin credential.'}</p>
        <label>Secret name<Select className="ui-input" value={secretName} onChange={e=>setSecretName(e.target.value as 'PROXY_TOKEN'|'ADMIN_TOKEN')}><SelectOption value="PROXY_TOKEN">PROXY_TOKEN</SelectOption><SelectOption value="ADMIN_TOKEN">ADMIN_TOKEN</SelectOption></Select></label>
        <label>New secret value<Input type="password" autoComplete="off" value={secretValue} onChange={e=>setSecretValue(e.target.value)} placeholder={secretName==='ADMIN_TOKEN'?'At least 32 characters':'At least 24 characters'}/></label>
        <Button variant="outline" disabled={busy||!selectedScript||secretValue.length<(secretName==='ADMIN_TOKEN'?32:24)} onClick={()=>{if(confirm(`Update ${secretName} on ${selectedScript}?`))void run('setSecret');}}>{lang==='fa'?'ذخیره Secret در Cloudflare':'Save secret in Cloudflare'}</Button>
      </div>
      {settingsText&&<pre className="cf-settings-preview">{settingsText}</pre>}
    </div>}
    {message&&<div role="status" className="info-box">{message}</div>}
    <p className="muted">API bridge supports token verification, Worker listing, settings inspection, workers.dev toggling and YouTV-specific secret updates. Initial bootstrap and hostname allowlist configuration still use the Cloudflare dashboard.</p>
  </div>;
}
