import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {chooseRecorderMime,LocalRecordingSession,readableBytes,recordingFilename,type RecorderSnapshot} from '@/features/recording/recorder';

class FakeRecorder {
  static isTypeSupported=(type:string)=>type==='video/webm';
  state:RecordingState='inactive';
  mimeType='video/webm';
  ondataavailable:((event:{data:Blob})=>void)|null=null;
  onstop:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  constructor(public stream:MediaStream,public options?:MediaRecorderOptions){}
  start(_timeslice?:number){this.state='recording';}
  pause(){this.state='paused';}
  resume(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['recorded-by-fake-recorder'])});this.onstop?.();}
}
const mockVideo=()=>({paused:false,readyState:4,captureStream:()=>({getTracks:()=>[{kind:'video'}]})}) as unknown as HTMLVideoElement;

describe('browser-only recording helpers and state machine',()=>{
  beforeEach(()=>{
    vi.stubGlobal('MediaRecorder',FakeRecorder);
  });
  afterEach(()=>{vi.unstubAllGlobals();Reflect.deleteProperty(window,'showSaveFilePicker');});
  it('selects a real supported container and codec',()=>{
    expect(chooseRecorderMime(type=>type==='video/webm')).toBe('video/webm');
    expect(chooseRecorderMime(()=>false)).toBe('');
  });
  it('generates safe, predictable filenames',()=>{
    expect(recordingFilename('BBC / News: Europe','video/webm',new Date('2026-11-23T12:00:00Z'))).toBe('BBC _ News_ Europe-2026-11-23T12-00-00-000Z.webm');
    expect(recordingFilename('channel','video/mp4').endsWith('.mp4')).toBe(true);
  });
  it('formats sizes correctly',()=>{
    expect(readableBytes(1024)).toBe('1.0 KiB');
    expect(readableBytes(1024*1024)).toBe('1.0 MiB');
  });
  it('rejects an unstarted stream before creating a recording',async()=>{
    const rec=new LocalRecordingSession(()=>{});
    await expect(rec.start({...mockVideo(),paused:true} as HTMLVideoElement,'channel')).rejects.toThrow(/playback/i);
  });
  it('records, pauses, resumes and finalizes directly to a browser-selected file',async()=>{
    const write=vi.fn(async(_blob:Blob)=>{}),close=vi.fn(async()=>{}),abort=vi.fn(async()=>{});
    Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:async()=>({createWritable:async()=>({write,close,abort})})});
    const states:RecorderSnapshot[]=[];
    const rec=new LocalRecordingSession(state=>states.push(state));
    await rec.start(mockVideo(),'Live TV',3_000_000);
    expect(rec.phase).toBe('recording');
    rec.pause();expect(rec.phase).toBe('paused');
    rec.resume();expect(rec.phase).toBe('recording');
    rec.stop();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(write).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
    expect(states.at(-1)?.phase).toBe('complete');
    expect(states.at(-1)?.bytes).toBeGreaterThan(0);
  });
});
