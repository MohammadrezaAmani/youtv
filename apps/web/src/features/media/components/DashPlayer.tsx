import {useEffect,useRef,useState} from 'react';

type Props={src:string;title?:string;className?:string;onError?:(message:string)=>void};
export default function DashPlayer({src,title='MPEG-DASH stream',className,onError}:Props){
  const videoRef=useRef<HTMLVideoElement>(null);
  const onErrorRef=useRef(onError);
  const [error,setError]=useState('');
  useEffect(()=>{onErrorRef.current=onError;},[onError]);
  useEffect(()=>{
    let disposed=false;let player:any;
    setError('');
    void (async()=>{
      try{
        const module=await import('dashjs');
        if(disposed||!videoRef.current)return;
        const dashjs=(module as any).default||module;
        player=dashjs.MediaPlayer().create();
        player.initialize(videoRef.current,src,true);
        player.updateSettings({streaming:{lowLatencyEnabled:false,buffer:{fastSwitchEnabled:true}}});
        player.on(dashjs.MediaPlayer.events.ERROR,(event:any)=>{
          const message=event?.error?.message||event?.event?.message||'DASH playback failed';
          if(!disposed){setError(String(message));onErrorRef.current?.(String(message));}
        });
      }catch(cause){if(!disposed){const message=cause instanceof Error?cause.message:'DASH player unavailable';setError(message);onErrorRef.current?.(message);}}
    })();
    return()=>{disposed=true;try{player?.reset();}catch{/* no-op */}};
  },[src]);
  return <div className={className||'media-player-shell'}>
    <video ref={videoRef} controls playsInline preload="metadata" aria-label={title} className="media-center-video"/>
    {error&&<p className="error-message" role="alert">{error}</p>}
  </div>;
}
