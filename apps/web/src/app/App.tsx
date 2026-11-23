import {Checkbox} from '@/components/ui/checkbox';
import {ActionButton} from '@/components/ui/action-button';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {HashRouter,useLocation,useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {House,Radio,Heart,History,ListVideo,Cloud,Settings,PanelRightClose,PanelRightOpen,Plus,Upload,ArrowLeft,ArrowRight,Play,ChevronRight,X,FolderOpen,Library,Activity,Menu,Search,Moon,Sun,Grid2x2} from 'lucide-react';
import type {Channel} from '@youtv/shared';
import {Button} from '@/components/ui/button';
import {SearchBox} from '@/components/ui/search-box';
import ChannelDialog from '@/features/channels/ChannelDialog';
import ChannelLibrary from '@/features/library/ChannelLibrary';
import PlaylistDialog from '@/features/playlists/PlaylistDialog';
import FolderSources from '@/features/playlists/FolderSources';
import PlayerStage from '@/features/player/PlayerStage';
import MultiViewTile from '@/features/player/MultiViewTile';
import ProxyPage from '@/features/proxy/ProxyPage';
import SettingsPage from '@/features/settings/SettingsPage';
import {useYoutv} from '@/stores/useYoutv';
import {getPersistenceError,subscribePersistenceError} from '@/lib/indexedDbStorage';
import {downloadBackup} from '@/lib/backup';
import {parseM3u} from '@/lib/playlist';
import {addMultiChannel,relatedToChannel,MAX_MULTI_VIEWS} from '@/lib/multiview';
import {FOLDER_SOURCE_PREFIX,isVisibleChannel,readBundledPlaylist} from '@/lib/builtin';
import {BUILTIN_PLAYLIST_ID} from '@youtv/shared';
import ConnectivityPage from '@/features/connectivity/ConnectivityPage';
import CategoriesPage from '@/features/categories/CategoriesPage';
import {startScan} from '@/lib/scanManager';
import {proxyUrl} from '@/lib/proxy';
import {formatWhen,normalizeError} from '@/lib/utils';
import {ui} from '@/lib/labels';
import i18n from '@/locales';

const primaryNav=[
  {path:'/',key:'home',icon:House},
  {path:'/channels',key:'channels',icon:Library},
  {path:'/groups',key:'groups',icon:FolderOpen},
  {path:'/favorites',key:'favorites',icon:Heart},
  {path:'/recent',key:'recent',icon:History},
] as const;
const toolNav=[
  {path:'/playlists',key:'playlists',icon:ListVideo},
  {path:'/connectivity',key:'healthCheck',icon:Activity},
] as const;
const systemNav=[
  {path:'/proxy',key:'proxy',icon:Cloud},
  {path:'/settings',key:'settings',icon:Settings},
] as const;

function Shell(){
  const {t}=useTranslation();
  const navigate=useNavigate(),location=useLocation();
  const allChannels=useYoutv(s=>s.channels),playlists=useYoutv(s=>s.playlists),workers=useYoutv(s=>s.workers),settings=useYoutv(s=>s.settings);
  const channels=allChannels.filter(c=>isVisibleChannel(c,settings));
  const [builtinError,setBuiltinError]=useState('');
  useEffect(()=>{
    if(!settings.defaultPlaylistEnabled || allChannels.some(c=>c.sourceId===BUILTIN_PLAYLIST_ID))return;
    const controller=new AbortController();
    void readBundledPlaylist(controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      if(useYoutv.getState().channels.some(c=>c.sourceId===BUILTIN_PLAYLIST_ID))return;
      useYoutv.getState().upsertChannels(result.channels,BUILTIN_PLAYLIST_ID);
      useYoutv.getState().savePlaylist({id:BUILTIN_PLAYLIST_ID,name:'YouTV Default',url:'',importedAt:Date.now(),refreshedAt:null,count:result.channels.length,refreshWorkerId:''});
    }).catch(error=>{if(!controller.signal.aborted)setBuiltinError(normalizeError(error));});
    return()=>controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[settings.defaultPlaylistEnabled]);
  const initialScanStarted=useRef(false);
  useEffect(()=>{
    if(!settings.healthCheckOnStartup||initialScanStarted.current||channels.length===0)return;
    if(settings.defaultPlaylistEnabled&&!allChannels.some(c=>c.sourceId===BUILTIN_PLAYLIST_ID)&&!builtinError)return;
    if(startScan(channels,settings,workers,batch=>useYoutv.getState().setHealth(batch)))initialScanStarted.current=true;
  },[settings.healthCheckOnStartup,settings.defaultPlaylistEnabled,channels.length,allChannels,builtinError,workers]);

  const updatePlaylist=useYoutv(s=>s.savePlaylist),upsert=useYoutv(s=>s.upsertChannels),removePlaylist=useYoutv(s=>s.removePlaylist),play=useYoutv(s=>s.playChannel);
  const [search,setSearch]=useState('');
  const [multiViewIds,setMultiViewIds]=useState<string[]>([]);
  const [multiEnabled,setMultiEnabled]=useState(false);
  const [audioTileId,setAudioTileId]=useState('');
  const [relatedExpanded,setRelatedExpanded]=useState(false);
  const [multiPickerOpen,setMultiPickerOpen]=useState(false);
  const [multiQuery,setMultiQuery]=useState('');
  const [sidebar,setSidebar]=useState(()=>{try{return localStorage.getItem('youtv:sidebar-collapsed')!=='1';}catch{return true;}});
  const [mobileDrawer,setMobileDrawer]=useState(false),[navQuery,setNavQuery]=useState('');
  const [edit,setEdit]=useState<Channel|null>(null),[channelDialog,setChannelDialog]=useState(false),[playlistDialog,setPlaylistDialog]=useState(false),[toast,setToast]=useState('');
  const [refreshing,setRefreshing]=useState<string|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const text=(key:Parameters<typeof ui>[0])=>ui(key,settings.language);
  const updateSettings=useYoutv(s=>s.updateSettings);
  const fa=['fa','ar'].includes(settings.language);
  useEffect(()=>{try{localStorage.setItem('youtv:sidebar-collapsed',sidebar?'0':'1');}catch{/* Storage may be disabled */}},[sidebar]);
  useEffect(()=>{setRelatedExpanded(false);},[location.pathname]);
  useEffect(()=>{setMobileDrawer(false);},[location.pathname]);
  useEffect(()=>{
    if(!mobileDrawer)return;
    const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')setMobileDrawer(false);};
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[mobileDrawer]);

  useEffect(()=>{
    document.documentElement.lang=settings.language;
    document.documentElement.dir=['fa','ar'].includes(settings.language)?'rtl':'ltr';
    document.documentElement.dataset.theme=settings.theme;
    const backgrounds:Record<string,string>={dark:'#14161e',light:'#ffffff',mint:'#ffffff',oled:'#07090b',ocean:'#0c2036',emerald:'#0e2019',violet:'#1d1730'};
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',backgrounds[settings.theme] ?? '#14161e');
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content',
      settings.theme==='light'||settings.theme==='mint'?'default':'black-translucent');
    void i18n.changeLanguage(settings.language);
  },[settings.language,settings.theme]);

  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|undefined;
      const isTyping=!!target?.closest('input,textarea,select,[contenteditable="true"]');
      if((e.key==='/'&&!isTyping)||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k')){
        e.preventDefault();navigate('/channels');searchRef.current?.focus();searchRef.current?.select();
      }
      if(e.key==='Escape'&&document.activeElement===searchRef.current){setSearch('');searchRef.current?.blur();}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[navigate]);

  const path=location.pathname,activeId=path.startsWith('/watch/')?decodeURIComponent(path.slice(7)):'';
  const activeChannel=channels.find(c=>c.id===activeId);
  const view=path.startsWith('/watch/')?'watch':path==='/proxy'?'proxy':path==='/settings'?'settings':path==='/connectivity'?'connectivity':path==='/groups'?'groups':path==='/playlists'?'playlists':path==='/favorites'?'favorites':path==='/recent'?'recent':'all';
  const watchIds=multiEnabled?Array.from(new Set([activeId,...multiViewIds])).filter(Boolean).slice(0,MAX_MULTI_VIEWS):[activeId].filter(Boolean);
  const multiChannels=watchIds.map(id=>channels.find(c=>c.id===id)).filter(Boolean) as Channel[];
  const relatedChannels=activeChannel?relatedToChannel(channels,activeChannel):[];
  const openWatch=(id:string)=>{play(id);navigate(`/watch/${encodeURIComponent(id)}`);window.scrollTo({top:0,behavior:'smooth'});};
  const focusMulti=(id:string)=>{if(id!==activeId){setMultiViewIds(previous=>addMultiChannel(id,previous.filter(item=>item!==id),activeId));setAudioTileId('');}openWatch(id);};
  const startMulti=()=>{
    if(multiEnabled){setMultiEnabled(false);setMultiViewIds([]);setMultiPickerOpen(false);return;}
    const second=relatedChannels.find(c=>c.id!==activeId);
    setMultiViewIds(second?[second.id]:[]);
    setAudioTileId(''); // Start muted so browser autoplay policies do not block the tiles.
    setMultiEnabled(true);
    setMultiPickerOpen(!second);
  };
  const addToMulti=(id:string)=>{
    if(id===activeId){startMulti();return;}
    setMultiEnabled(true);
    setMultiViewIds(previous=>addMultiChannel(activeId,previous,id));
  };
  const removeFromMulti=(id:string)=>{
    setMultiViewIds(previous=>previous.filter(item=>item!==id));
    if(audioTileId===id)setAudioTileId(activeId);
  };
  const clearMulti=()=>{setMultiEnabled(false);setMultiViewIds([]);setAudioTileId('');setMultiPickerOpen(false);};
  const multiCandidates=multiPickerOpen?channels.filter(c=>c.id!==activeId&&!watchIds.includes(c.id)&&`${c.name} ${c.group} ${c.country}`.toLocaleLowerCase().includes(multiQuery.toLocaleLowerCase().trim())).slice(0,36):[];
  const openGroup=(group:string)=>navigate(`/channels?group=${encodeURIComponent(group)}`);
  const showEdit=(channel:Channel)=>{setEdit(channel);setChannelDialog(true);};
  const showAdd=()=>{setEdit(null);setChannelDialog(true);};

  const refresh=async(playlistId:string)=>{
    const p=playlists.find(x=>x.id===playlistId);if(!p?.url)return;
    setRefreshing(p.id);
    try{
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
      let response:Response;
      try{
        const worker=workers.find(w=>w.id===p.refreshWorkerId&&w.enabled);
        const source=worker&&worker.token?proxyUrl(p.url,worker,'text'):p.url;
        response=await fetch(source,{signal:controller.signal,credentials:'omit'});
      }finally{clearTimeout(timeout);}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const content=await response.text();
      const result=parseM3u(content,p.url);
      upsert(result.channels,p.id,true);updatePlaylist({...p,count:result.channels.length,refreshedAt:Date.now()});setToast(`${result.channels.length} ${t('importSuccess')}`);
    }catch(e){setToast(`${t('error')}: ${normalizeError(e)}. ${t('sourceRequiresCors')}`);}
    finally{setRefreshing(null);}
  };

  const navButton=(item:{path:string;key:string;icon:typeof House},variant:'side'|'mobile'='side')=>{
    const Icon=item.icon;
    const active=path===item.path||(item.path==='/channels'&&view==='watch');
    return <ActionButton key={item.path} className={`${variant==='mobile'?'yt-mobile-nav-link':'yt-nav-link'} ${active?'is-active':''}`}
      onClick={()=>{navigate(item.path);setMobileDrawer(false);}} aria-current={active?'page':undefined} aria-label={t(item.key)} title={t(item.key)}>
      <Icon size={variant==='mobile'?20:19} strokeWidth={active?2.25:1.8}/><span className="yt-nav-text">{t(item.key)}</span>
    </ActionButton>;
  };
  const filteredNav=(items:readonly {path:string;key:string;icon:typeof House}[])=>items.filter(item=>!navQuery.trim()||t(item.key).toLocaleLowerCase().includes(navQuery.trim().toLocaleLowerCase()));

  const groupCount=new Set(channels.map(c=>c.group.trim()).filter(Boolean)).size;

  return <div className="app-root app-v2 yt-app-shell">
    <header className="yt-topbar">
      <div className="yt-header-commands">
        <Button variant="outline" className="yt-import-button" size="sm" onClick={()=>setPlaylistDialog(true)}><Upload size={17}/><span>{t('importPlaylist')}</span></Button>
        <Button className="yt-add-button" size="sm" onClick={showAdd}><Plus size={18}/><span>{t('addChannel')}</span></Button>
        <ActionButton className="yt-header-control yt-theme-toggle" onClick={()=>updateSettings({theme:settings.theme==='light'?'dark':settings.theme==='mint'?'emerald':settings.theme==='emerald'?'mint':'light'})}
          aria-label={settings.language==='fa'?'تغییر تم':'Toggle theme'} title={settings.language==='fa'?'تغییر تم':'Toggle theme'}>
          {settings.theme==='light'||settings.theme==='mint'?<Moon size={18}/>:<Sun size={18}/>}
        </ActionButton>
      </div>
      <div className="yt-header-search">
        <SearchBox inputRef={searchRef} value={search} onChange={value=>{setSearch(value);if(!['/','/channels','/favorites','/recent'].includes(path))navigate('/channels');}} placeholder={text('librarySearch')} ariaLabel={t('search')} className="yt-global-search"/>
      </div>
      <div className="yt-header-identity">
        <ActionButton className="yt-header-control yt-mobile-menu-toggle" onClick={()=>setMobileDrawer(v=>!v)}
          aria-controls="yt-desktop-sidebar" aria-expanded={mobileDrawer} aria-label={fa?'منوی بخش‌ها':'Navigation menu'}><Menu size={21}/></ActionButton>
        <ActionButton className="yt-brand" onClick={()=>navigate('/')} aria-label="YouTV home"><span className="yt-brand-icon"><Play size={18} fill="currentColor"/></span><span className="yt-brand-name">You<span>TV</span></span></ActionButton>
        <ActionButton className="yt-header-control yt-desktop-collapse" onClick={()=>{setSidebar(value=>!value);setNavQuery('');}}
          aria-controls="yt-desktop-sidebar" aria-expanded={sidebar} aria-label={sidebar?(fa?'بستن سایدبار':'Collapse sidebar'):(fa?'بازکردن سایدبار':'Expand sidebar')}
          title={sidebar?(fa?'بستن سایدبار':'Collapse sidebar'):(fa?'بازکردن سایدبار':'Expand sidebar')}>
          {sidebar?<PanelRightClose size={19}/>:<PanelRightOpen size={19}/>}
        </ActionButton>
      </div>
    </header>

    <div className="yt-shell-body" data-sidebar-collapsed={!sidebar} data-mobile-open={mobileDrawer}>
      <main className="yt-main" id="main-content">
        {view==='proxy'?<ProxyPage/>:view==='settings'?<SettingsPage/>:view==='connectivity'?<ConnectivityPage onWatch={openWatch} onGroup={openGroup}/>:view==='groups'?<CategoriesPage onOpen={openGroup}/>:view==='playlists'?<section className="page-content">
          <div className="page-heading"><div><div className="eyebrow">PLAYLIST STUDIO</div><h1><ListVideo size={28}/>{t('playlists')}</h1><p>{t('playlistImportNote')}</p></div><Button onClick={()=>setPlaylistDialog(true)}><Upload size={17}/>{t('importPlaylist')}</Button></div>
          <FolderSources/>
          <div className="folder-sources-heading imported-source-heading"><h2>{settings.language==='fa'?'منابع ثبت‌شده':'Imported playlists'}</h2><span className="muted">{playlists.filter(p=>!p.id.startsWith(FOLDER_SOURCE_PREFIX)).length.toLocaleString()} {settings.language==='fa'?'منبع':'sources'}</span></div>
          {playlists.filter(p=>!p.id.startsWith(FOLDER_SOURCE_PREFIX)).length>0&&
            <div className="playlist-grid">{playlists.filter(p=>!p.id.startsWith(FOLDER_SOURCE_PREFIX)).map(p=><div key={p.id} className="panel-card playlist-card"><div className="playlist-identity"><span className="playlist-icon"><ListVideo size={22}/></span><div><h3>{p.name}</h3><span className="muted">{p.count} {t('channelsCount')}</span></div></div>
              {p.id===BUILTIN_PLAYLIST_ID?<label className="checkbox-row"><Checkbox checked={settings.defaultPlaylistEnabled} onChange={e=>useYoutv.getState().updateSettings({defaultPlaylistEnabled:e.target.checked})}/> {settings.language==='fa'?'فعال بودن پلی‌لیست پیش‌فرض':'Enable bundled playlist'}</label>:p.url&&<div className="url-line" title={p.url}>{p.url}</div>}
              <small className="muted">{formatWhen(p.importedAt,settings.language)}</small>
              <div className="row-wrap"><Button size="sm" variant="secondary" onClick={()=>navigate('/channels')}>{t('viewChannels')}</Button>
              {p.url&&<Button disabled={refreshing===p.id} size="sm" variant="outline" onClick={()=>void refresh(p.id)}>{refreshing===p.id?t('importing'):t('refresh')}</Button>}
              {p.id!==BUILTIN_PLAYLIST_ID&&<Button size="sm" variant="ghost" onClick={()=>{if(confirm(`${t('removeSource')}?`))removePlaylist(p.id,confirm(t('removeChannels')));}}>{t('delete')}</Button>}</div>
            </div>)}</div>}
        </section>:view==='watch'?activeChannel?<section className="watch-layout">
          <div className="watch-main"><div className="watch-toolbar"><ActionButton className="back-link" onClick={()=>navigate('/channels')}>{settings.language==='en'?<ArrowLeft size={17}/>:<ArrowRight size={17}/>} {t('back')}</ActionButton></div>
            {multiEnabled?<div className="multiview-grid">{multiChannels.map(channel=><MultiViewTile key={channel.id} channel={channel} primary={channel.id===activeId} audible={audioTileId===channel.id} onAudio={()=>setAudioTileId(current=>current===channel.id?'':channel.id)} onFocus={()=>focusMulti(channel.id)} onRemove={()=>removeFromMulti(channel.id)}/>)}{multiChannels.length<2&&<div className="multiview-placeholder">{settings.language==='fa'?'برای افزودن شبکه از + در فهرست کناری استفاده کن.':'Add another channel using + in the related list.'}</div>}</div>:<PlayerStage channel={activeChannel} bottomActions={<ActionButton className="player-quick-action watch-multi-trigger" aria-label={settings.language==='fa'?'فعال‌کردن چندپخش':'Start multi-view'} title={settings.language==='fa'?'پخش همزمان':'Multi-view'} onClick={startMulti}><Grid2x2 size={19}/></ActionButton>}/>}
            {multiEnabled&&<div className="watch-multi-bottom"><ActionButton className="watch-chip is-on" onClick={clearMulti} aria-label={settings.language==='fa'?'خروج از پخش همزمان':'Exit multi-view'}><Grid2x2 size={16}/>{settings.language==='fa'?`پخش همزمان (${multiChannels.length})`:`Multi-view (${multiChannels.length})`}</ActionButton><ActionButton className="watch-chip" onClick={()=>setMultiPickerOpen(value=>!value)} disabled={multiChannels.length>=MAX_MULTI_VIEWS}><Plus size={15}/>{settings.language==='fa'?'افزودن شبکه':'Add channel'}</ActionButton><ActionButton className="watch-chip" onClick={clearMulti}><X size={15}/>{settings.language==='fa'?'خروج':'Exit'}</ActionButton></div>}
            {multiEnabled&&multiPickerOpen&&<div className="multi-channel-picker"><SearchBox size="compact" value={multiQuery} onChange={setMultiQuery} placeholder={settings.language==='fa'?'نام شبکه را جستجو کن':'Search channel'} ariaLabel={t('search')}/><div className="multi-picker-results">{multiCandidates.map(c=><ActionButton key={c.id} onClick={()=>{addToMulti(c.id);setMultiPickerOpen(false);setMultiQuery('');}}><span>{c.name}</span><small>{c.group}</small><Plus size={15}/></ActionButton>)}</div></div>}
          </div>
          <aside className={`watch-rail ${relatedExpanded?'is-expanded':''}`}><div className="watch-rail-heading"><h3>{settings.language==='fa'?'شبکه‌های مرتبط':'Related channels'}</h3><ActionButton onClick={()=>navigate('/channels')}>{text('viewAll')} <ChevronRight size={15}/></ActionButton></div>
            {relatedChannels.slice(0,relatedExpanded?60:12).map(c=><div key={c.id} className="next-channel-row"><ActionButton className="next-channel" onClick={()=>openWatch(c.id)}><span className="next-channel-image">{c.logo?<img loading="lazy" src={c.logo} alt=""/>:<Radio size={21}/>}</span><span><b>{c.name}</b><small>{c.sourceId===activeChannel.sourceId?(c.group||t('channels')):`${c.group||t('channels')}`}</small></span><ChevronRight size={17}/></ActionButton><ActionButton className={`next-channel-add ${watchIds.includes(c.id)?'is-on':''}`} aria-label={watchIds.includes(c.id)?'Remove from multiview':'Add to multiview'} onClick={()=>watchIds.includes(c.id)?removeFromMulti(c.id):addToMulti(c.id)} disabled={!watchIds.includes(c.id)&&watchIds.length>=MAX_MULTI_VIEWS}>{watchIds.includes(c.id)?<X size={15}/>:<Plus size={15}/>}</ActionButton></div>)}
            {relatedChannels.length>12&&<ActionButton className="watch-related-more" onClick={()=>setRelatedExpanded(value=>!value)}>{settings.language==='fa'?(relatedExpanded?'نمایش کمتر':`نمایش بیشتر (${relatedChannels.length})`):(relatedExpanded?'Show fewer':`Show more (${relatedChannels.length})`)}</ActionButton>}
          </aside></section>:<section className="page-content"><div className="refined-empty"><h2>{t('chooseChannel')}</h2><Button onClick={()=>navigate('/channels')}>{t('channels')}</Button></div></section>
          :<ChannelLibrary key={path+location.search} initialGroup={new URLSearchParams(location.search).get('group')||''} home={path==='/'} kind={view} search={search} onSearch={setSearch} onWatch={openWatch} onEdit={showEdit} onAdd={showAdd} onImport={()=>setPlaylistDialog(true)} onNavigate={navigate}/>}
      </main>
      <aside id="yt-desktop-sidebar" className="yt-sidebar" aria-label={fa?'منوی اصلی':'Main navigation'}>
        <div className="yt-sidebar-inner">
          <div className="yt-side-heading">
            <div className="yt-side-heading-icon"><Library size={20}/></div>
            <div className="yt-side-heading-copy"><strong>{fa?'کتابخانه':'Library'}</strong><small>{channels.length.toLocaleString()} {t('channelsCount')} · {groupCount.toLocaleString()} {t('groups')}</small></div>
            <ActionButton className="yt-drawer-close" aria-label={fa?'بستن منو':'Close menu'} onClick={()=>setMobileDrawer(false)}><X size={18}/></ActionButton>
          </div>
          <div className="yt-side-search">
            {(sidebar||mobileDrawer)?<SearchBox size="compact" value={navQuery} onChange={setNavQuery} placeholder={fa?'جستجو در بخش‌ها…':'Find a section…'} ariaLabel={fa?'جستجوی منو':'Search navigation'}/>:
              <ActionButton className="yt-side-search-compact" onClick={()=>setSidebar(true)} title={fa?'جستجوی بخش‌ها':'Search sections'} aria-label={fa?'گسترش و جستجوی منو':'Expand and search navigation'}><Search size={19}/></ActionButton>}
          </div>
          {filteredNav(primaryNav).length>0&&<section className="yt-nav-section">
            <h2 className="yt-section-caption">{fa?'بخش‌های اصلی':'Browse'}</h2>
            <nav aria-label={fa?'کتابخانه':'Library'}>{filteredNav(primaryNav).map(item=>navButton(item))}</nav>
          </section>}
          {filteredNav(toolNav).length>0&&<section className="yt-nav-section">
            <h2 className="yt-section-caption">{fa?'ابزارها':'Tools'}</h2>
            <nav aria-label={fa?'ابزارها':'Tools'}>{filteredNav(toolNav).map(item=>navButton(item))}</nav>
          </section>}
          {filteredNav(systemNav).length>0&&<section className="yt-nav-section yt-nav-system">
            <h2 className="yt-section-caption">{fa?'تنظیمات':'Settings'}</h2>
            <nav aria-label={fa?'تنظیمات':'Settings'}>{filteredNav(systemNav).map(item=>navButton(item))}</nav>
          </section>}
          <div className="yt-side-footer"><span className="yt-side-footer-indicator"/><span className="yt-side-footer-copy">YouTV Core</span></div>
        </div>
      </aside>
    </div>
    {mobileDrawer&&<ActionButton className="yt-drawer-scrim" onClick={()=>setMobileDrawer(false)} aria-label={fa?'بستن منو':'Close navigation'}/>}
    <nav className="yt-mobile-nav" aria-label={fa?'پیمایش موبایل':'Mobile navigation'}>
      {[primaryNav[0],primaryNav[1],primaryNav[2],primaryNav[3],systemNav[1]].map(item=>navButton(item,'mobile'))}
    </nav>
    <ChannelDialog open={channelDialog} onOpenChange={setChannelDialog} editing={edit}/>
    <PlaylistDialog open={playlistDialog} onOpenChange={setPlaylistDialog} onImported={()=>{setToast(t('importSuccess'));navigate('/playlists');}}/>
    {builtinError&&<div className="toast-notice" role="alert">Default playlist: {builtinError}<ActionButton onClick={()=>setBuiltinError('')}><X size={16}/></ActionButton></div>}
    {toast&&<div className="toast-notice" role="status">{toast}<ActionButton onClick={()=>setToast('')} aria-label={t('close')}><X size={16}/></ActionButton></div>}
  </div>;
}

export default function App(){
  // Async IndexedDB hydration must finish before the bundled playlist or any
  // other startup effects can modify the store, or restored channels are lost.
  const [hydrated,setHydrated]=useState(()=>useYoutv.persist.hasHydrated());
  const storageError=useSyncExternalStore(subscribePersistenceError,getPersistenceError,getPersistenceError);
  useEffect(()=>{
    const unsubscribe=useYoutv.persist.onFinishHydration(()=>setHydrated(true));
    if(useYoutv.persist.hasHydrated())setHydrated(true);
    return unsubscribe;
  },[]);
  const fa=useYoutv(s=>s.settings.language)==='fa';
  return <>
    {hydrated?<HashRouter><Shell/></HashRouter>:<div className="youtv-storage-loading" role="status">YouTV…</div>}
    {storageError&&<div className="youtv-storage-error" role="alert">
      <span>{storageError}</span>
      <ActionButton onClick={()=>downloadBackup(useYoutv.getState())}>
        {fa?'دریافت پشتیبان':'Export backup'}
      </ActionButton>
    </div>}
  </>;
}
