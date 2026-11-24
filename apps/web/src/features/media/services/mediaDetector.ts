import type { WorkerProfile } from '@youtv/shared';
import { proxyUrl } from '@/lib/proxy';

export type MediaKind='youtube-video'|'youtube-playlist'|'instagram-post'|'hls'|'dash'|'video'|'audio'|'image'|'document'|'file'|'unknown';
export type DirectProbe={status:number;contentType:string;contentLength:number|null;acceptRanges:boolean;filename:string;kind:MediaKind};
const VIDEO_EXT=new Set(['mp4','m4v','mkv','webm','mov','avi','flv','wmv','mpg','mpeg','m2ts','mts','ts','ogv','3gp','3g2','mxf','vob','divx','asf','rm','rmvb','m4p','mpe','m1v','m2v']);
const AUDIO_EXT=new Set(['mp3','m4a','aac','ogg','oga','opus','wav','flac','alac','aiff','wma','ape','ac3','eac3','amr','mid','midi','caf','au','tta','wv']);
const IMAGE_EXT=new Set(['jpg','jpeg','png','gif','webp','avif','bmp','tif','tiff','svg','heic','heif','ico']);
export function extensionOf(value:string):string{try{return new URL(value).pathname.split('.').at(-1)?.toLowerCase()||'';}catch{return '';}}
export function guessMediaKind(url:string,contentType=''):MediaKind{
  const mime=contentType.toLowerCase().split(';')[0]?.trim()||'';
  if(mime.includes('mpegurl')||mime.includes('vnd.apple.mpegurl')||/\.m3u8?$/i.test(new URL(url).pathname))return 'hls';
  if(mime.includes('dash+xml')||/\.mpd$/i.test(new URL(url).pathname))return 'dash';
  if(mime.startsWith('video/')||['application/x-matroska','application/x-msvideo','application/x-shockwave-flash','application/vnd.rn-realmedia','application/vnd.ms-asf','application/x-troff-msvideo'].includes(mime))return 'video';
  if(mime.startsWith('audio/')||['application/x-flac','application/x-aiff','application/x-wav'].includes(mime))return 'audio';
  if(mime.startsWith('image/'))return 'image';
  if(mime==='application/pdf'||/\.pdf$/i.test(new URL(url).pathname))return 'document';
  const ext=extensionOf(url);
  if(VIDEO_EXT.has(ext))return 'video';
  if(AUDIO_EXT.has(ext))return 'audio';
  if(IMAGE_EXT.has(ext))return 'image';
  return mime?'file':'unknown';
}
export async function probeDirectMedia(url:string,worker:WorkerProfile):Promise<DirectProbe>{
  const response=await fetch(proxyUrl(url,worker,'probe'),{credentials:'omit',cache:'no-store'});
  const data=await response.json() as {status?:number;contentType?:string;contentLength?:number|null;acceptRanges?:string;filename?:string;kind?:MediaKind;error?:string};
  if(!response.ok||Number(data.status)>=400)throw new Error(data.error||`Media probe HTTP ${data.status||response.status}`);
  const contentType=data.contentType||'';
  return {status:Number(data.status)||response.status,contentType,contentLength:Number(data.contentLength)||null,
    acceptRanges:/bytes/i.test(data.acceptRanges||''),filename:data.filename||'',kind:data.kind||guessMediaKind(url,contentType)};
}
