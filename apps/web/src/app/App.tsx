import {Checkbox} from '@/components/ui/checkbox';
import {ActionButton} from '@/components/ui/action-button';
import {useEffect,useRef,useState} from 'react';
import {HashRouter,useLocation,useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {House,Radio,Heart,History,ListVideo,Cloud,Settings,PanelRightClose,PanelRightOpen,Plus,Upload,ArrowLeft,ArrowRight,Play,ChevronRight,X,FolderOpen,Library,Activity,Menu,Search,Moon,Sun,Grid2x2} from 'lucide-react';
import type {Channel} from '@youtv/shared';
import {Button} from '@/components/ui/button';
import {SearchBox} from '@/components/ui/search-box';
import ChannelDialog from '@/features/channels/ChannelDialog';
import ChannelLibrary from '@/features/library/ChannelLibrary';
import PlaylistDialog from '@/features/playlists/PlaylistDialog';
import PlayerStage from '@/features/player/PlayerStage';
import ProxyPage from '@/features/proxy/ProxyPage';
import SettingsPage from '@/features/settings/SettingsPage';
import {useYoutv} from '@/stores/useYoutv';
import {parseM3u} from '@/lib/playlist';
import {isVisibleChannel,readBundledPlaylist} from '@/lib/builtin';
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
  const [multiViewIds,setMultiViewIds]=useState<string[]>(()=>{try{const raw=localStorage.getItem('youtv:multiview');return raw?JSON.parse(raw):[];}catch{return[];}});
  const [sidebar,setSidebar]=useState(()=>{try{return localStorage.getItem('youtv:sidebar-collapsed')!=='1';}catch{return true;}});
  const [mobileDrawer,setMobileDrawer]=useState(false),[navQuery,setNavQuery]=useState('');
  const [edit,setEdit]=useState<Channel|null>(null),[channelDialog,setChannelDialog]=useState(false),[playlistDialog,setPlaylistDialog]=useState(false),[toast,setToast]=useState('');
  const [refreshing,setRefreshing]=useState<string|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const text=(key:Parameters<typeof ui>[0])=>ui(key,settings.language);
  const updateSettings=useYoutv(s=>s.updateSettings);
  const fa=['fa','ar'].includes(settings.language);
  useEffect(()=>{try{localStorage.setItem('youtv:sidebar-collapsed',sidebar?'0':'1');}catch{/* Storage may be disabled */}},[sidebar]);
  useEffect(()=>{try{localStorage.setItem('youtv:multiview',JSON.stringify(multiViewIds.slice(0,6)));}catch{/* Storage may be disabled */}},[multiViewIds]);
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
  const watchIds=Array.from(new Set([activeId,...multiViewIds])).filter(Boolean).slice(0,6);
  const multiChannels=watchIds.map(id=>channels.find(c=>c.id===id)).filter(Boolean) as Channel[];
  const relatedMap=new Map<string,Channel>();
  if(activeChannel){
    for(const channel of channels){if(channel.id!==activeId&&activeChannel.sourceId&&channel.sourceId===activeChannel.sourceId&&activeChannel.group&&channel.group===activeChannel.group)relatedMap.set(channel.id,channel);}
    for(const channel of channels){if(channel.id!==activeId&&activeChannel.sourceId&&channel.sourceId===activeChannel.sourceId)relatedMap.set(channel.id,channel);}
    for(const channel of channels){if(channel.id!==activeId&&activeChannel.group&&channel.group===activeChannel.group)relatedMap.set(channel.id,channel);}
    for(const channel of channels){if(channel.id!==activeId&&channel.tags.some(tag=>activeChannel.tags.includes(tag)))relatedMap.set(channel.id,channel);}
    for(const channel of channels){if(channel.id!==activeId)relatedMap.set(channel.id,channel);if(relatedMap.size>=120)break;}
  }
  const relatedChannels=[...relatedMap.values()].slice(0,80);
  const openWatch=(id:string)=>{play(id);navigate(`/watch/${encodeURIComponent(id)}`);window.scrollTo({top:0,behavior:'smooth'});};
  const addToMulti=(id:string)=>setMultiViewIds(prev=>Array.from(new Set([activeId||id,...prev,id])).filter(Boolean).slice(0,6));
  const removeFromMulti=(id:string)=>setMultiViewIds(prev=>prev.filter(item=>item!==id));
  const clearMulti=()=>setMultiViewIds([]);
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
      const content=await response.text();if(content.length>15_000_000)throw new Error('Playlist too large');
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
        <ActionButton className="yt-header-control yt-theme-toggle" onClick={()=>updateSettings({theme:settings.theme==='light'?'dark':'light'})}
          aria-label={settings.language==='fa'?'تغییر تم':'Toggle theme'} title={settings.language==='fa'?'تغییر تم':'Toggle theme'}>
          {settings.theme==='light'?<Moon size={18}/>:<Sun size={18}/>}
        </ActionButton>
      </div>
      <div className="yt-header-search">
        <SearchBox inputRef={searchRef} value={search} onChange={value=>{setSearch(value);if(!['/','/channels','/favorites','/recent'].includes(path))navigate('/channels');}} placeholder={text('librarySearch')} ariaLabel={t('search')} className="yt-global-search"/>
      </div>
      <div className="yt-header-identity">
        <ActionButton className="yt-brand" onClick={()=>navigate('/')} aria-label="YouTV home"><span className="yt-brand-icon"><Play size={18} fill="currentColor"/></span><span className="yt-brand-name">You<span>TV</span></span></ActionButton>
        <ActionButton className="yt-header-control yt-desktop-collapse" onClick={()=>{setSidebar(value=>!value);setNavQuery('');}}
          aria-controls="yt-desktop-sidebar" aria-expanded={sidebar} aria-label={sidebar?(fa?'بستن سایدبار':'Collapse sidebar'):(fa?'بازکردن سایدبار':'Expand sidebar')}
          title={sidebar?(fa?'بستن سایدبار':'Collapse sidebar'):(fa?'بازکردن سایدبار':'Expand sidebar')}>
          {sidebar?<PanelRightClose size={19}/>:<PanelRightOpen size={19}/>}
        </ActionButton>
        <ActionButton className="yt-header-control yt-mobile-menu-toggle" onClick={()=>setMobileDrawer(v=>!v)}
          aria-controls="yt-desktop-sidebar" aria-expanded={mobileDrawer} aria-label={fa?'منوی بخش‌ها':'Navigation menu'}><Menu size={21}/></ActionButton>
      </div>
    </header>

    <div className="yt-shell-body" data-sidebar-collapsed={!sidebar} data-mobile-open={mobileDrawer}>
      <main className="yt-main" id="main-content">
        {view==='proxy'?<ProxyPage/>:view==='settings'?<SettingsPage/>:view==='connectivity'?<ConnectivityPage onWatch={openWatch} onGroup={openGroup}/>:view==='groups'?<CategoriesPage onOpen={openGroup}/>:view==='playlists'?<section className="page-content">
          <div className="page-heading"><div><div className="eyebrow">PLAYLIST STUDIO</div><h1><ListVideo size={28}/>{t('playlists')}</h1><p>{t('playlistImportNote')}</p></div><Button onClick={()=>setPlaylistDialog(true)}><Upload size={17}/>{t('importPlaylist')}</Button></div>
          {!playlists.length?<div className="refined-empty"><div className="empty-orb"><ListVideo size={36}/></div><h2>{t('noPlaylists')}</h2><p>{t('playlistImportNote')}</p><Button onClick={()=>setPlaylistDialog(true)}>{t('importPlaylist')}</Button></div>:
            <div className="playlist-grid">{playlists.map(p=><div key={p.id} className="panel-card playlist-card"><div className="playlist-identity"><span className="playlist-icon"><ListVideo size={22}/></span><div><h3>{p.name}</h3><span className="muted">{p.count} {t('channelsCount')}</span></div></div>
              {p.id===BUILTIN_PLAYLIST_ID?<label className="checkbox-row"><Checkbox checked={settings.defaultPlaylistEnabled} onChange={e=>useYoutv.getState().updateSettings({defaultPlaylistEnabled:e.target.checked})}/> {settings.language==='fa'?'فعال بودن پلی‌لیست پیش‌فرض':'Enable bundled playlist'}</label>:p.url&&<div className="url-line" title={p.url}>{p.url}</div>}
              <small className="muted">{formatWhen(p.importedAt,settings.language)}</small>
              <div className="row-wrap"><Button size="sm" variant="secondary" onClick={()=>navigate('/channels')}>{t('viewChannels')}</Button>
              {p.url&&<Button disabled={refreshing===p.id} size="sm" variant="outline" onClick={()=>void refresh(p.id)}>{refreshing===p.id?t('importing'):t('refresh')}</Button>}
              {p.id!==BUILTIN_PLAYLIST_ID&&<Button size="sm" variant="ghost" onClick={()=>{if(confirm(`${t('removeSource')}?`))removePlaylist(p.id,confirm(t('removeChannels')));}}>{t('delete')}</Button>}</div>
            </div>)}</div>}
        </section>:view==='watch'?activeChannel?<section className="watch-layout">
          <div className="watch-main"><div className="watch-toolbar"><ActionButton className="back-link" onClick={()=>navigate('/channels')}>{settings.language==='en'?<ArrowLeft size={17}/>:<ArrowRight size={17}/>} {t('back')}</ActionButton><div className="row-wrap watch-toolbar-actions"><ActionButton className={`watch-chip ${watchIds.includes(activeId)?'is-on':''}`} onClick={()=>addToMulti(activeId)}><Grid2x2 size={16}/> {settings.language==='fa'?`چندپخش ${multiChannels.length}`:`Multi ${multiChannels.length}`}</ActionButton>{multiChannels.length>1&&<ActionButton className="watch-chip" onClick={clearMulti}><X size={15}/> {settings.language==='fa'?'خروج':'Clear'}</ActionButton>}</div></div>
            {multiChannels.length>1?<div className="multiview-grid">{multiChannels.map(channel=><section key={channel.id} className={`multiview-tile ${channel.id===activeId?'is-primary':''}`}><div className="multiview-head"><strong>{channel.name}</strong><div className="row-wrap">{channel.id!==activeId&&<ActionButton className="watch-chip" onClick={()=>openWatch(channel.id)}>{settings.language==='fa'?'اصلی':'Focus'}</ActionButton>}{channel.id!==activeId&&<ActionButton className="watch-chip" onClick={()=>removeFromMulti(channel.id)}><X size={14}/></ActionButton>}</div></div><PlayerStage channel={channel}/></section>)}</div>:<PlayerStage channel={activeChannel}/>}
          </div>
          <aside className="watch-rail"><div className="watch-rail-heading"><h3>{settings.language==='fa'?'شبکه‌های مرتبط':'Related channels'}</h3><ActionButton onClick={()=>navigate('/channels')}>{text('viewAll')} <ChevronRight size={15}/></ActionButton></div>
            {relatedChannels.map(c=><div key={c.id} className="next-channel-row"><ActionButton className="next-channel" onClick={()=>openWatch(c.id)}><span className="next-channel-image">{c.logo?<img loading="lazy" src={c.logo} alt=""/>:<Radio size={21}/>}</span><span><b>{c.name}</b><small>{c.sourceId===activeChannel.sourceId?(c.group||t('channels')):`${c.group||t('channels')}`}</small></span><ChevronRight size={17}/></ActionButton><ActionButton className={`next-channel-add ${watchIds.includes(c.id)?'is-on':''}`} aria-label={watchIds.includes(c.id)?'Remove from multiview':'Add to multiview'} onClick={()=>watchIds.includes(c.id)?removeFromMulti(c.id):addToMulti(c.id)}>{watchIds.includes(c.id)?<X size={15}/>:<Plus size={15}/>}</ActionButton></div>)}
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
    <PlaylistDialog open={playlistDialog} onOpenChange={setPlaylistDialog} onImported={()=>{setToast(t('importSuccess'));navigate('/channels');}}/>
    {builtinError&&<div className="toast-notice" role="alert">Default playlist: {builtinError}<ActionButton onClick={()=>setBuiltinError('')}><X size={16}/></ActionButton></div>}
    {toast&&<div className="toast-notice" role="status">{toast}<ActionButton onClick={()=>setToast('')} aria-label={t('close')}><X size={16}/></ActionButton></div>}
  </div>;
}

export default function App(){return <HashRouter><Shell/></HashRouter>;}
