/** Playback buffering policy for ordinary live HLS. These values aim to keep
 * several complete segments ready without accumulating minutes of latency.
 * LL-HLS streams that advertise parts still use hls.js's low-latency machinery.
 */
export const LIVE_HLS_PROFILE = {
  enableWorker: true,
  startFragPrefetch: true,
  autoStartLoad: true,
  lowLatencyMode: true,
  maxBufferLength: 42,
  maxMaxBufferLength: 60,
  maxBufferSize: 64 * 1024 * 1024,
  backBufferLength: 20,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 7,
  maxLiveSyncPlaybackRate: 1.08,
  maxBufferHole: 0.35,
  capLevelToPlayerSize: false
} as const;

export function secondsBufferedAhead(currentTime:number, ranges:Pick<TimeRanges,'length'|'start'|'end'>):number {
  for(let i=0;i<ranges.length;i++){
    if(currentTime>=ranges.start(i)-0.15&&currentTime<=ranges.end(i)+0.15){
      return Math.max(0,ranges.end(i)-currentTime);
    }
  }
  return 0;
}

/**
 * Use already-buffered media when a tiny gap blocks playback; otherwise
 * use the live sync point only after significant drift from the live edge.
 * Never invent missing fragments or jump past an unbuffered gap blindly.
 */
export function recoveryTarget(args:{
  current:number; ranges:Pick<TimeRanges,'length'|'start'|'end'>;
  live:boolean; syncPosition:number|null; latency:number; targetLatency:number|null;
  stalledForMs:number;
}):number|null {
  const {current,ranges,live,syncPosition,latency,targetLatency,stalledForMs}=args;
  if(stalledForMs<2200)return null;
  if(live&&syncPosition!=null&&Number.isFinite(syncPosition)&&targetLatency!=null&&targetLatency>0&&latency>targetLatency*2.25&&syncPosition>current+2){
    return syncPosition;
  }
  if(secondsBufferedAhead(current,ranges)>0.4)return null;
  for(let i=0;i<ranges.length;i++){
    const start=ranges.start(i);
    if(start>current&&start-current<=1.25&&ranges.end(i)>start+0.25)return start+0.04;
  }
  return null;
}
