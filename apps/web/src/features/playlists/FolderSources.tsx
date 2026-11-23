import {useEffect,useState} from 'react';
import {FolderOpen,RefreshCw,AlertTriangle} from 'lucide-react';
import {ActionButton} from '@/components/ui/action-button';
import {Checkbox} from '@/components/ui/checkbox';
import {FOLDER_SOURCE_PREFIX} from '@/lib/builtin';
import {parseM3u} from '@/lib/playlist';
import {normalizeError} from '@/lib/utils';
import {useYoutv} from '@/stores/useYoutv';

type Source = {path:string;name:string;channelCount:number;bytes:number;kind:'playlist'|'hls'|'invalid'|'oversize'};
const sourceUrl=(path:string)=>`${import.meta.env.BASE_URL}sources/${path.split('/').map(encodeURIComponent).join('/')}`;

export default function FolderSources(){
  const settings=useYoutv(s=>s.settings),channels=useYoutv(s=>s.channels),update=useYoutv(s=>s.updateSettings);
  const upsert=useYoutv(s=>s.upsertChannels),savePlaylist=useYoutv(s=>s.savePlaylist);
  const fa=settings.language==='fa';
  const [sources,setSources]=useState<Source[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[messages,setMessages]=useState<Record<string,string>>({});
  const reload=async()=>{
    setLoading(true);setError('');
    try{
      const response=await fetch(`${import.meta.env.BASE_URL}sources/index.json`,{credentials:'omit',cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data:unknown=await response.json();
      if(!data || typeof data!=='object' || !('version' in data) || data.version!==1 || !('sources' in data) || !Array.isArray(data.sources))throw new Error('Invalid source catalog');
      setSources(data.sources.filter((entry:unknown):entry is Source=>{
        if(!entry || typeof entry!=='object')return false;
        const value=entry as Partial<Source>;
        return typeof value.path==='string'&&typeof value.name==='string'&&typeof value.channelCount==='number'&&typeof value.bytes==='number'&&['playlist','hls','invalid','oversize'].includes(String(value.kind));
      }));
    }catch(e){setError(normalizeError(e));}
    finally{setLoading(false);}
  };
  useEffect(()=>{void reload();},[]);
  const toggle=async(source:Source,enable:boolean)=>{
    if(busy)return;
    if(!enable){update({folderSourceEnabled:{...settings.folderSourceEnabled,[source.path]:false}});return;}
    if(source.kind!=='playlist'){setMessages(s=>({...s,[source.path]:fa?'این فایل یک فهرست معتبر شبکه نیست.':'Not an IPTV channel playlist.'}));return;}
    setBusy(source.path);setMessages(s=>({...s,[source.path]:''}));
    try{
      const response=await fetch(sourceUrl(source.path),{credentials:'omit',cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const length=Number(response.headers.get('content-length')||0);
      if(length>15_000_000)throw new Error('Source exceeds 15MB');
      const contents=await response.text();
      if(contents.length>15_000_000)throw new Error('Source exceeds 15MB');
      const result=parseM3u(contents,sourceUrl(source.path));
      const id=FOLDER_SOURCE_PREFIX+source.path;
      const existing=useYoutv.getState().playlists.find(p=>p.id===id);
      upsert(result.channels,id,true);
      savePlaylist({id,name:source.path,url:'',count:result.channels.length,importedAt:existing?.importedAt??Date.now(),refreshedAt:Date.now(),refreshWorkerId:''});
      update({folderSourceEnabled:{...useYoutv.getState().settings.folderSourceEnabled,[source.path]:true}});
      setMessages(s=>({...s,[source.path]:`${result.channels.length} ${fa?'شبکه بارگذاری شد':'channels loaded'}`}));
    }catch(e){setMessages(s=>({...s,[source.path]:normalizeError(e)}));}
    finally{setBusy('');}
  };
  return <section className="folder-sources" aria-label={fa?'منابع پوشه‌ای':'Folder sources'}>
    <div className="folder-sources-heading"><div><h2><FolderOpen size={20}/>{fa?'منابع داخل پوشه':'Bundled sources'}</h2></div><ActionButton className="folder-sources-reload" onClick={()=>void reload()} disabled={loading}><RefreshCw size={16}/>{fa?'بررسی مجدد':'Refresh list'}</ActionButton></div>
    {error&&<p className="folder-source-error" role="alert"><AlertTriangle size={16}/>{error}</p>}
    {!loading&&!sources.length&&!error&&<p className="folder-source-empty">{fa?'هنوز فایلی در پوشه sources وجود ندارد.':'No playlists in the sources folder.'} <code>apps/web/public/sources/</code></p>}
    {loading&&<p className="folder-source-empty">{fa?'در حال خواندن منابع…':'Loading sources…'}</p>}
    {sources.length>0&&<div className="folder-sources-list">{sources.map(source=>{
      const enabled=settings.folderSourceEnabled[source.path]===true;
      const count=channels.filter(c=>c.sourceId===FOLDER_SOURCE_PREFIX+source.path).length;
      const usable=source.kind==='playlist';
      return <div className="folder-source-row" key={source.path}>
        <div className="folder-source-info"><strong title={source.path}>{source.path}</strong><small>{usable?`${count||source.channelCount} ${fa?'شبکه':'channels'}`:source.kind==='hls'?'HLS manifest':source.kind==='oversize'?'> 15 MB':fa?'نامعتبر':'Invalid playlist'} · {(source.bytes/1024).toFixed(0)} KB</small>{messages[source.path]&&<small className="folder-source-message">{messages[source.path]}</small>}</div>
        <label className="folder-source-toggle"><Checkbox disabled={!usable||Boolean(busy)} checked={enabled} onChange={e=>void toggle(source,e.target.checked)}/><span>{enabled?(fa?'فعال':'On'):(fa?'غیرفعال':'Off')}</span></label>
        {enabled&&<ActionButton className="folder-source-refresh" disabled={Boolean(busy)} onClick={()=>void toggle(source,true)} title={fa?'بازخوانی فایل':'Reload file'}><RefreshCw size={16}/></ActionButton>}
      </div>;
    })}</div>}
  </section>;
}
