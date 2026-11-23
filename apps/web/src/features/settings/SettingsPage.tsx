import {Select,SelectOption} from '@/components/ui/select';
import {Checkbox} from '@/components/ui/checkbox';
import {Slider} from '@/components/ui/slider';
import {FileInput} from '@/components/ui/file-input';
import {ActionButton} from '@/components/ui/action-button';
import {useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Download,Upload,Palette,Database,Trash2,Languages,Shield,FileDown,Subtitles,Volume2,MonitorPlay} from 'lucide-react';
import i18n from '@/locales';
import {Button} from '@/components/ui/button';
import {useYoutv} from '@/stores/useYoutv';
import {downloadBackup,importBackupText,parseBackupText,type RestoreMode} from '@/lib/backup';
import {BUILTIN_PLAYLIST_ID} from '@youtv/shared';
import {downloadText,toM3u} from '@/lib/playlist';
import {normalizeError} from '@/lib/utils';
import type {Settings} from '@youtv/shared';
import {Input} from '@/components/ui/input';
const InputMedia=Input;

const themes:Settings['theme'][]=['dark','light','mint','oled','ocean','emerald','violet'];
const themeLabels:Record<Settings['theme'],{fa:string;en:string}>={dark:{fa:'رز تیره',en:'Rose Dark'},light:{fa:'رز روشن',en:'Rose Light'},mint:{fa:'سبز روشن',en:'Mint Light'},oled:{fa:'مشکی OLED',en:'OLED Black'},ocean:{fa:'آبی اقیانوسی',en:'Ocean'},emerald:{fa:'سبز تیره',en:'Emerald Dark'},violet:{fa:'بنفش',en:'Violet'}};
const langs:Record<Settings['language'],string>={fa:'فارسی',en:'English',ar:'العربية',tr:'Türkçe',ru:'Русский'};
export default function SettingsPage(){
  const {t}=useTranslation();
  const settings=useYoutv(s=>s.settings),update=useYoutv(s=>s.updateSettings),channels=useYoutv(s=>s.channels),reset=useYoutv(s=>s.reset);
  const file=useRef<HTMLInputElement>(null);const [message,setMessage]=useState('');
  const [restoreMode,setRestoreMode]=useState<RestoreMode>('merge');
  const [includeSecrets,setIncludeSecrets]=useState(false);
  const [backupInfo,setBackupInfo]=useState('');
  const changeLang=(language:Settings['language'])=>{update({language});void i18n.changeLanguage(language);};
  const importFile=async(f:File|undefined)=>{
    if(!f)return;
    try{
      const content=await f.text(),preview=parseBackupText(content);
      setBackupInfo(`${preview.data.channels.length} channels · ${preview.data.playlists.length} playlists · ${preview.data.workers.length} Workers`);
      const msg=restoreMode==='replace'?'Replace ALL current YouTV data with this backup?':'Merge backup data into your current YouTV library?';
      if(!confirm(msg))return;
      const next=importBackupText(content,useYoutv.getState(),restoreMode);
      useYoutv.getState().importState(next);
      void i18n.changeLanguage(next.settings.language);setMessage(`${t('success')}: ${preview.data.channels.length} channels`);
    }
    catch(e){setMessage(`${t('error')}: ${normalizeError(e)}`);}
  };
  return <section className="page-content">
    <div className="page-heading"><div><div className="eyebrow">PERSONALIZATION</div><h1><Palette size={29}/>{t('settings')}</h1><p>{t('madeFor')}</p></div></div>
    <div className="settings-grid">
      <div className="panel-card"><h3><Database size={20}/>{settings.language==='fa'?'منبع پیش‌فرض کانال‌ها':'Bundled channel source'}</h3>
        <label className="checkbox-row"><Checkbox checked={settings.defaultPlaylistEnabled} onChange={e=>update({defaultPlaylistEnabled:e.target.checked})}/>{settings.language==='fa'?'نمایش و استفاده از default.m3u8':'Enable default.m3u8'}</label>
        <p className="muted">{settings.language==='fa'?'با خاموش‌کردن، کانال‌ها پنهان می‌شوند اما Favorites، تگ‌ها و تاریخچه حذف نمی‌شوند.':'Disabling hides default channels without deleting your tags or favorites.'}</p>
        <p className="muted">{channels.filter(c=>c.sourceId===BUILTIN_PLAYLIST_ID).length} imported channels</p>
      </div>
      <div className="panel-card"><h3><Palette size={20}/>{t('appearance')}</h3>
        <div className="theme-grid">{themes.map(theme=><ActionButton className={`theme-preview theme-${theme} ${settings.theme===theme?'theme-selected':''}`} key={theme} onClick={()=>update({theme})} aria-pressed={settings.theme===theme}><span className="theme-bar"/><span className="theme-text">{themeLabels[theme][settings.language==='fa'?'fa':'en']}</span></ActionButton>)}</div>
      </div>
      <div className="panel-card"><h3><Languages size={20}/>{t('language')}</h3>
        <div className="form-stack"><label>{t('language')}<Select className="ui-input" value={settings.language} onChange={e=>changeLang(e.target.value as Settings['language'])}>{Object.entries(langs).map(([code,label])=><SelectOption key={code} value={code}>{label}</SelectOption>)}</Select></label><p className="muted">RTL / LTR automatically follows the selected language.</p></div>
      </div>
      <div className="panel-card"><h3><Subtitles size={20}/>{settings.language==='fa'?'زیرنویس و زبان صدا':'Subtitles & Audio'}</h3>
        <div className="form-stack">
          <label>{settings.language==='fa'?'زبان صوتی ترجیحی':'Preferred audio language'}<InputMedia value={settings.preferredAudio} onChange={e=>update({preferredAudio:e.target.value})} placeholder="fa, en, ar, ..."/></label>
          <label>{settings.language==='fa'?'زبان زیرنویس ترجیحی':'Preferred subtitle language'}<InputMedia value={settings.preferredSubtitle} onChange={e=>update({preferredSubtitle:e.target.value})} placeholder="fa, en, ar, ..."/></label>
          <label className="checkbox-row"><Checkbox checked={settings.captionsEnabled} onChange={e=>update({captionsEnabled:e.target.checked})}/>{settings.language==='fa'?'فعال بودن زیرنویس در شروع':'Enable captions by default'}</label>
          <div className="form-two"><label>{settings.language==='fa'?'اندازه زیرنویس':'Caption size'}<Select className="ui-input" value={settings.captionSize} onChange={e=>update({captionSize:e.target.value as Settings['captionSize']})}><SelectOption value="small">Small</SelectOption><SelectOption value="medium">Medium</SelectOption><SelectOption value="large">Large</SelectOption></Select></label>
            <label>{settings.language==='fa'?'پس‌زمینه زیرنویس':'Caption background'}<Select className="ui-input" value={settings.captionBackground} onChange={e=>update({captionBackground:e.target.value as Settings['captionBackground']})}><SelectOption value="none">None</SelectOption><SelectOption value="shadow">Shadow</SelectOption><SelectOption value="box">Box</SelectOption></Select></label></div>
        </div>
      </div>
      <div className="panel-card"><h3><MonitorPlay size={20}/>{settings.language==='fa'?'تنظیمات پلیر':'Player preferences'}</h3>
        <div className="form-stack"><label className="checkbox-row"><Checkbox checked={settings.autoplay} onChange={e=>update({autoplay:e.target.checked})}/>{settings.language==='fa'?'تلاش برای پخش خودکار':'Try autoplay (browser dependent)'}</label>
          <label><Volume2 size={15}/>{settings.language==='fa'?'حجم صدای پیش‌فرض':'Default volume'}<Slider min="0" max="1" step="0.05" value={settings.defaultVolume} onChange={e=>update({defaultVolume:Number(e.target.value)})}/><span className="muted">{Math.round(settings.defaultVolume*100)}%</span></label>
          <label className="checkbox-row"><Checkbox checked={settings.autoReconnect} onChange={e=>update({autoReconnect:e.target.checked})}/>{settings.language==='fa'?'اتصال مجدد خودکار بدون زدن Continue':'Automatically reconnect on playback failure'}</label>
          <label>{settings.language==='fa'?'حداکثر تلاش مجدد':'Reconnect attempts'}<Select className="ui-input" value={settings.reconnectMaxAttempts} onChange={e=>update({reconnectMaxAttempts:Number(e.target.value)})}>{[3,5,8,12].map(n=><SelectOption key={n} value={n}>{n}</SelectOption>)}</Select></label>
          <label>{settings.language==='fa'?'کیفیت ترجیحی':'Preferred quality'}<Select className="ui-input" value={settings.preferredQuality} onChange={e=>update({preferredQuality:e.target.value==='auto'?'auto':Number(e.target.value)})}><SelectOption value="auto">Auto (adaptive)</SelectOption>{[240,360,480,720,1080,1440,2160].map(n=><SelectOption key={n} value={n}>{n}p</SelectOption>)}</Select></label>
          <label>{settings.language==='fa'?'بیت‌ریت ضبط':'Recording bitrate'}
            <Select className="ui-input" value={settings.recordingBitrate} onChange={e=>update({recordingBitrate:Number(e.target.value)})}>
              {[1_500_000,3_000_000,4_000_000,6_000_000,10_000_000].map(rate=><SelectOption key={rate} value={rate}>{rate/1_000_000} Mbps</SelectOption>)}
            </Select>
          </label>
          <label>{settings.language==='fa'?'سرعت پخش پیش‌فرض':'Default playback speed'}<Select className="ui-input" value={settings.defaultPlaybackRate} onChange={e=>update({defaultPlaybackRate:Number(e.target.value)})}>{[0.5,0.75,1,1.25,1.5,1.75,2].map(value=><SelectOption key={value} value={value}>{value}×</SelectOption>)}</Select></label>
        </div>
      </div>
      <div className="panel-card"><h3><Database size={20}/>{t('exportBackup')}</h3>
        <p className="muted">{settings.language==='fa'?'پشتیبان کامل: کانال‌ها، تگ‌ها، Favorites، منابع، تنظیمات پلیر، پروکسی، نتایج اسکن و تاریخچه.':'Full backup: channels, tags, favorites, playlists, player settings, proxy profiles, scan results and history.'}</p>
        <div className="form-stack">
          <label className="checkbox-row"><Checkbox checked={includeSecrets} onChange={e=>setIncludeSecrets(e.target.checked)}/>{settings.language==='fa'?'شامل توکن‌های دسترسی Worker در فایل خروجی (خطر امنیتی)':'Include Worker access tokens (sensitive!)'}</label>
          <label>{settings.language==='fa'?'روش بازیابی اطلاعات':'Restore method'}<Select className="ui-input" value={restoreMode} onChange={e=>setRestoreMode(e.target.value as RestoreMode)}><SelectOption value="merge">Merge with existing data</SelectOption><SelectOption value="replace">Replace all data</SelectOption></Select></label>
        </div>
        <div className="row-wrap"><Button variant="secondary" onClick={()=>downloadBackup(useYoutv.getState(),includeSecrets)}><Download size={16}/>{t('exportBackup')}</Button>
          <Button variant="outline" onClick={()=>file.current?.click()}><Upload size={16}/>{t('restoreBackup')}</Button>
          <FileInput hidden ref={file} accept=".json,application/json" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';void importFile(selected);}}/>
          <Button variant="outline" disabled={!channels.length} onClick={()=>downloadText(toM3u(channels),'youtv-channels.m3u','application/x-mpegurl')}><FileDown size={16}/>{t('exportM3u')}</Button>
        </div>{backupInfo&&<p className="muted">{backupInfo}</p>}
      </div>
      <div className="panel-card"><h3><Shield size={20}/>{t('security')}</h3><p className="muted">{t('security')}</p>
        <div className="info-box">Your Worker token is stored in LocalStorage in plaintext. Avoid shared devices and untrusted browser extensions. Tokens are excluded from exported backups.</div>
        <Button variant="destructive" onClick={()=>{if(window.confirm(`${t('confirmReset')}\n${t('resetWarning')}`)){reset();setMessage(t('success'));}}}><Trash2 size={16}/>{t('clearData')}</Button>
      </div>
    </div>{message&&<div className="toast-notice" role="status">{message}<ActionButton onClick={()=>setMessage('')}>×</ActionButton></div>}
  </section>;
}
