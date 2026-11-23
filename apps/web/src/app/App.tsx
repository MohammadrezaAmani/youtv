import {Checkbox} from '@/components/ui/checkbox';
import {ActionButton} from '@/components/ui/action-button';
import {useEffect,useRef,useState} from 'react';
import {HashRouter,useLocation,useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {House,Radio,Heart,History,ListVideo,Cloud,Settings,PanelLeftClose,PanelLeftOpen,Plus,Upload,ArrowLeft,ArrowRight,Play,ChevronRight,X,FolderOpen,Library,Activity} from 'lucide-react';
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
  const [search,setSearch]=useState(''),[sidebar,setSidebar]=useState(true),[edit,setEdit]=useState<Channel|null>(null),[channelDialog,setChannelDialog]=useState(false),[playlistDialog,setPlaylistDialog]=useState(false),[toast,setToast]=useState('');
  const [refreshing,setRefreshing]=useState<string|null>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const text=(key:Parameters<typeof ui>[0])=>ui(key,settings.language);

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
  const openWatch=(id:string)=>{play(id);navigate(`/watch/${encodeURIComponent(id)}`);window.scrollTo({top:0,behavior:'smooth'});};
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

  const navButton=(item:{path:string;key:string;icon:typeof House},mini=false)=>{
    const Icon=item.icon;
    const active=path===item.path||(item.path==='/channels'&&view==='watch');
    return <ActionButton key={item.path} className={`${mini?'bottom-nav-item':'sidebar-link'} ${active?'is-active':''}`} onClick={()=>navigate(item.path)} aria-current={active?'page':undefined} title={t(item.key)}>
      <span className="sidebar-link-icon"><Icon size={mini?20:18} strokeWidth={active?2.4:1.9}/></span>
      <span>{t(item.key)}</span>
    </ActionButton>;
  };

  const groupCount=new Set(channels.map(c=>c.group.trim()).filter(Boolean)).size;

  return <div className="app-root app-v2">
    <header className="site-header">
      <div className="header-brand-wrap">
        <div className="header-brand">
          <ActionButton className="header-icon desktop-only" title={sidebar?'Collapse sidebar':'Expand sidebar'} onClick={()=>setSidebar(v=>!v)}>{sidebar?<PanelLeftClose size={20}/>:<PanelLeftOpen size={20}/>}</ActionButton>
          <ActionButton className="brand" onClick={()=>navigate('/')} aria-label="YouTV home"><span className="brand-mark"><Play fill="currentColor" size={18}/></span><span>You<span className="brand-accent">TV</span></span><span className="brand-version">CORE</span></ActionButton>
        </div>
        <div className="header-summary desktop-only"><span>{channels.length.toLocaleString()} {t('channelsCount')}</span><span>{groupCount.toLocaleString()} {t('groups')}</span></div>
      </div>
      <div className="header-center">
        <SearchBox inputRef={searchRef} value={search} onChange={value=>{setSearch(value);if(!['/','/channels','/favorites','/recent'].includes(path))navigate('/channels');}} placeholder={text('librarySearch')} ariaLabel={t('search')} className="header-searchbox"/>
      </div>
      <div className="header-actions">
        <Button variant="ghost" className="desktop-only" size="sm" onClick={()=>setPlaylistDialog(true)}><Upload size={17}/>{t('importPlaylist')}</Button>
        <Button size="sm" onClick={showAdd}><Plus size={18}/><span className="button-label">{t('addChannel')}</span></Button>
      </div>
    </header>

    <div className="app-body">
      <aside className={`sidebar ${sidebar?'':'sidebar-collapsed'}`}>
        <div className="sidebar-topcard">
          <strong>{settings.language==='fa'?'YouTV Core':'YouTV Core'}</strong>
          <span>{channels.length.toLocaleString()} {t('channelsCount')} · {groupCount.toLocaleString()} {t('groups')}</span>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">{settings.language==='fa'?'مرور':'Browse'}</div>
          <nav aria-label="Main">{primaryNav.map(item=>navButton(item))}</nav>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-label">{settings.language==='fa'?'ابزارها':'Tools'}</div>
          <nav aria-label="Tools">{toolNav.map(item=>navButton(item))}</nav>
        </div>
        <div className="sidebar-section sidebar-system">
          <div className="sidebar-label">{t('settings')}</div>
          <nav aria-label="Settings">{systemNav.map(item=>navButton(item))}</nav>
        </div>
      </aside>

      <main className="main-area">
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
          <div className="watch-main"><ActionButton className="back-link" onClick={()=>navigate('/channels')}>{settings.language==='en'?<ArrowLeft size={17}/>:<ArrowRight size={17}/>} {t('back')}</ActionButton>
            <PlayerStage channel={activeChannel}/></div>
          <aside className="watch-rail"><div className="watch-rail-heading"><h3>{t('channels')}</h3><ActionButton onClick={()=>navigate('/channels')}>{text('viewAll')} <ChevronRight size={15}/></ActionButton></div>
            {channels.filter(c=>c.id!==activeId).slice(0,80).map(c=><ActionButton key={c.id} className="next-channel" onClick={()=>openWatch(c.id)}><span className="next-channel-image">{c.logo?<img loading="lazy" src={c.logo} alt=""/>:<Radio size={21}/>}</span><span><b>{c.name}</b><small>{c.group||t('channels')}</small></span><ChevronRight size={17}/></ActionButton>)}
          </aside></section>:<section className="page-content"><div className="refined-empty"><h2>{t('chooseChannel')}</h2><Button onClick={()=>navigate('/channels')}>{t('channels')}</Button></div></section>
          :<ChannelLibrary key={path+location.search} initialGroup={new URLSearchParams(location.search).get('group')||''} home={path==='/'} kind={view} search={search} onSearch={setSearch} onWatch={openWatch} onEdit={showEdit} onAdd={showAdd} onImport={()=>setPlaylistDialog(true)} onNavigate={navigate}/>}
      </main>
    </div>

    <nav className="mobile-bottom" aria-label="Mobile navigation">{[primaryNav[0],primaryNav[1],primaryNav[2],primaryNav[3],systemNav[0],systemNav[1]].map(item=>navButton(item,true))}</nav>
    <ChannelDialog open={channelDialog} onOpenChange={setChannelDialog} editing={edit}/>
    <PlaylistDialog open={playlistDialog} onOpenChange={setPlaylistDialog} onImported={()=>{setToast(t('importSuccess'));navigate('/channels');}}/>
    {builtinError&&<div className="toast-notice" role="alert">Default playlist: {builtinError}<ActionButton onClick={()=>setBuiltinError('')}><X size={16}/></ActionButton></div>}
    {toast&&<div className="toast-notice" role="status">{toast}<ActionButton onClick={()=>setToast('')} aria-label={t('close')}><X size={16}/></ActionButton></div>}
  </div>;
}

export default function App(){return <HashRouter><Shell/></HashRouter>;}
