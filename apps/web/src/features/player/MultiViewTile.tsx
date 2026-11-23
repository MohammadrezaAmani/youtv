import {useEffect,useMemo,useRef,useState} from 'react';
import Hls from 'hls.js';
import {Maximize2,Minimize2,Pause,Play,RefreshCw,Volume2,VolumeX,X} from 'lucide-react';
import type {Channel} from '@youtv/shared';
import {ActionButton} from '@/components/ui/action-button';
import {activeWorker,resolveStream} from '@/lib/proxy';
import {isProbablyHls} from './mediaUtils';
import {useYoutv} from '@/stores/useYoutv';

type Props={channel:Channel;audible:boolean;onAudio:()=>void;onFocus:()=>void;onRemove:()=>void;primary:boolean};

/** Independent media pipeline for every visible tile. Every HLS engine is destroyed on unmount. */
export default function MultiViewTile({channel,audible,onAudio,onFocus,onRemove,primary}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);
  const settings=useYoutv(state=>state.settings);
  const workers=useYoutv(state=>state.workers);
  const [status,setStatus]=useState<'loading'|'playing'|'paused'|'error'>('loading');
  const [error,setError]=useState('');
  const [retries,setRetries]=useState(0);
  const [expanded,setExpanded]=useState(false);
  const [forceProxy,setForceProxy]=useState(false);
  const mode=useMemo(()=>{
    try{return {stream:resolveStream(channel,settings,workers,forceProxy),error:''};}
    catch(e){return {stream:null,error:e instanceof Error?e.message:String(e)};}
  },[channel,settings.proxyMode,settings.defaultWorkerId,workers,forceProxy]);
  const url=mode.stream?.url??'';
  const hls=isProbablyHls(channel.url,channel.format);
  const sourceIsHls=hls||url.includes('hls=1');
  const effectiveMode=channel.proxyMode==='inherit'?settings.proxyMode:channel.proxyMode;
  const canFallback=effectiveMode==='auto'&&!forceProxy&&Boolean(activeWorker(channel,settings,workers));
  useEffect(()=>{setForceProxy(false);},[channel.id]);

  useEffect(()=>{
    const video=videoRef.current;
    if(video)video.muted=!audible;
  },[audible]);

  useEffect(()=>{
    const video=videoRef.current;if(!video)return;
    if(!url){setStatus('error');setError(mode.error||'Source unavailable');return;}
    let disposed=false;
    let engine:Hls|null=null;
    let networkFailures=0;let mediaFailures=0;
    setStatus('loading');setError('');
    video.muted=!audible;
    video.playsInline=true;
    const tryPlay=()=>{if(!disposed)void video.play().catch(()=>{if(!disposed)setStatus('paused');});};
    const onPlaying=()=>{if(!disposed)setStatus('playing');};
    const onPause=()=>{if(!disposed)setStatus('paused');};
    const onError=()=>{if(!disposed){setStatus('error');setError('Media error');}};
    video.addEventListener('playing',onPlaying);
    video.addEventListener('pause',onPause);
    video.addEventListener('error',onError);
    if(sourceIsHls&&Hls.isSupported()){
      engine=new Hls({enableWorker:true,lowLatencyMode:false,maxBufferLength:18,maxMaxBufferLength:30,capLevelToPlayerSize:true});
      engine.on(Hls.Events.MANIFEST_PARSED,tryPlay);
      engine.on(Hls.Events.ERROR,(_event,data)=>{
        if(disposed||!data.fatal)return;
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&mediaFailures++<1){engine?.recoverMediaError();return;}
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR&&networkFailures++<2){engine?.startLoad();return;}
        if(canFallback){setForceProxy(true);return;}
        setStatus('error');setError(data.details);
      });
      engine.loadSource(url);engine.attachMedia(video);
    }else if(sourceIsHls&&!video.canPlayType('application/vnd.apple.mpegurl')){
      setStatus('error');setError('HLS not supported');
    }else{
      video.src=url;video.load();tryPlay();
    }
    return()=>{
      disposed=true;
      video.removeEventListener('playing',onPlaying);
      video.removeEventListener('pause',onPause);
      video.removeEventListener('error',onError);
      video.pause();engine?.destroy();video.removeAttribute('src');video.load();
    };
    // Reinitialization depends on channel/source and explicit retry, not on audio selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel.id,url,hls,retries]);

  return <section className={`multiview-tile ${primary?'is-primary':''} ${expanded?'is-expanded':''}`}>
    <div className="multiview-head">
      <div className="multiview-identity">{channel.logo&&<img src={channel.logo} alt="" loading="lazy"/>}<strong title={channel.name}>{channel.name}</strong></div>
      <div className="multiview-actions">
        <ActionButton aria-label={audible?'Mute tile':'Unmute tile'} title={audible?'Mute':'Listen'} onClick={onAudio}>{audible?<Volume2 size={16}/>:<VolumeX size={16}/>}</ActionButton>
        <ActionButton aria-label="Focus channel" title="Focus" onClick={onFocus}><Maximize2 size={15}/></ActionButton>
        <ActionButton aria-label={expanded?'Reduce tile':'Enlarge tile'} title={expanded?'Reduce':'Enlarge'} onClick={()=>setExpanded(v=>!v)}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</ActionButton>
        {!primary&&<ActionButton aria-label="Remove tile" title="Remove" onClick={onRemove}><X size={16}/></ActionButton>}
      </div>
    </div>
    <div className="multiview-screen">
      <video ref={videoRef} playsInline preload="auto" autoPlay muted={!audible} />
      {status==='loading'&&<div className="multiview-spinner" aria-label="Loading video"/>}
      {status==='error'&&<div className="multiview-error"><span>{error||mode.error}</span><ActionButton onClick={()=>setRetries(n=>n+1)}><RefreshCw size={17}/></ActionButton></div>}
      {status==='paused'&&<ActionButton className="multiview-play" aria-label="Play tile" onClick={()=>void videoRef.current?.play()}><Play fill="currentColor" size={22}/></ActionButton>}
    </div>
    <div className="multiview-foot"><ActionButton onClick={()=>{const video=videoRef.current;if(!video)return;if(video.paused)void video.play();else video.pause();}} aria-label="Toggle playback">{status==='playing'?<Pause size={15}/>:<Play size={15}/>}</ActionButton><span>{channel.group||channel.country||'YouTV'}</span></div>
  </section>;
}
