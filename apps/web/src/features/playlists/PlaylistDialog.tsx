import {Select,SelectOption} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {RadioOption} from '@/components/ui/radio';
import {FileInput} from '@/components/ui/file-input';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FileUp,Link2,AlertTriangle} from 'lucide-react';
import {createChannel,type Channel,type Playlist} from '@youtv/shared';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {parseM3u} from '@/lib/playlist';
import {resolveTextSource,needsHttpsRelay} from '@/lib/proxy';
import {normalizeError} from '@/lib/utils';
import {ui} from '@/lib/labels';
import {useYoutv} from '@/stores/useYoutv';

type Props={open:boolean;onOpenChange:(open:boolean)=>void;onImported?:()=>void};
export default function PlaylistDialog({open,onOpenChange,onImported}:Props){
  const {t}=useTranslation();
  const [mergeMode,setMergeMode]=useState<'merge'|'skip'>('merge');
  const [previewPage,setPreviewPage]=useState(0);
  const [previewWorkerId,setPreviewWorkerId]=useState('');
  const previewPageSize=50;
  const [kind,setKind]=useState<'file'|'url'>('file'),[url,setUrl]=useState(''),[name,setName]=useState(''),
    [fromWorker,setFromWorker]=useState(false),[workerId,setWorkerId]=useState(''),
    [results,setResults]=useState<Channel[]>([]),[warnings,setWarnings]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const workers=useYoutv(s=>s.workers),settings=useYoutv(s=>s.settings),channels=useYoutv(s=>s.channels);
  const savePlaylist=useYoutv(s=>s.savePlaylist),upsert=useYoutv(s=>s.upsertChannels);
  const reset=()=>{setResults([]);setWarnings([]);setError('');setPreviewPage(0);setPreviewWorkerId('');};
  const parse=(text:string,source?:string)=>{
    const value=parseM3u(text,source);
    setResults(value.channels);setWarnings(value.warnings);setError('');
  };
  const readFile=async(file:File|undefined)=>{
    if(!file)return;reset();
    setName(file.name.replace(/\.m3u8?$/i,''));
    try{parse(await file.text());}catch(e){setError(normalizeError(e));}
  };
  const fetchUrl=async()=>{
    setBusy(true);reset();
    try{
      const source=new URL(url.trim());if(!/^https?:$/.test(source.protocol))throw new Error(t('invalidUrl'));
      const routed=resolveTextSource(source.toString(),settings,workers,workerId,fromWorker);
      const endpoint=routed.url;
      const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
      try{
        const res=await fetch(endpoint,{signal:controller.signal,credentials:'omit'});
        if(!res.ok)throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const text=await res.text();
        parse(text,source.toString());
        setPreviewWorkerId(routed.workerId);
        if(!name)setName(source.hostname);
      }finally{clearTimeout(timeout);}
    }catch(e){setError(`${normalizeError(e)}. ${t('sourceRequiresCors')}`);}
    finally{setBusy(false);}
  };
  const existingUrls=new Set(channels.map(c=>c.url));
  const duplicateCount=results.filter(c=>existingUrls.has(c.url)).length;
  const commit=()=>{
    if(!results.length)return;
    const selected=mergeMode==='skip'?results.filter(c=>!existingUrls.has(c.url)):results;
    const existing=useYoutv.getState().playlists.find(p=>
      !p.id.startsWith('youtv:folder:')&&p.id!=='youtv:builtin:default'&&
      (kind==='file'?!p.url&&p.name===(name.trim()||'') : !!p.url&&p.url===url.trim()));
    const id=existing?.id||crypto.randomUUID(),now=Date.now();
    const source:Playlist={id,name:name.trim()||`Playlist ${new Date().toLocaleDateString()}`,url:kind==='url'?url.trim():'',importedAt:existing?.importedAt??now,refreshedAt:now,count:selected.length,refreshWorkerId:previewWorkerId};
    savePlaylist(source);
    upsert(selected.map(c=>createChannel({...c,sourceId:id})),id,true);
    setResults([]);setWarnings([]);setError('');setName('');setUrl('');onOpenChange(false);onImported?.();
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogTitle className="modal-title">{t('importPlaylist')}</DialogTitle>
    <DialogDescription className="modal-subtitle">{t('playlistImportNote')}</DialogDescription>
    <div className="switch-row"><Button variant={kind==='file'?'default':'ghost'} size="sm" onClick={()=>{setKind('file');reset();}}><FileUp size={16}/>{t('fileImport')}</Button>
      <Button variant={kind==='url'?'default':'ghost'} size="sm" onClick={()=>{setKind('url');reset();}}><Link2 size={16}/>{t('urlImport')}</Button></div>
    <div className="form-stack">
      <label>{t('playlistName')}<Input value={name} onChange={e=>setName(e.target.value)}/></label>
      {kind==='file' ? <label className="file-drop"><FileUp size={24}/><span>{t('selectFile')}</span><FileInput accept=".m3u,.m3u8,application/vnd.apple.mpegurl,text/plain" onChange={e=>void readFile(e.target.files?.[0])}/></label>
        : <><label>{t('playlistUrl')}<Input type="url" dir="ltr" placeholder="https://.../channels.m3u" value={url} onChange={e=>setUrl(e.target.value)}/></label>
          <label className="checkbox-row"><Checkbox checked={fromWorker} onChange={e=>setFromWorker(e.target.checked)}/>{t('importUsingProxy')}</label>
          {needsHttpsRelay(url.trim())&&<small className="muted">{settings.language==='fa'?'این Playlist با HTTP است؛ هنگام دریافت، به‌صورت خودکار از Worker HTTPS استفاده می‌شود.':'This HTTP playlist is fetched automatically through an HTTPS Worker.'}</small>}
          {fromWorker&&<Select className="ui-input" value={workerId||settings.defaultWorkerId} onChange={e=>setWorkerId(e.target.value)}>
            <SelectOption value="">{t('selectProfile')}</SelectOption>{workers.filter(w=>w.enabled).map(w=><SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}
          </Select>}
          <Button disabled={!url||busy} onClick={()=>void fetchUrl()}>{busy?t('importing'):t('preview')}</Button>
        </>}
      {error&&<div className="error-message" role="alert">{error}</div>}
      {results.length>0&&<div className="preview-box"><strong>{results.length.toLocaleString()} {t('foundChannels')}</strong>
        <span className="muted">{new Set(results.map(c=>c.group).filter(Boolean)).size} {t('groups')} · {duplicateCount} {ui('existing',settings.language)}</span>
        <div className="import-mode" role="radiogroup" aria-label="Duplicate import policy">
          <label><RadioOption checked={mergeMode==='merge'} onChange={()=>setMergeMode('merge')}/>{ui('mergePreserve',settings.language)}</label>
          <label><RadioOption checked={mergeMode==='skip'} onChange={()=>setMergeMode('skip')}/>{ui('skipExisting',settings.language)}</label>
        </div>
        <div className="preview-names preview-names-scroll" role="list" aria-label={t('foundChannels')}>
          {results.slice(previewPage*previewPageSize,(previewPage+1)*previewPageSize).map((c,i)=><span role="listitem" key={`${c.url}:${i}`} title={c.url}>{c.name}</span>)}
        </div>
        {results.length>previewPageSize&&<div className="preview-pagination">
          <Button size="sm" variant="outline" disabled={previewPage===0} onClick={()=>setPreviewPage(page=>Math.max(0,page-1))}>‹</Button>
          <span>{previewPage*previewPageSize+1}–{Math.min(results.length,(previewPage+1)*previewPageSize)} / {results.length.toLocaleString()}</span>
          <Button size="sm" variant="outline" disabled={(previewPage+1)*previewPageSize>=results.length} onClick={()=>setPreviewPage(page=>page+1)}>›</Button>
        </div>}
        {warnings.length>0&&<div className="warning-text"><AlertTriangle size={15}/>{warnings.length} warnings: {warnings.slice(0,2).join(', ')}</div>}
        <small>{t('duplicates')}</small>
      </div>}
      <div className="modal-actions"><Button variant="ghost" onClick={()=>onOpenChange(false)}>{t('cancel')}</Button><Button disabled={!results.length||(mergeMode==='skip'&&duplicateCount===results.length)} onClick={commit}>{t('import')} ({mergeMode==='skip'?results.length-duplicateCount:results.length})</Button></div>
    </div>
  </DialogContent></Dialog>;
}
