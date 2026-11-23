/** Browser-only recording of the decoded media element. No remote server, no mocked streams. */
export type RecorderPhase='idle'|'starting'|'recording'|'paused'|'saving'|'complete'|'error';
export type RecorderSnapshot={phase:RecorderPhase;elapsedMs:number;bytes:number;filename:string;format:string;message:string;downloadUrl?:string};
export const initialRecorder:RecorderSnapshot={phase:'idle',elapsedMs:0,bytes:0,filename:'',format:'',message:''};
const CANDIDATES=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4'];
export function chooseRecorderMime(isSupported:(value:string)=>boolean):string{
  return CANDIDATES.find(value=>isSupported(value))||'';
}
export function recordingFilename(channelName:string,mime:string,now:Date=new Date()):string{
  const base=channelName.normalize('NFKC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,70)||'channel';
  return `${base}-${now.toISOString().replace(/[:.]/g,'-')}.${mime.startsWith('video/mp4')?'mp4':'webm'}`;
}
export function readableBytes(value:number){
  if(value<1024)return `${value} B`;
  const unit=Math.min(3,Math.floor(Math.log(value)/Math.log(1024)));
  return `${(value/1024**unit).toFixed(1)} ${['B','KiB','MiB','GiB'][unit]}`;
}

type FileWriter={write:(chunk:Blob)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
type SaveHandle={createWritable:()=>Promise<FileWriter>};
type PickerWindow=Window&{showSaveFilePicker?:(options:{suggestedName:string;types:{description:string;accept:Record<string,string[]>}[]})=>Promise<SaveHandle>};
type CapturableVideo=HTMLVideoElement&{captureStream?:()=>MediaStream;mozCaptureStream?:()=>MediaStream};
const MEMORY_LIMIT=350*1024*1024;

export class LocalRecordingSession {
  private recorder:MediaRecorder|null=null;
  private sink:FileWriter|null=null;
  private chunks:Blob[]=[];
  private writerQueue:Promise<void>=Promise.resolve();
  private startedAt=0;
  private elapsedPrior=0;
  private tickId:ReturnType<typeof setInterval>|null=null;
  private stream:MediaStream|null=null;
  private finishing=false;
  private snapshot:RecorderSnapshot={...initialRecorder};
  constructor(private notify:(next:RecorderSnapshot)=>void){}
  private emit(update:Partial<RecorderSnapshot>){this.snapshot={...this.snapshot,...update};this.notify({...this.snapshot});}
  get phase(){return this.snapshot.phase;}
  private elapsed(){return this.elapsedPrior+(this.startedAt?Date.now()-this.startedAt:0);}
  private stopTick(){if(this.tickId){clearInterval(this.tickId);this.tickId=null;}}
  async start(video:HTMLVideoElement,channelName:string,videoBitsPerSecond=4_000_000){
    if(this.recorder&&this.recorder.state!=='inactive')throw Error('A recording is already running');
    if(typeof MediaRecorder==='undefined')throw Error('MediaRecorder is unavailable in this browser.');
    const captureVideo=video as CapturableVideo;
    if(!captureVideo.captureStream&&!captureVideo.mozCaptureStream)throw Error('Recording video playback is not supported by this browser.');
    if(video.paused||video.readyState<2)throw Error('Start playback before recording.');
    this.emit({...initialRecorder,phase:'starting'});
    const mime=chooseRecorderMime(type=>MediaRecorder.isTypeSupported(type));
    if(!mime)throw Error('This browser does not provide a supported WebM/MP4 recording format.');
    const filename=recordingFilename(channelName,mime);
    const ext=filename.endsWith('.mp4')?'.mp4':'.webm';
    try{
      // Must be invoked directly from a user gesture, before asynchronous capture work.
      const picker=(window as PickerWindow).showSaveFilePicker;
      if(picker){
        const handle=await picker.call(window,{suggestedName:filename,types:[{description:'YouTV video recording',accept:{[ext==='.mp4'?'video/mp4':'video/webm']:[ext]}}]});
        this.sink=await handle.createWritable();
      }
      this.stream=(captureVideo.captureStream||captureVideo.mozCaptureStream)!.call(video);
      if(!this.stream.getTracks().length)throw Error('This stream does not expose recordable media tracks. Check browser and source CORS support.');
      const recorder=new MediaRecorder(this.stream,mime?{mimeType:mime,videoBitsPerSecond}:undefined);
      this.recorder=recorder;
      this.chunks=[];this.writerQueue=Promise.resolve();this.finishing=false;
      recorder.ondataavailable=e=>{
        if(!e.data?.size)return;
        this.emit({bytes:this.snapshot.bytes+e.data.size});
        if(this.sink){
          const sink=this.sink;
          this.writerQueue=this.writerQueue.then(()=>sink.write(e.data)).catch(error=>{
            this.emit({phase:'error',message:`Could not write recording: ${String(error)}`});
            if(recorder.state!=='inactive')recorder.stop();
          });
        }else{
          this.chunks.push(e.data);
          if(this.snapshot.bytes>MEMORY_LIMIT){
            this.emit({message:'Memory recording limit reached (350 MiB); saving this clip now.'});
            if(recorder.state!=='inactive')recorder.stop();
          }
        }
      };
      recorder.onerror=()=>{this.emit({phase:'error',message:'The browser encoder failed while recording.'});if(recorder.state!=='inactive')recorder.stop();};
      recorder.onstop=()=>{void this.finalize();};
      recorder.start(1000);
      this.startedAt=Date.now();this.elapsedPrior=0;
      this.emit({phase:'recording',filename,format:recorder.mimeType||mime||'browser default',message:this.sink?'Saving directly to the selected file':'Browser download mode: short recordings only'});
      this.tickId=setInterval(()=>this.emit({elapsedMs:this.elapsed()}),500);
    }catch(error){
      this.stopTick();if(this.sink){try{await this.sink.abort();}catch{/* cancelled picker or sink */}}
      this.sink=null;this.stream=null;
      this.emit({phase:'error',message:error instanceof Error?error.message:String(error)});
      throw error;
    }
  }
  pause(){if(this.recorder?.state!=='recording')return;this.recorder.pause();this.elapsedPrior=this.elapsed();this.startedAt=0;this.emit({phase:'paused',elapsedMs:this.elapsedPrior});}
  resume(){if(this.recorder?.state!=='paused')return;this.recorder.resume();this.startedAt=Date.now();this.emit({phase:'recording'});}
  stop(){if(!this.recorder||this.recorder.state==='inactive')return;this.elapsedPrior=this.elapsed();this.startedAt=0;this.stopTick();this.emit({phase:'saving',elapsedMs:this.elapsedPrior});this.recorder.stop();}
  private async finalize(){
    if(this.finishing)return;this.finishing=true;this.stopTick();
    try{
      await this.writerQueue;
      if(this.sink){await this.sink.close();}
      else if(this.chunks.length){
        const blob=new Blob(this.chunks,{type:this.recorder?.mimeType||'video/webm'});
        const url=URL.createObjectURL(blob);
        const link=document.createElement('a');link.href=url;link.download=this.snapshot.filename;link.style.display='none';document.body.appendChild(link);link.click();link.remove();
        // Keep a manual download link in case an automatic download is blocked.
        this.emit({downloadUrl:url});
        setTimeout(()=>URL.revokeObjectURL(url),15*60_000);
      }
      if(this.snapshot.phase!=='error')this.emit({phase:'complete',message:this.sink?'Recording saved to the file you selected.':'Download prepared. If the browser blocked it, use Download again.'});
    }catch(e){this.emit({phase:'error',message:`Recording could not be saved: ${String(e)}`});}
    finally{
      this.chunks=[];this.sink=null;this.recorder=null;this.stream=null;
    }
  }
}
