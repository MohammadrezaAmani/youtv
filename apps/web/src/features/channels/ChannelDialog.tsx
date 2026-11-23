import {Select,SelectOption} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {ActionButton} from '@/components/ui/action-button';
import {useEffect,useState,type FormEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {channelSchema,normalizeStreamUrl,type Channel,type SubtitleSource} from '@youtv/shared';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useYoutv} from '@/stores/useYoutv';
import {normalizeError} from '@/lib/utils';
import {parseTags} from '@/lib/library';
import {ui} from '@/lib/labels';
import {Plus,Trash2,Subtitles,BookOpen} from 'lucide-react';
import {makeTeletextUrl} from '@/features/player/mediaUtils';

type Props={open:boolean;onOpenChange:(v:boolean)=>void;editing?:Channel|null};
const initial={name:'',url:'',logo:'',format:'auto' as Channel['format'],group:'',language:'',country:'',tvgId:'',proxyMode:'inherit' as Channel['proxyMode'],workerId:'',description:'',tags:'',teletextUrl:'',alternateUrls:'',subtitles:[] as SubtitleSource[]};
export default function ChannelDialog({open,onOpenChange,editing}:Props){
  const {t}=useTranslation();
  const language=useYoutv(s=>s.settings.language);
  const text=(key:Parameters<typeof ui>[0])=>ui(key,language);
  const [form,setForm]=useState(initial);
  const [error,setError]=useState('');
  const add=useYoutv(s=>s.addChannel),update=useYoutv(s=>s.updateChannel),workers=useYoutv(s=>s.workers),channels=useYoutv(s=>s.channels);
  useEffect(()=>{
    if(open){setForm(editing?{name:editing.name,url:editing.url,logo:editing.logo,format:editing.format,group:editing.group,language:editing.language,country:editing.country,tvgId:editing.tvgId,proxyMode:editing.proxyMode,workerId:editing.workerId,description:editing.description,tags:editing.tags.join(', '),teletextUrl:editing.teletextUrl||'',alternateUrls:(editing.alternateUrls||[]).join('\n'),subtitles:editing.subtitles||[]}:initial);setError('');}
  },[open,editing]);
  const field=(key:Exclude<keyof typeof initial,'subtitles'>,value:string)=>setForm(v=>({...v,[key]:value}));
  const save=(event:FormEvent)=>{
    event.preventDefault();setError('');
    try{
      const payload={...form,name:form.name.trim(),url:normalizeStreamUrl(form.url),proxyMode:form.proxyMode,tags:parseTags(form.tags),
        alternateUrls:form.alternateUrls.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(normalizeStreamUrl),
        subtitles:form.subtitles.map(item=>({...item,url:normalizeStreamUrl(item.url)}))};
      if(payload.teletextUrl.trim())makeTeletextUrl(payload.teletextUrl.trim(),100);
      if(channels.some(ch=>ch.url===payload.url&&ch.id!==editing?.id))throw new Error(language==='fa'?'این آدرس قبلاً در کتابخانه وجود دارد.':'A channel with this URL already exists.');
      const checked=channelSchema.pick({name:true,url:true,logo:true,format:true,group:true,language:true,country:true,tvgId:true,proxyMode:true,workerId:true,description:true,tags:true,teletextUrl:true,alternateUrls:true,subtitles:true}).parse(payload);
      if(editing)update(editing.id,checked); else add(checked);
      onOpenChange(false);
    }catch(e){setError(normalizeError(e));}
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogTitle className="modal-title">{t(editing?'editChannel':'addChannel')}</DialogTitle>
    <DialogDescription className="modal-subtitle">{t('playerNote')}</DialogDescription>
    <form onSubmit={save} className="form-stack">
      <label>{t('name')} *<Input autoFocus required maxLength={160} value={form.name} onChange={e=>field('name',e.target.value)} placeholder="Channel name"/></label>
      <label>{t('url')} *<Input required dir="ltr" type="url" value={form.url} onChange={e=>field('url',e.target.value)} placeholder="https://example.com/live.m3u8"/></label>
      <label>{text('description')}<Textarea className="ui-input channel-description-input" rows={3} maxLength={1000} value={form.description} onChange={e=>field('description',e.target.value)} placeholder={text('addDescription')}/></label>
      <label>{text('tags')}<Input value={form.tags} onChange={e=>field('tags',e.target.value)} placeholder={text('tagHint')}/></label>
      <div className="form-two"><label>{t('group')}<Input value={form.group} onChange={e=>field('group',e.target.value)}/></label><label>{t('tvgId')}<Input value={form.tvgId} onChange={e=>field('tvgId',e.target.value)}/></label></div>
      <div className="form-two"><label>{text('streamFormat')}<Select className="ui-input" value={form.format} onChange={e=>field('format',e.target.value)}><SelectOption value="auto">Auto</SelectOption><SelectOption value="hls">HLS (m3u8)</SelectOption><SelectOption value="video">MP4 / Native video</SelectOption></Select></label></div>
      <label>{t('logo')}<Input dir="ltr" type="url" value={form.logo} onChange={e=>field('logo',e.target.value)}/></label>
      <div className="form-two"><label>{t('country')}<Input value={form.country} onChange={e=>field('country',e.target.value)}/></label><label>{t('language')}<Input value={form.language} onChange={e=>field('language',e.target.value)}/></label></div>
      <div className="form-two"><label>{t('proxyMode')}<Select className="ui-input" value={form.proxyMode} onChange={e=>field('proxyMode',e.target.value)}>
        <SelectOption value="inherit">{text('defaultChoice')}</SelectOption><SelectOption value="direct">{t('direct')}</SelectOption><SelectOption value="proxy">{t('viaProxy')}</SelectOption><SelectOption value="auto">{t('automatic')}</SelectOption>
      </Select></label><label>{t('selectProfile')}<Select className="ui-input" value={form.workerId} onChange={e=>field('workerId',e.target.value)}><SelectOption value="">{text('defaultChoice')}</SelectOption>{workers.map(w=><SelectOption key={w.id} value={w.id}>{w.name}</SelectOption>)}</Select></label></div>
      <fieldset className="media-source-editor"><legend><Subtitles size={17}/>{language==='fa'?'زیرنویس‌های جانبی':'External subtitles'}</legend>
        <p className="muted">{language==='fa'?'برای هر زبان یک لینک VTT یا SRT اضافه کنید. زیرنویس‌های داخل HLS به‌صورت خودکار شناسایی می‌شوند.':'Add optional WebVTT or SRT URLs per language. HLS-native tracks are discovered automatically.'}</p>
        {form.subtitles.map((track,i)=><div key={track.id} className="media-track-editor">
          <div className="form-two"><label>{t('name')}<Input value={track.label} onChange={e=>setForm(v=>({...v,subtitles:v.subtitles.map((item,j)=>j===i?{...item,label:e.target.value}:item)}))} placeholder="English CC"/></label>
          <label>{t('language')}<Input value={track.language} onChange={e=>setForm(v=>({...v,subtitles:v.subtitles.map((item,j)=>j===i?{...item,language:e.target.value}:item)}))} placeholder="en"/></label></div>
          <div className="media-track-row"><Input dir="ltr" type="url" value={track.url} onChange={e=>setForm(v=>({...v,subtitles:v.subtitles.map((item,j)=>j===i?{...item,url:e.target.value}:item)}))} placeholder="https://.../subtitle.vtt"/>
            <Select className="ui-input" value={track.format} aria-label="Subtitle format" onChange={e=>setForm(v=>({...v,subtitles:v.subtitles.map((item,j)=>j===i?{...item,format:e.target.value as 'vtt'|'srt'}:item)}))}><SelectOption value="vtt">VTT</SelectOption><SelectOption value="srt">SRT</SelectOption></Select>
            <ActionButton type="button" className="media-track-delete" aria-label="Remove subtitle" onClick={()=>setForm(v=>({...v,subtitles:v.subtitles.filter((_,j)=>j!==i)}))}><Trash2 size={16}/></ActionButton></div>
        </div>)}
        <Button type="button" variant="outline" size="sm" onClick={()=>setForm(v=>({...v,subtitles:[...v.subtitles,{id:crypto.randomUUID(),label:'',language:'',url:'',format:'vtt'}]}))} disabled={form.subtitles.length>=24}><Plus size={15}/>{language==='fa'?'افزودن زبان زیرنویس':'Add subtitle track'}</Button>
      </fieldset>
      <fieldset className="media-source-editor"><legend><BookOpen size={17}/> Teletext</legend>
        <p className="muted">{language==='fa'?'آدرس صفحه Teletext ارائه‌دهنده با جای‌نگهدار {page}، مثل https://host/teletext/{page}.txt؛ این قابلیت Teletext خام جاسازی‌شده در MPEG-TS را رمزگشایی نمی‌کند.':'Optional provider page URL with {page} placeholder, e.g. https://host/teletext/{page}.txt. Embedded DVB Teletext is not decoded.'}</p>
        <Input dir="ltr" value={form.teletextUrl} onChange={e=>field('teletextUrl',e.target.value)} placeholder="https://provider.example/teletext/{page}.txt"/>
      </fieldset>
      <label>{language==='fa'?'منابع جایگزین (هر خط یک URL)':'Fallback URLs (one per line)'}<Textarea className="ui-input" dir="ltr" rows={2} value={form.alternateUrls} onChange={e=>field('alternateUrls',e.target.value)}/></label>
      {error&&<p className="error-message" role="alert">{error}</p>}
      <div className="modal-actions"><Button type="button" variant="ghost" onClick={()=>onOpenChange(false)}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
