import {Select,SelectOption} from '@/components/ui/select';
import {Slider} from '@/components/ui/slider';
import {FileInput} from '@/components/ui/file-input';
import {ActionButton} from '@/components/ui/action-button';
import {useCallback,useEffect,useMemo,useRef,useState,type ChangeEvent,type KeyboardEvent as KeyEvent,type ReactNode,type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import Hls from 'hls.js';
import {Activity,AlertTriangle,AudioLines,Circle,Square,Download,BookOpen,Check,ChevronDown,Cloud,Captions,Copy,ExternalLink,Heart,Keyboard,Languages,Maximize,Minimize,MonitorPlay,Pause,Pin,PictureInPicture,Play,Radio,RefreshCw,Settings2,RotateCw,MoreHorizontal,SkipBack,SkipForward,SlidersHorizontal,Subtitles,Volume2,VolumeX,Wifi,WifiOff,X} from 'lucide-react';
import type {Channel,SubtitleSource,WorkerProfile} from '@youtv/shared';
import {useYoutv} from '@/stores/useYoutv';
import {activeWorker,proxyUrl,resolveStream,effectiveConnectionMode,needsHttpsRelay,type ConnectionOverride} from '@/lib/proxy';
import {isProbablyHls,secondsToClock,srtToVtt} from './mediaUtils';
import {TeletextPanel} from './TeletextPanel';
import {useLocalRecorder} from '@/features/recording/useLocalRecorder';
import {getHlsProfile,recoveryTarget,secondsBufferedAhead,hasActiveFragmentLoading} from './liveBuffer';
import {readableBytes} from '@/features/recording/recorder';
import {isAppleMobileBrowser,isBlockedMixedMedia,isInterruptedPlay,needsUserPlayGesture,selectPlaybackEngine} from './playbackSupport';
import {enterPlayerFullscreen,isElementFullscreen,isPlayerFullscreen,togglePlayerFullscreen} from './fullscreen';

type AudioOption={id:string;name:string;language:string};
type CaptionOption={id:string;name:string;language:string};
type QualityOption={id:number;name:string;height:number;bitrate:number};
type Menu='quality'|'audio'|'captions'|'appearance'|'speed'|'sources'|'keyboard'|'record'|'more'|null;
type NativeAudioTrack={label:string;language:string;enabled:boolean};
type NativeAudioList={length:number;[index:number]:NativeAudioTrack};
const translatedMedia:Record<string,Partial<Record<'ar'|'tr'|'ru',string>>>= {
  'Playback failed':{ar:'فشل التشغيل',tr:'Oynatma başarısız',ru:'Ошибка воспроизведения'},
  'Audio language':{ar:'لغة الصوت',tr:'Ses dili',ru:'Язык аудио'},
  'Subtitles':{ar:'الترجمة',tr:'Altyazılar',ru:'Субтитры'},
  'Quality':{ar:'الجودة',tr:'Kalite',ru:'Качество'},
  'Video quality':{ar:'جودة الفيديو',tr:'Video kalitesi',ru:'Качество видео'},
  'Caption appearance':{ar:'مظهر الترجمة',tr:'Altyazı görünümü',ru:'Вид субтитров'},
  'Caption style':{ar:'نمط الترجمة',tr:'Altyazı biçimi',ru:'Стиль субтитров'},
  'Stream sources':{ar:'مصادر البث',tr:'Yayın kaynakları',ru:'Источники потоков'},
  'Sources':{ar:'المصادر',tr:'Kaynaklar',ru:'Источники'},
  'Shortcuts':{ar:'اختصارات لوحة المفاتيح',tr:'Kısayollar',ru:'Горячие клавиши'},
  'Toggle captions':{ar:'تفعيل الترجمة',tr:'Altyazıları aç/kapat',ru:'Вкл./выкл. субтитры'},
  'Text size':{ar:'حجم النص',tr:'Yazı boyutu',ru:'Размер текста'},
  'Background':{ar:'الخلفية',tr:'Arka plan',ru:'Фон'},
  'Playback speed':{ar:'سرعة التشغيل',tr:'Oynatma hızı',ru:'Скорость воспроизведения'},
  'Off':{ar:'إيقاف',tr:'Kapalı',ru:'Выкл.'},
  'Load local SRT / VTT':{ar:'تحميل ملف ترجمة SRT/VTT',tr:'Yerel SRT/VTT yükle',ru:'Загрузить SRT/VTT'},
  'Primary source':{ar:'المصدر الرئيسي',tr:'Ana kaynak',ru:'Основной источник'},
  'Backup source':{ar:'المصدر البديل',tr:'Yedek kaynak',ru:'Резервный источник'},
  'Player diagnostics':{ar:'تشخيص المشغّل',tr:'Oynatıcı tanılama',ru:'Диагностика плеера'},
  'CONNECTION':{ar:'الاتصال',tr:'BAĞLANTI',ru:'СОЕДИНЕНИЕ'},
  'Playback route':{ar:'مسار التشغيل',tr:'Oynatma yolu',ru:'Маршрут воспроизведения'},
  'No alternative audio tracks exposed by the stream.':{ar:'لا تتوفر مسارات صوتية بديلة.',tr:'Alternatif ses parçası yok.',ru:'Дополнительные аудиодорожки отсутствуют.'},
  'No multiple renditions available or native HLS controls quality.':{ar:'لا تتوفر جودات متعددة لهذا البث.',tr:'Birden fazla kalite seçeneği yok.',ru:'Несколько вариантов качества недоступны.'}
};
const fallbackTranslation=(lang:string,fa:string,en:string)=>lang==='fa'?fa:(translatedMedia[en]?.[lang as 'ar'|'tr'|'ru']??en);

export default function PlayerStage({channel,bottomActions}:{channel:Channel;bottomActions?:ReactNode}){
  const {t}=useTranslation();
  const settings=useYoutv(s=>s.settings),workers=useYoutv(s=>s.workers);
  const updateSettings=useYoutv(s=>s.updateSettings),toggleFavorite=useYoutv(s=>s.toggleFavorite),togglePinned=useYoutv(s=>s.togglePinned);
  const language=settings.language;
  const appleMobile=typeof navigator!=='undefined'&&isAppleMobileBrowser(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);
  const playerRef=useRef<HTMLDivElement>(null),videoRef=useRef<HTMLVideoElement>(null),hlsRef=useRef<Hls|null>(null);
  const sourceUrls=useRef<string[]>([]),recoverCount=useRef(0);
  const retryTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const hideChromeTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const retryCountRef=useRef(0);
  const playbackWantedRef=useRef(settings.autoplay);
  const playbackEpochRef=useRef(0);
  const needsGestureRef=useRef(false);
  const userPausedRef=useRef(false);
  const lastProgressAtRef=useRef(Date.now());
  const healthySinceRef=useRef(Date.now());
  const lastTimeRef=useRef(0);
  const lastRecoveryRef=useRef(0);
  const inFlightFragmentsRef=useRef<Map<string,number>>(new Map());
  const [bufferAhead,setBufferAhead]=useState(0);
  const [liveLatency,setLiveLatency]=useState<number|null>(null);
  const [bufferedFragments,setBufferedFragments]=useState(0);
  const [lastFragmentMs,setLastFragmentMs]=useState<number|null>(null);
  const [stallCount,setStallCount]=useState(0);
  const reconnectOptionsRef=useRef({enabled:settings.autoReconnect,max:settings.reconnectMaxAttempts});
  reconnectOptionsRef.current={enabled:settings.autoReconnect,max:settings.reconnectMaxAttempts};
  const [retryInfo,setRetryInfo]=useState('');
  const [sourceIndex,setSourceIndex]=useState(0);
  const [override,setOverride]=useState<ConnectionOverride>('default'),[fallback,setFallback]=useState(false),[attempt,setAttempt]=useState(0);
  const [status,setStatus]=useState('idle'),[error,setError]=useState(''),[menu,setMenu]=useState<Menu>(null);
  const [showChrome,setShowChrome]=useState(true);
  const [rotatedFallback,setRotatedFallback]=useState(false);
  const [quality,setQuality]=useState(-1),[qualities,setQualities]=useState<QualityOption[]>([]);
  const [audio,setAudio]=useState(''),[audioOptions,setAudioOptions]=useState<AudioOption[]>([]);
  const [caption,setCaption]=useState('off'),[captions,setCaptions]=useState<CaptionOption[]>([]);
  const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(false),[volume,setVolume]=useState(settings.defaultVolume);
  const [current,setCurrent]=useState(0),[duration,setDuration]=useState(0),[buffered,setBuffered]=useState(0);
  const [isLive,setIsLive]=useState(false),[fullscreen,setFullscreen]=useState(false),[pip,setPip]=useState(false),[theater,setTheater]=useState(false);
  const [rate,setRate]=useState(settings.defaultPlaybackRate),[teletext,setTeletext]=useState(false),[diagnostics,setDiagnostics]=useState(false);
  const [localTrack,setLocalTrack]=useState<{id:string;label:string;url:string}|null>(null);
  const [remoteTracks,setRemoteTracks]=useState<{id:string;label:string;language:string;url:string}[]>([]);
  const canProxy=Boolean(activeWorker(channel,settings,workers));
  const sources=[channel.url,...(channel.alternateUrls||[])];
  const saveProgress=useYoutv(s=>s.saveProgress);
  const savedProgress=useYoutv(s=>s.resume[channel.id]||0);
  const effectiveMode=effectiveConnectionMode(channel,settings,override);
  const httpNeedsProxy=needsHttpsRelay(sources[sourceIndex]||channel.url);
  const displayedMode=httpNeedsProxy&&canProxy?'proxy':effectiveMode;
  const resolved=useMemo(()=>{
    try { const preferWorker=appleMobile&&effectiveMode==='auto'&&Boolean(activeWorker(channel,settings,workers))&&Boolean(channel.iptv.userAgent||channel.iptv.referer);
      const value=resolveStream({...channel,url:sources[sourceIndex]||channel.url,proxyMode:effectiveMode},settings,workers,fallback||preferWorker);return {value,error:''}; }
    catch(e){return {value:null,error:e instanceof Error?e.message:String(e)};}
  // Settings can change during playback, but only actual stream URL is used to initialize the engine.
  },[channel,settings,workers,override,fallback,sourceIndex,appleMobile,effectiveMode]);
  const streamUrl=resolved.value?.url??'';
  const recording=useLocalRecorder(videoRef,channel.name,`${channel.id}|${streamUrl}|${attempt}`);
  const rec=recording.snapshot;
  const recordingActive=['recording','paused','starting','saving'].includes(rec.phase);
  const hls=isProbablyHls(sources[sourceIndex]||channel.url,channel.format);
  const nativeHlsSupport=useMemo(()=>typeof document!=='undefined'&&!!document.createElement('video').canPlayType('application/vnd.apple.mpegurl'),[]);
  const hlsJsSupported=useMemo(()=>Hls.isSupported(),[]);
  const playbackEngine=selectPlaybackEngine({isHls:hls,nativeHls:nativeHlsSupport,hlsJsSupported,appleMobile});
  const currentWorker=resolved.value?.mode==='proxy'?resolved.value.worker:undefined;
  const tr=useCallback((fa:string,en:string)=>fallbackTranslation(language,fa,en),[language]);
  const clearRetry=useCallback(()=>{if(retryTimerRef.current){clearTimeout(retryTimerRef.current);retryTimerRef.current=null;}setRetryInfo('');},[]);
  const revealChrome=useCallback((sticky=false)=>{
    setShowChrome(true);
    if(hideChromeTimerRef.current){clearTimeout(hideChromeTimerRef.current);hideChromeTimerRef.current=null;}
    if(sticky||!playing||menu||teletext||diagnostics)return;
    hideChromeTimerRef.current=setTimeout(()=>setShowChrome(false),2200);
  },[playing,menu,teletext,diagnostics]);
  useEffect(()=>()=>{if(retryTimerRef.current)clearTimeout(retryTimerRef.current);if(hideChromeTimerRef.current)clearTimeout(hideChromeTimerRef.current);},[]);
  const reportPlayFailure=useCallback((reason:unknown,epoch:number)=>{
    // A previous source can still reject play() after a new source has loaded.
    if(epoch!==playbackEpochRef.current||isInterruptedPlay(reason))return;
    playbackWantedRef.current=false;
    needsGestureRef.current=needsUserPlayGesture(reason);
    setStatus(needsGestureRef.current?'needs-gesture':'playback-failed');
    if(!needsGestureRef.current)setError(reason instanceof Error?reason.message:String(reason));
  },[]);
  const requestPlayback=useCallback((video:HTMLVideoElement)=>{
    const epoch=playbackEpochRef.current;
    void video.play().catch(reason=>reportPlayFailure(reason,epoch));
  },[reportPlayFailure]);
  const reset=useCallback((mode:ConnectionOverride=override)=>{
    clearRetry();retryCountRef.current=0;healthySinceRef.current=Date.now();
    setError('');setStatus('retry');setFallback(false);setOverride(mode);setAttempt(v=>v+1);
  },[override,clearRetry]);
  const fail=useCallback((message:string)=>{
    if(retryTimerRef.current)return; // multiple HLS callbacks must not schedule duplicate retries
    const {enabled,max}=reconnectOptionsRef.current;
    const permanent=/\b(?:HTTP\s*)?(401|403|404|410)\b|codec|unsupported|mixed.content|HTTPS required|permission/i.test(message);
    if(appleMobile&&resolved.value?.mode==='direct'&&effectiveMode==='auto'&&!fallback&&canProxy&&!permanent){setStatus('proxy fallback');setFallback(true);return;}
    if(enabled&&!permanent&&retryCountRef.current<max){
      const number=++retryCountRef.current;
      const jitter=Math.floor(Math.random()*350);
      const delay=Math.min(14000,Math.round(1000*Math.pow(1.75,number-1)))+jitter;
      setError('');setStatus('reconnecting');setRetryInfo(`Reconnecting ${number}/${max} · ${Math.ceil(delay/1000)}s`);
      retryTimerRef.current=setTimeout(()=>{
        retryTimerRef.current=null;
        setRetryInfo('');healthySinceRef.current=Date.now();setAttempt(n=>n+1); // HLS engine and media source recreated without a click
      },delay);
      return;
    }
    retryCountRef.current=0;
    if(sourceIndex<sources.length-1){setStatus('switching source');setSourceIndex(n=>n+1);setError('');return;}
    if(effectiveMode==='auto'&&!fallback&&canProxy){setStatus('proxy fallback');setFallback(true);setError('');}
    else {setError(message);setStatus('error');}
  },[effectiveMode,fallback,canProxy,sourceIndex,channel.alternateUrls,appleMobile,resolved.value?.mode]);
  useEffect(()=>{
    clearRetry();retryCountRef.current=0;healthySinceRef.current=Date.now();playbackWantedRef.current=settings.autoplay&&!appleMobile;needsGestureRef.current=appleMobile&&settings.autoplay;
    setSourceIndex(0);setOverride('default');setFallback(false);setAttempt(0);setMenu(null);setTeletext(false);setLocalTrack(null);setCaption('off');setAudio('');setQuality(-1);setError('');setStatus('idle');
  // New channel resets reconnect state, not ordinary settings changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel.id,channel.url]);
  useEffect(()=>{setOverride('default');setFallback(false);},[settings.proxyMode]);
  // Subtitle URLs may be proxied too; SRT sidecars are fetched and converted to WebVTT in-browser.
  useEffect(()=>{
    const controller=new AbortController();const objectUrls:string[]=[];
    const prepare=async()=>{
      const list:{id:string;label:string;language:string;url:string}[]=[];
      for(const track of channel.subtitles||[]){
        try{
          let url=currentWorker?proxyUrl(track.url,currentWorker,'proxy'):track.url;
          if(track.format==='srt'){
            const response=await fetch(url,{signal:controller.signal});
            if(!response.ok)throw Error(`Subtitle HTTP ${response.status}`);
            const source=await response.text();
            url=URL.createObjectURL(new Blob([srtToVtt(source)],{type:'text/vtt'}));objectUrls.push(url);
          }
          list.push({id:track.id,label:track.label,language:track.language,url});
        }catch{ /* failed tracks are omitted, rather than breaking playback */ }
      }
      if(!controller.signal.aborted)setRemoteTracks(list);
    };void prepare();return()=>{controller.abort();for(const url of objectUrls)URL.revokeObjectURL(url);};
  },[channel.id,channel.subtitles,currentWorker?.baseUrl,currentWorker?.token]);

  const updateVideoTracks=useCallback(()=>{
    const video=videoRef.current;if(!video)return;
    const native=Array.from(video.textTracks).map((track,index)=>({id:`native:${index}`,name:track.label||track.language||`${track.kind} ${index+1}`,language:track.language||''}));
    const engine=hlsRef.current;
    if(engine){
      const hlsCaptions=engine.subtitleTracks.map((track,i)=>({id:`hls:${i}`,name:track.name||track.lang||`Subtitle ${i+1}`,language:track.lang||''}));
      setCaptions([...hlsCaptions,...native.filter(track=>!hlsCaptions.some(item=>item.language&&item.language===track.language&&item.name===track.name))]);
    }else setCaptions(native);
    const nativeAudio=(video as HTMLVideoElement&{audioTracks?:NativeAudioList}).audioTracks;
    if(!hlsRef.current&&nativeAudio){setAudioOptions(Array.from({length:nativeAudio.length},(_,index)=>({id:`native:${index}`,name:nativeAudio[index]?.label||`Audio ${index+1}`,language:nativeAudio[index]?.language||''})));}
  },[]);

  useEffect(()=>{
    const video=videoRef.current;if(!video)return;
    const refresh=()=>updateVideoTracks();
    refresh();video.textTracks.addEventListener('addtrack',refresh);video.textTracks.addEventListener('removetrack',refresh);
    return()=>{video.textTracks.removeEventListener('addtrack',refresh);video.textTracks.removeEventListener('removetrack',refresh);};
  },[updateVideoTracks,remoteTracks,localTrack,streamUrl]);
  useEffect(()=>{
    if(!settings.captionsEnabled||caption!=='off'||captions.length===0)return;
    const option=captions.find(item=>settings.preferredSubtitle&&item.language.toLowerCase().startsWith(settings.preferredSubtitle.toLowerCase()))??captions[0];
    if(!option)return;
    const engine=hlsRef.current;const video=videoRef.current;
    if(engine&&option.id.startsWith('hls:')){engine.subtitleTrack=Number(option.id.slice(4));engine.subtitleDisplay=true;}
    if(video&&option.id.startsWith('native:'))Array.from(video.textTracks).forEach((t,i)=>t.mode=option.id===`native:${i}`?'showing':'disabled');
    setCaption(option.id);
  },[captions,settings.captionsEnabled,settings.preferredSubtitle,caption]);
  const chooseCaption=useCallback((value:string)=>{
    const video=videoRef.current;const engine=hlsRef.current;
    if(engine){engine.subtitleTrack=value.startsWith('hls:')?Number(value.slice(4)):-1;engine.subtitleDisplay=value!=='off';}
    if(video)Array.from(video.textTracks).forEach((track,index)=>{track.mode=value===`native:${index}`?'showing':'disabled';});
    setCaption(value);updateSettings({captionsEnabled:value!=='off'});
    const matched=captions.find(item=>item.id===value);if(matched?.language)updateSettings({preferredSubtitle:matched.language});
  },[captions,updateSettings]);
  const chooseAudio=useCallback((value:string)=>{
    const engine=hlsRef.current;const video=videoRef.current;
    if(engine&&value.startsWith('hls:'))engine.audioTrack=Number(value.slice(4));
    else if(video&&value.startsWith('native:')){
      const tracks=(video as HTMLVideoElement&{audioTracks?:NativeAudioList}).audioTracks;
      if(tracks)for(let i=0;i<tracks.length;i++)tracks[i]!.enabled=i===Number(value.slice(7));
    }
    setAudio(value);const matched=audioOptions.find(v=>v.id===value);if(matched?.language)updateSettings({preferredAudio:matched.language});
  },[audioOptions,updateSettings]);

  useEffect(()=>{
    const video=videoRef.current;
    // Invalidate play() promises from an earlier source or retry.
    const playbackEpoch=++playbackEpochRef.current;
    if(!video||!streamUrl)return;
    recoverCount.current=0;inFlightFragmentsRef.current.clear();let disposed=false;lastProgressAtRef.current=Date.now();healthySinceRef.current=Date.now();
    setStatus('loading');setError('');setQualities([]);setQuality(-1);setAudioOptions([]);setCaptions([]);setIsLive(false);setCurrent(0);setBufferedFragments(0);setLastFragmentMs(null);setStallCount(0);
    video.volume=settings.defaultVolume;video.playbackRate=settings.defaultPlaybackRate;
    if(appleMobile)video.setAttribute('webkit-playsinline','');
    if(isBlockedMixedMedia(window.location.protocol,streamUrl)){
      if(effectiveMode==='auto'&&!fallback&&canProxy){setFallback(true);return;}
      setStatus('error');setError(tr('این کانال HTTP است. برای پخش روی GitHub Pages یک Worker فعال با آدرس HTTPS لازم است؛ آدرس اصلی کانال را تغییر نده.','An active HTTPS Worker is required to relay this HTTP stream on GitHub Pages. Keep the original HTTP source URL.'));return;
    }
    if(playbackEngine==='hlsjs'){
      const engine=new Hls({...getHlsProfile(settings.hlsLatencyMode)});hlsRef.current=engine;
      engine.on(Hls.Events.MANIFEST_PARSED,(_,data)=>{
        if(disposed)return;
        const levels=data.levels.map((level,i)=>({id:i,height:level.height||0,bitrate:level.bitrate||0,name:[level.height?`${level.height}p`:'',level.bitrate?`${Math.round(level.bitrate/1000)} kbps`:''].filter(Boolean).join(' · ')||`Level ${i+1}`}));
        setQualities(levels);
        if(settings.preferredQuality==='auto'){engine.nextLevel=-1;setQuality(-1);}
        else if(levels.length>1){
          const sorted=[...levels].sort((a,b)=>a.height-b.height);
          const selected=[...sorted].reverse().find(x=>x.height<=Number(settings.preferredQuality))||sorted[0];
          if(selected){engine.nextLevel=selected.id;setQuality(selected.id);}
        }
        setStatus('ready');
        setAudioOptions(engine.audioTracks.map((track,i)=>({id:`hls:${i}`,name:track.name||track.lang||`Audio ${i+1}`,language:track.lang||''})));
        if(engine.audioTracks.length&&engine.audioTrack>=0)setAudio(`hls:${engine.audioTrack}`);
        setCaptions(engine.subtitleTracks.map((track,i)=>({id:`hls:${i}`,name:track.name||track.lang||`Subtitle ${i+1}`,language:track.lang||''})));
        if(settings.preferredAudio){const i=engine.audioTracks.findIndex(track=>track.lang?.toLowerCase().startsWith(settings.preferredAudio.toLowerCase()));if(i>=0){engine.audioTrack=i;setAudio(`hls:${i}`);}}
        if(!settings.captionsEnabled){engine.subtitleTrack=-1;engine.subtitleDisplay=false;}
        if(settings.captionsEnabled){const i=engine.subtitleTracks.findIndex(track=>settings.preferredSubtitle?track.lang?.toLowerCase().startsWith(settings.preferredSubtitle.toLowerCase()):track.default);
          if(i>=0){engine.subtitleTrack=i;engine.subtitleDisplay=true;setCaption(`hls:${i}`);}}
      });
      engine.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>{if(!disposed)setAudioOptions(engine.audioTracks.map((track,i)=>({id:`hls:${i}`,name:track.name||track.lang||`Audio ${i+1}`,language:track.lang||''})));});
      engine.on(Hls.Events.SUBTITLE_TRACKS_UPDATED,()=>{if(!disposed)setCaptions(engine.subtitleTracks.map((track,i)=>({id:`hls:${i}`,name:track.name||track.lang||`Subtitle ${i+1}`,language:track.lang||''})));});
      engine.on(Hls.Events.LEVEL_LOADED,(_,data)=>{if(!disposed)setIsLive(data.details.live);});
      const fragmentStarted=new Map<string,number>();
      engine.on(Hls.Events.FRAG_LOADING,(_,data)=>{
        const key=`${data.frag.type}:${data.frag.sn}`;
        fragmentStarted.set(key,performance.now());
        inFlightFragmentsRef.current.set(key,Date.now());
      });
      engine.on(Hls.Events.FRAG_LOADED,(_,data)=>{
        inFlightFragmentsRef.current.delete(`${data.frag.type}:${data.frag.sn}`);
      });
      engine.on(Hls.Events.FRAG_BUFFERED,(_,data)=>{
        if(disposed)return;
        const key=`${data.frag.type}:${data.frag.sn}`;const started=fragmentStarted.get(key);
        if(started!==undefined){setLastFragmentMs(Math.round(performance.now()-started));fragmentStarted.delete(key);}
        inFlightFragmentsRef.current.delete(key);
        if(data.frag.type==='main')setBufferedFragments(n=>n+1);
      });
      engine.on(Hls.Events.ERROR,(_,data)=>{
        if(!data.fatal||disposed)return;
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR&&recoverCount.current++<2){engine.startLoad();return;}
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&recoverCount.current++<2){engine.recoverMediaError();return;}
        fail(`${data.details}${data.response?.code?` (HTTP ${data.response.code})`:''}`);
      });
      engine.on(Hls.Events.LEVEL_SWITCHED,()=>{if(!disposed&&engine.autoLevelEnabled)setQuality(-1);});
      engine.loadSource(streamUrl);engine.attachMedia(video);
    }else{
      hlsRef.current=null;
      if(playbackEngine==='unsupported'){setStatus('error');setError(tr('این مرورگر از فرمت HLS این منبع پشتیبانی نمی‌کند.','This browser cannot play this HLS stream.'));}
      else {video.src=streamUrl;video.load();}
    }
    return()=>{disposed=true;inFlightFragmentsRef.current.clear();if(playbackEpochRef.current===playbackEpoch)playbackEpochRef.current++;const engine=hlsRef.current;if(engine){engine.destroy();hlsRef.current=null;}video.removeAttribute('src');video.load();};
    // Playback changes only when channel/URL/retry changes, not volume, language or settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[streamUrl,attempt,channel.id,hls,playbackEngine,settings.hlsLatencyMode]);

  useEffect(()=>{
    if(hls)return;
    const video=videoRef.current;
    if(!video)return;
    const restore=()=>{if(savedProgress>5&&Number.isFinite(video.duration)&&video.duration-savedProgress>10)video.currentTime=savedProgress;};
    video.addEventListener('loadedmetadata',restore);return()=>video.removeEventListener('loadedmetadata',restore);
  // Resume only when the channel changes, not when progress is periodically saved.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel.id,hls]);
  useEffect(()=>{
    if(hls)return;
    const interval=setInterval(()=>{const video=videoRef.current;if(video&&Number.isFinite(video.duration)&&video.currentTime>0)saveProgress(channel.id,video.currentTime);},7000);
    return()=>clearInterval(interval);
  },[channel.id,hls,saveProgress]);
  useEffect(()=>{
    if(!('mediaSession' in navigator)||typeof MediaMetadata==='undefined')return;
    navigator.mediaSession.metadata=new MediaMetadata({title:channel.name,artist:channel.group||'YouTV',album:'YouTV',artwork:channel.logo?[{src:channel.logo}]:[]});
    navigator.mediaSession.setActionHandler('play',()=>{const video=videoRef.current;if(video){playbackWantedRef.current=true;userPausedRef.current=false;requestPlayback(video);}});
    navigator.mediaSession.setActionHandler('pause',()=>videoRef.current?.pause());
    navigator.mediaSession.setActionHandler('seekbackward',({seekOffset})=>{const v=videoRef.current;if(v)v.currentTime=Math.max(0,v.currentTime-(seekOffset||10));});
    navigator.mediaSession.setActionHandler('seekforward',({seekOffset})=>{const v=videoRef.current;if(v)v.currentTime=Math.min(v.duration||Infinity,v.currentTime+(seekOffset||10));});
    return()=>{for(const action of ['play','pause','seekbackward','seekforward'] as MediaSessionAction[]){try{navigator.mediaSession.setActionHandler(action,null);}catch{}}};
  },[channel.name,channel.group,channel.logo,requestPlayback]);
  const refreshTimeline=useCallback(()=>{
    const v=videoRef.current;if(!v)return;
    if(v.currentTime!==lastTimeRef.current){lastTimeRef.current=v.currentTime;lastProgressAtRef.current=Date.now();
      if(retryCountRef.current&&Date.now()-healthySinceRef.current>45000)retryCountRef.current=0;}
    setCurrent(v.currentTime||0);setDuration(Number.isFinite(v.duration)?v.duration:0);
    if(v.buffered.length)setBuffered(v.buffered.end(v.buffered.length-1));
    setBufferAhead(secondsBufferedAhead(v.currentTime,v.buffered));
    const engine=hlsRef.current;
    const nativeDelay=!engine&&!Number.isFinite(v.duration)&&v.seekable.length?Math.max(0,v.seekable.end(v.seekable.length-1)-v.currentTime):null;
    setLiveLatency(engine&&Number.isFinite(engine.latency)&&engine.latency>0?engine.latency:nativeDelay);
    if(!hlsRef.current)setIsLive(!Number.isFinite(v.duration)&&v.seekable.length>0);
  },[]);
  const progressMax=useMemo(()=>{
    const v=videoRef.current;
    if(isLive&&v?.seekable.length)return v.seekable.end(v.seekable.length-1);
    return duration;
  },[isLive,duration,current]);
  const progressMin=useMemo(()=>{
    const v=videoRef.current;
    return isLive&&v?.seekable.length?v.seekable.start(0):0;
  },[isLive,current]);
  const jumpLive=()=>{const v=videoRef.current;if(!v)return;const edge=hlsRef.current?.liveSyncPosition??(v.seekable.length?v.seekable.end(v.seekable.length-1):0);if(edge)v.currentTime=edge;};
  const seek=(value:number)=>{const v=videoRef.current;if(v&&Number.isFinite(value))v.currentTime=value;};
  const togglePlay=()=>{
    const v=videoRef.current;if(!v)return;
    if(v.paused){userPausedRef.current=false;playbackWantedRef.current=true;needsGestureRef.current=false;requestPlayback(v);}
    else {userPausedRef.current=true;playbackWantedRef.current=false;v.pause();}
  };
  useEffect(()=>{
    const id=setInterval(()=>{
      const video=videoRef.current;
      if(!video||!playbackWantedRef.current||video.paused||video.ended||video.seeking||retryTimerRef.current||status==='error')return;
      const now=Date.now();
      const stalledFor=now-lastProgressAtRef.current;
      if(stalledFor<2300)return;
      const engine=hlsRef.current;
      const recovery=recoveryTarget({current:video.currentTime,ranges:video.buffered,live:isLive,
        syncPosition:engine?.liveSyncPosition??null,latency:engine?.latency??0,targetLatency:engine?.targetLatency??null,stalledForMs:stalledFor});
      if(recovery!==null&&now-lastRecoveryRef.current>7000){
        lastRecoveryRef.current=now;lastProgressAtRef.current=now;video.currentTime=recovery;
        if(video.paused&&playbackWantedRef.current)requestPlayback(video);
        return;
      }
      if(engine){
        // A slow .ts fetch is not a dead stream. startLoad() can interrupt an
        // in-flight request and repeatedly throw away data on slow connections.
        const loading=hasActiveFragmentLoading(inFlightFragmentsRef.current.values(),now);
        if(loading)return;
      }
      // Give hls.js time to finish its own timeout/retry policy. Only rebuild
      // the player when no fragment is downloading and playback is truly stuck.
      const limit=engine?90000:65000;
      if(stalledFor>limit){lastProgressAtRef.current=now;fail(`Playback stalled for ${Math.round(limit/1000)}s`);}
    },1200);
    return()=>clearInterval(id);
  },[fail,status,isLive,requestPlayback]);
  const toggleFullscreen=()=>{void togglePlayerFullscreen(playerRef.current,videoRef.current);};
  const rotateScreen=async()=>{
    const player=playerRef.current;if(!player)return;
    if(!isPlayerFullscreen(document,videoRef.current))await enterPlayerFullscreen(player,videoRef.current);
    const orientation=screen.orientation as ScreenOrientation & {lock?:(orientation:'landscape')=>Promise<void>};
    if(!isElementFullscreen(document))return; // Native iOS video fullscreen handles orientation.
    if(!rotatedFallback&&orientation?.lock){try{await orientation.lock('landscape');setRotatedFallback(false);return;}catch{/* Fallback to CSS rotation */}}
    if(isElementFullscreen(document))setRotatedFallback(value=>!value);
  };
  const togglePip=()=>{const v=videoRef.current;if(!v)return;if(document.pictureInPictureElement)void document.exitPictureInPicture();else if(document.pictureInPictureEnabled)void v.requestPictureInPicture().catch(()=>undefined);};
  const onVideoKey=(event:KeyEvent<HTMLDivElement>)=>{
    const tag=(event.target as HTMLElement).tagName;if(['BUTTON','INPUT','SELECT','TEXTAREA'].includes(tag))return;
    switch(event.key.toLowerCase()){
      case ' ':case 'k':event.preventDefault();togglePlay();break;
      case 'f':event.preventDefault();toggleFullscreen();break;
      case 'm':event.preventDefault();{const v=videoRef.current;if(v)v.muted=!v.muted;}break;
      case 'c':event.preventDefault();chooseCaption(caption==='off'&&captions.length?captions[0]!.id:'off');break;
      case 'arrowleft':event.preventDefault();seek(Math.max(progressMin,current-10));break;
      case 'arrowright':event.preventDefault();seek(Math.min(progressMax,current+10));break;
      case 'arrowup':event.preventDefault();{const v=videoRef.current;if(v)v.volume=Math.min(1,v.volume+0.05);}break;
      case 'arrowdown':event.preventDefault();{const v=videoRef.current;if(v)v.volume=Math.max(0,v.volume-0.05);}break;
      default:break;
    }
  };
  const onSubtitleFile=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];if(!file)return;
    if(localTrack?.url)URL.revokeObjectURL(localTrack.url);
    const source=await file.text();const output=file.name.toLowerCase().endsWith('.srt')?srtToVtt(source):source;
    const url=URL.createObjectURL(new Blob([output],{type:'text/vtt'}));
    setLocalTrack({id:`local:${Date.now()}`,label:file.name,url});setStatus('Subtitle loaded');
    event.target.value='';
  };
  useEffect(()=>()=>{if(localTrack?.url)URL.revokeObjectURL(localTrack.url);},[localTrack]);
  useEffect(()=>{
    const video=videoRef.current;if(!video)return;
    const entered=()=>setPip(true),left=()=>setPip(false);
    video.addEventListener('enterpictureinpicture',entered);
    video.addEventListener('leavepictureinpicture',left);
    return()=>{video.removeEventListener('enterpictureinpicture',entered);video.removeEventListener('leavepictureinpicture',left);};
  },[]);
  useEffect(()=>{
    const video=videoRef.current;
    const handler=()=>{
      const active=isPlayerFullscreen(document,video);
      setFullscreen(active);
      if(!active){setRotatedFallback(false);try{screen.orientation?.unlock?.();}catch{/* Ignore unsupported unlock */}}
    };
    document.addEventListener('fullscreenchange',handler);
    document.addEventListener('webkitfullscreenchange',handler);
    video?.addEventListener('webkitbeginfullscreen',handler);
    video?.addEventListener('webkitendfullscreen',handler);
    handler();
    return()=>{
      document.removeEventListener('fullscreenchange',handler);
      document.removeEventListener('webkitfullscreenchange',handler);
      video?.removeEventListener('webkitbeginfullscreen',handler);
      video?.removeEventListener('webkitendfullscreen',handler);
    };
  },[]);
  useEffect(()=>{
    if(menu||teletext||diagnostics||!playing){revealChrome(true);return;}
    revealChrome();
  },[playing,menu,teletext,diagnostics,revealChrome]);
  const playerSettings=(menuName:Menu,label:string,icon:ReactNode)=><ActionButton className={`media-icon media-menu-${menuName}`} title={label} onClick={()=>setMenu(menu===menuName?null:menuName)} aria-label={label}>{icon}</ActionButton>;
  const videoTracks=remoteTracks.map(item=><track key={item.id} src={item.url} label={item.label} srcLang={item.language||'und'} kind="subtitles"/>);
  const allCaptions=captions;
  const trackList=[...remoteTracks,...(localTrack?[{...localTrack,language:''}]:[])];
  // Native TextTrack items include sidecars once the browser has loaded the <track> children.
  const captionChoices=allCaptions.length?allCaptions:trackList.map((track,i)=>({id:`native:${i}`,name:track.label,language:track.language}));
  const menuButton=(id:string,label:string,selected:boolean,action:()=>void)=><ActionButton key={id} className={`media-menu-option ${selected?'is-active':''}`} onClick={()=>{action();setMenu(null);}}><span>{label}</span>{selected&&<Check size={16}/>}</ActionButton>;

  return <div className={`player-wrapper professional-player ${theater?'is-theater':''}`}>
    <div className="player-shell">
      <div className={`pro-player ${rotatedFallback?'rotated-fallback ':''}${showChrome?'':'chrome-hidden'}`} ref={playerRef} tabIndex={0} onKeyDown={onVideoKey} onMouseMove={()=>revealChrome()} onPointerDown={()=>revealChrome()} onDoubleClick={e=>{if(e.target===videoRef.current)toggleFullscreen();}} dir="ltr" aria-label={`${channel.name} player`}>
        <video ref={videoRef} playsInline preload={appleMobile?'metadata':'auto'} crossOrigin={playbackEngine==='hlsjs'?'anonymous':undefined} autoPlay={settings.autoplay&&!appleMobile} className={`pro-media caption-${settings.captionSize} caption-bg-${settings.captionBackground}`}
          onTimeUpdate={refreshTimeline} onDurationChange={refreshTimeline} onProgress={refreshTimeline}
          onPlaying={()=>{userPausedRef.current=false;needsGestureRef.current=false;setPlaying(true);playbackWantedRef.current=true;lastProgressAtRef.current=Date.now();healthySinceRef.current=Date.now();setStatus('playing');setRetryInfo('');revealChrome();}} onPause={()=>{setPlaying(false);setStatus(previous=>userPausedRef.current?'paused':['error','reconnecting','needs-gesture'].includes(previous)?previous:'paused');revealChrome(true);}} onWaiting={()=>{if(playbackWantedRef.current||playing){setStatus('buffering');setStallCount(n=>n+1);revealChrome(true);}}}
          onCanPlay={()=>{setStatus(needsGestureRef.current?'needs-gesture':'ready');updateVideoTracks();if(playbackWantedRef.current&&videoRef.current?.paused)requestPlayback(videoRef.current);}}
          onLoadedMetadata={()=>{refreshTimeline();updateVideoTracks();}}
          onVolumeChange={e=>{setVolume(e.currentTarget.volume);setMuted(e.currentTarget.muted);}}
          onRateChange={e=>setRate(e.currentTarget.playbackRate)}
          onError={e=>{if(!hlsRef.current){const code=e.currentTarget.error?.code;const message=code===4?tr('فرمت یا کدک این شبکه در این دستگاه پشتیبانی نمی‌شود.','This device cannot decode the source format or codec.'):code===3?tr('دستگاه قادر به رمزگشایی ویدئو نیست.','The device cannot decode this video.'):tr('اتصال یا پخش این منبع ناموفق بود.','Media network or playback error.');if(code===3||code===4){setStatus('error');setError(message);}else fail(message);}}}
          >
          {videoTracks}{localTrack&&<track src={localTrack.url} label={localTrack.label} kind="subtitles" srcLang="und"/>}
        </video>
        {(status==='buffering'||status==='reconnecting')&&<div className="pro-buffer-indicator"><span className="pro-spinner"/>{retryInfo&&<span className="reconnect-info">{retryInfo}</span>}</div>}
        {(error||resolved.error)&&<div className="pro-error" role="alert"><AlertTriangle size={34}/><strong>{tr('پخش امکان‌پذیر نیست','Playback failed')}</strong><p dir="auto">{error||resolved.error}</p><div className="pro-error-actions"><ActionButton onClick={()=>reset()}><RefreshCw size={16}/>{t('retry')}</ActionButton>{canProxy&&<ActionButton onClick={()=>reset('proxy')}><Cloud size={16}/>{t('tryProxy')}</ActionButton>}</div></div>}
        {!error&&!resolved.error&&!playing&&(status==='paused'||status==='needs-gesture'||(appleMobile&&status==='loading')||(status==='ready'&&!playbackWantedRef.current))&&<ActionButton className="pro-center-play" onClick={togglePlay} aria-label={t('play')}><Play size={37} fill="currentColor"/></ActionButton>}
        <div className="pro-controls" onClick={e=>e.stopPropagation()}>
          <div className="pro-timeline"><Slider aria-label={tr('خط زمان','Seek')} min={progressMin||0} max={progressMax>progressMin?progressMax:1} step="0.1" value={Math.min(progressMax||1,Math.max(progressMin,current))} onChange={e=>seek(Number(e.target.value))} style={{'--seek-percent':`${progressMax>progressMin?((current-progressMin)/(progressMax-progressMin))*100:0}%`} as CSSProperties}/><div className="pro-buffered" style={{width:`${duration>0?Math.min(100,buffered/duration*100):0}%`}}/></div>
          <div className="pro-control-row">
            <div className="pro-control-group"><ActionButton className="media-icon" onClick={togglePlay} title={playing?'Pause':'Play'}>{playing?<Pause size={22} fill="currentColor"/>:<Play size={22} fill="currentColor"/>}</ActionButton>
              <ActionButton className="media-icon pro-seek-button" onClick={()=>seek(Math.max(progressMin,current-10))} title="-10 seconds"><SkipBack size={18}/></ActionButton>
              <ActionButton className="media-icon pro-seek-button" onClick={()=>seek(Math.min(progressMax,current+10))} title="+10 seconds"><SkipForward size={18}/></ActionButton>
              <ActionButton className="media-icon" onClick={()=>{const v=videoRef.current;if(v)v.muted=!v.muted;}} title={muted?'Unmute':'Mute'}>{muted||volume===0?<VolumeX size={19}/>:<Volume2 size={19}/>}</ActionButton>
              <Slider className="pro-volume" aria-label="Volume" min="0" max="1" step="0.01" value={volume} onChange={e=>{const v=videoRef.current;if(v){v.volume=Number(e.target.value);v.muted=false;}updateSettings({defaultVolume:Number(e.target.value)});}}/>
              <span className="pro-clock">{secondsToClock(current)}{!isLive&&duration>0?` / ${secondsToClock(duration)}`:''}</span>
              {isLive&&<ActionButton className="pro-latency-bottom" onClick={jumpLive} title={tr('بازگشت به لبه زنده پخش','Jump to live edge')} aria-label={tr('بازگشت به پخش زنده','Jump to live')}>{tr('تأخیر','Delay')} {liveLatency!==null&&Number.isFinite(liveLatency)?`~${Math.round(liveLatency)}s`:'—'}</ActionButton>}</div>
            <div className="pro-control-group">
              <ActionButton className={`media-icon pro-record-button ${recordingActive?'is-on':''}`} aria-label={tr('تنظیمات ضبط','Recording controls')}
                title={tr('ضبط کانال','Recording')}
                onClick={()=>setMenu(menu==='record'?null:'record')}>
                {recordingActive?<Square size={17} fill="currentColor"/>:<Circle size={18} fill="currentColor"/>}
              </ActionButton>
              <ActionButton className={`media-icon pro-caption-toggle ${caption!=='off'?'is-on':''}`} onClick={()=>chooseCaption(caption==='off'&&captionChoices.length?captionChoices[0]!.id:'off')} title={tr('روشن/خاموش کردن زیرنویس','Toggle captions')}><Captions size={21}/></ActionButton>
              {playerSettings('audio',tr('زبان صدا','Audio language'),<Languages size={19}/>)}
              {playerSettings('captions',tr('زیرنویس','Subtitles'),<Subtitles size={19}/>)}
              {playerSettings('quality',tr('کیفیت','Quality'),<SlidersHorizontal size={19}/>)}
              {sources.length>1&&playerSettings('sources',tr('منابع پخش','Sources'),<AudioLines size={19}/>)}
              {playerSettings('appearance',tr('تنظیمات زیرنویس','Caption appearance'),<Settings2 size={19}/>)}
              <ActionButton className="media-icon pro-more-button" onClick={()=>setMenu(menu==='more'?null:'more')} title={tr('گزینه‌های بیشتر','More controls')}><MoreHorizontal size={20}/></ActionButton>
              <ActionButton className="media-icon pro-extras" title="Teletext" onClick={()=>{setTeletext(v=>!v);setMenu(null);}}><BookOpen size={19}/></ActionButton>
              <ActionButton className="media-icon pro-extras" title="Picture in picture" onClick={togglePip} disabled={!document.pictureInPictureEnabled}><PictureInPicture size={19}/></ActionButton>
              <ActionButton className="media-icon pro-extras" title="Theater mode" onClick={()=>setTheater(v=>!v)}><MonitorPlay size={19}/></ActionButton>
              <ActionButton className="media-icon pro-rotate" onClick={()=>void rotateScreen()} title={tr('چرخش صفحه','Rotate screen')} aria-label={tr('چرخش صفحه','Rotate screen')}><RotateCw size={19}/></ActionButton>
              <ActionButton className="media-icon media-fullscreen" onClick={toggleFullscreen} title={tr(fullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه',fullscreen?'Exit fullscreen':'Fullscreen')} aria-label={tr(fullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه',fullscreen?'Exit fullscreen':'Fullscreen')}>{fullscreen?<Minimize size={19}/>:<Maximize size={19}/>}</ActionButton>
            </div>
          </div>
        </div>
        {menu&&<div className="pro-menu" role="dialog" aria-label="Player settings">
          <div className="pro-menu-head"><b>{({quality:tr('کیفیت ویدئو','Video quality'),audio:tr('زبان صدا','Audio language'),captions:tr('زیرنویس','Subtitles'),appearance:tr('شکل زیرنویس','Caption style'),speed:tr('سرعت','Speed'),sources:tr('منابع پخش','Stream sources'),keyboard:tr('میانبرها','Shortcuts'),record:tr('ضبط کانال','Recording'),more:tr('گزینه‌های بیشتر','More controls')})[menu]}</b><ActionButton className="media-icon" onClick={()=>setMenu(null)}><X size={18}/></ActionButton></div>
          <div className="pro-menu-options">
            {menu==='more'&&<div className="pro-more-list">
              <ActionButton className="media-menu-option" onClick={()=>setMenu('quality')}>{tr('کیفیت ویدئو','Video quality')} <SlidersHorizontal size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>setMenu('record')}>{tr('ضبط کانال','Recording controls')} <Circle size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>setMenu('audio')}>{tr('زبان صدا','Audio language')} <Languages size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>setMenu('captions')}>{tr('زیرنویس','Subtitles')} <Captions size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>setMenu('appearance')}>{tr('تنظیمات زیرنویس','Caption settings')} <Settings2 size={17}/></ActionButton>
              {sources.length>1&&<ActionButton className="media-menu-option" onClick={()=>setMenu('sources')}>{tr('منابع پخش','Sources')} <AudioLines size={17}/></ActionButton>}
              <ActionButton className="media-menu-option" onClick={()=>{setTeletext(true);setMenu(null);}}>Teletext <BookOpen size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>setMenu('speed')}>{tr('سرعت','Speed')} <ChevronDown size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{setTheater(v=>!v);setMenu(null);}}>{tr('حالت سینما','Theater mode')} <MonitorPlay size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{togglePip();setMenu(null);}} disabled={!document.pictureInPictureEnabled}>{tr('تصویر در تصویر','Picture in picture')} <PictureInPicture size={17}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{void rotateScreen();setMenu(null);}}>{tr('چرخش صفحه','Rotate screen')} <RotateCw size={17}/></ActionButton>
            </div>}
            {menu==='record'&&<div className="pro-record-options">
              <div className="pro-record-line"><span className={`youtv-record-indicator ${rec.phase==='recording'?'active':''}`}/><span>{rec.phase==='idle'?tr('آماده','Ready'):`${rec.phase} · ${Math.floor(rec.elapsedMs/1000)}s · ${readableBytes(rec.bytes)}`}</span></div>
              <label className="pro-setting-label">{tr('بیت‌ریت ضبط','Recording bitrate')}<Select value={settings.recordingBitrate} disabled={recordingActive} onChange={e=>updateSettings({recordingBitrate:Number(e.target.value)})}>
                {[1_500_000,3_000_000,4_000_000,6_000_000,10_000_000].map(value=><SelectOption key={value} value={value}>{value/1_000_000} Mbps</SelectOption>)}
              </Select></label>
              <div className="pro-record-actions">
                {!recordingActive&&<ActionButton disabled={!playing} onClick={()=>void recording.start(settings.recordingBitrate)}><Circle size={14} fill="currentColor"/>{tr('شروع ضبط','Record')}</ActionButton>}
                {rec.phase==='recording'&&<ActionButton onClick={recording.pause}><Pause size={14}/>{tr('مکث','Pause')}</ActionButton>}
                {rec.phase==='paused'&&<ActionButton onClick={recording.resume}><Play size={14}/>{tr('ادامه','Resume')}</ActionButton>}
                {recordingActive&&<ActionButton disabled={rec.phase==='starting'||rec.phase==='saving'} onClick={recording.stop}><Square size={14}/>{tr('پایان و ذخیره','Stop & save')}</ActionButton>}
                {rec.downloadUrl&&<ActionButton onClick={()=>{const link=document.createElement('a');link.href=rec.downloadUrl!;link.download=rec.filename;link.click();}}><Download size={14}/>{tr('دریافت فایل','Download')}</ActionButton>}
              </div>
              {rec.message&&<p className="pro-menu-note" role="status">{rec.message}</p>}
            </div>}
            {menu==='quality'&&<>{menuButton('auto','Auto (ABR)',quality===-1,()=>{if(hlsRef.current)hlsRef.current.nextLevel=-1;setQuality(-1);updateSettings({preferredQuality:'auto'});})}{qualities.map(q=>menuButton(String(q.id),q.name,quality===q.id,()=>{if(hlsRef.current)hlsRef.current.nextLevel=q.id;setQuality(q.id);if(q.height>0)updateSettings({preferredQuality:q.height});}))}{!qualities.length&&<p className="pro-menu-note">{tr('این استریم چندکیفیتی نیست یا مرورگر از HLS بومی استفاده می‌کند.','No multiple renditions available or native HLS controls quality.')}</p>}</>}
            {menu==='sources'&&sources.map((source,index)=>menuButton(`source-${index}`,index===0?tr('منبع اصلی','Primary source'):`${tr('منبع جایگزین','Backup source')} ${index}`,sourceIndex===index,()=>{setSourceIndex(index);setFallback(false);setError('');setStatus('switching source');}))}
            {menu==='audio'&&<>{audioOptions.map(q=>menuButton(q.id,`${q.name}${q.language?` (${q.language})`:''}`,audio===q.id,()=>chooseAudio(q.id)))}{!audioOptions.length&&<p className="pro-menu-note">{tr('ترک صوتی جداگانه‌ای در این منبع ارائه نشده است.','No alternative audio tracks exposed by the stream.')}</p>}</>}
            {menu==='captions'&&<>{menuButton('off',tr('خاموش','Off'),caption==='off',()=>chooseCaption('off'))}{captionChoices.map(q=>menuButton(q.id,`${q.name}${q.language?` · ${q.language}`:''}`,caption===q.id,()=>chooseCaption(q.id)))}<label className="pro-file-option"><Subtitles size={15}/>{tr('افزودن فایل SRT / VTT از دستگاه','Load local SRT / VTT')}<FileInput accept=".srt,.vtt,text/vtt" onChange={e=>void onSubtitleFile(e)}/></label></>}
            {menu==='appearance'&&<><label className="pro-setting-label">{tr('اندازه نوشته','Text size')}<Select value={settings.captionSize} onChange={e=>updateSettings({captionSize:e.target.value as 'small'|'medium'|'large'})}><SelectOption value="small">Small</SelectOption><SelectOption value="medium">Medium</SelectOption><SelectOption value="large">Large</SelectOption></Select></label><label className="pro-setting-label">{tr('پس زمینه','Background')}<Select value={settings.captionBackground} onChange={e=>updateSettings({captionBackground:e.target.value as 'none'|'shadow'|'box'})}><SelectOption value="none">None</SelectOption><SelectOption value="shadow">Shadow</SelectOption><SelectOption value="box">Black box</SelectOption></Select></label><ActionButton className="media-menu-option" onClick={()=>setMenu('speed')}>{tr('سرعت پخش','Playback speed')} <ChevronDown size={16}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{setTeletext(true);setMenu(null);}}>Teletext <BookOpen size={16}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{setTheater(v=>!v);setMenu(null);}}>Theater mode <MonitorPlay size={16}/></ActionButton>
              <ActionButton className="media-menu-option" onClick={()=>{togglePip();setMenu(null);}}>Picture in picture <PictureInPicture size={16}/></ActionButton></>}
            {menu==='speed'&&[0.5,0.75,1,1.25,1.5,1.75,2].map(x=>menuButton(String(x),`${x}×`,rate===x,()=>{const v=videoRef.current;if(v)v.playbackRate=x;updateSettings({defaultPlaybackRate:x});}))}
            {menu==='keyboard'&&<div className="pro-shortcuts">Space / K — Play · F — Fullscreen · M — Mute · C — Captions · ← → — 10s · ↑ ↓ — Volume</div>}
          </div>
        </div>}
        {teletext&&<TeletextPanel template={channel.teletextUrl} worker={currentWorker} usingProxy={Boolean(currentWorker)} onClose={()=>setTeletext(false)}/>}
      </div>
    </div>
    <div className="player-channel-info"><div className="player-channel-icon">{channel.logo?<img src={channel.logo} alt=""/>:<Radio size={25}/>}</div><div className="player-text"><h2>{channel.name}</h2><span className="muted">{channel.group||t('channels')}{channel.country?` · ${channel.country}`:''}{channel.language?` · ${channel.language}`:''}</span></div>
      <div className="player-tools"><ActionButton className={`player-quick-action ${channel.favorite?'action-on':''}`} aria-label="Favorite" aria-pressed={channel.favorite} onClick={()=>toggleFavorite(channel.id)}><Heart size={19} fill={channel.favorite?'currentColor':'none'}/></ActionButton><ActionButton className={`player-quick-action ${channel.pinned?'action-on':''}`} aria-label="Pin" aria-pressed={channel.pinned} onClick={()=>togglePinned(channel.id)}><Pin size={18}/></ActionButton><ActionButton className="player-quick-action" title="Copy URL" onClick={()=>void navigator.clipboard?.writeText(channel.url)}><Copy size={18}/></ActionButton>{bottomActions}<ActionButton className="player-quick-action" title="Shortcuts" onClick={()=>setMenu('keyboard')}><Keyboard size={18}/></ActionButton><ActionButton className={`player-quick-action ${diagnostics?'action-on':''}`} title="Diagnostics" onClick={()=>setDiagnostics(v=>!v)}><Activity size={18}/></ActionButton></div></div>
    {channel.description&&<p className="channel-about">{channel.description}</p>}
    {channel.tags.length>0&&<div className="watch-tag-row">{channel.tags.map(tag=><span key={tag}>#{tag}</span>)}</div>}
    <div className="player-connection-toolbar"><div><span className="eyebrow">{tr('اتصال','CONNECTION')}</span><strong>{tr('مسیر پخش','Playback route')}</strong>{httpNeedsProxy&&<small className="muted" role="status">{tr('HTTP با Worker','HTTP via Worker')}</small>}</div>
      <div className="connection-toggle" role="group" aria-label="Proxy route"><ActionButton className={displayedMode==='auto'?'selected':''} aria-pressed={displayedMode==='auto'} onClick={()=>reset('auto')}>{t('automatic')}</ActionButton><ActionButton className={displayedMode==='direct'?'selected':''} aria-pressed={displayedMode==='direct'} disabled={httpNeedsProxy} onClick={()=>reset('direct')}>{t('direct')}</ActionButton><ActionButton className={displayedMode==='proxy'?'selected':''} aria-pressed={displayedMode==='proxy'} disabled={!canProxy} onClick={()=>reset('proxy')}>{t('viaProxy')}</ActionButton></div>
      <div className="row-wrap"><ActionButton className="player-quick-action" onClick={()=>reset()} title="Reload"><RefreshCw size={17}/></ActionButton><a className="player-quick-action" href={channel.url} target="_blank" rel="noreferrer" title="Open source"><ExternalLink size={17}/></a></div></div>
    {diagnostics&&<div className="player-diagnostics"><strong><Activity size={16}/> {tr('گزارش پلیر','Player diagnostics')}</strong><div><span>Protocol</span><b>{hls?'HLS':'Native'}</b></div><div><span>Status</span><b>{status}</b></div><div><span>Quality</span><b>{quality<0?'Auto':qualities.find(q=>q.id===quality)?.name||'Manual'}</b></div><div><span>Audio tracks</span><b>{audioOptions.length}</b></div><div><span>Caption tracks</span><b>{captionChoices.length}</b></div><div><span>Source</span><b>{sourceIndex+1} / {sources.length}</b></div><div><span>Proxy</span><b>{resolved.value?.mode||'unavailable'}</b></div><div><span>Time / Buffer</span><b>{secondsToClock(current)} / {secondsToClock(buffered)}</b></div><div><span>Buffered ahead</span><b>{bufferAhead.toFixed(1)}s</b></div><div><span>Live latency</span><b>{liveLatency===null?'—':`${liveLatency.toFixed(1)}s`}</b></div><div><span>Segments buffered</span><b>{bufferedFragments}</b></div><div><span>Last segment load</span><b>{lastFragmentMs===null?'—':`${lastFragmentMs}ms`}</b></div><div><span>Buffering events</span><b>{stallCount}</b></div></div>}
  </div>;
}
