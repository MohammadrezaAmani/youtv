import { createChannel, normalizeStreamUrl, type Channel, type IptvMetadata } from '@youtv/shared';

export type ParsedPlaylist = {title: string; channels: Channel[]; warnings: string[]};
const DIRECTIVE_NAME=/^#?(?:EXTVLCOPT|KODIPROP|WEBPROP|EXTHTTP|EXTGRP|EXTM3U|EXTINF|EXT-X-[\w-]+)\s*:/i;
const KV_DIRECTIVE=/^#?(EXTVLCOPT|KODIPROP|WEBPROP)\s*:\s*(.+)$/i;

export function isHlsManifest(text: string): boolean {
  const content=text.replace(/^\uFEFF/,'').trimStart();
  // Kodi can place EXT-X-PLAYLIST-TYPE as a hint inside an IPTV list.
  // Recognize a real HLS master/media playlist by structural HLS tags.
  return /^#EXT-X-(?:TARGETDURATION|STREAM-INF|I-FRAME-STREAM-INF|MEDIA-SEQUENCE|PART-INF|PART|PRELOAD-HINT|SERVER-CONTROL)(?=:|\b)/mi.test(content);
}

function splitExtinf(line:string):{before:string;after:string}{
  let quoted:string|null=null;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if((ch==='"'||ch==="'")&&line[i-1]!=='\\') quoted=quoted===ch?null:quoted?quoted:ch;
    if(ch===','&&!quoted)return {before:line.slice(0,i),after:line.slice(i+1).trim()};
  }
  return {before:line,after:''};
}
function extractAttributes(input:string):Record<string,string>{
  const attrs:Record<string,string>={};
  const re=/(?:^|\s)([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,]+))/g;
  for(const m of input.matchAll(re))attrs[m[1]!.toLowerCase()]=m[2]??m[3]??m[4]??'';
  return attrs;
}
function cleanAttributes(value:string):string {
  return value.replace(/(?:^|\s)[\w-]+\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,]+)/g,' ').replace(/^[\s\-–—|:]+/,'').trim();
}
export function parseExtinf(line:string):{name:string;attrs:Record<string,string>}{
  const {before,after}=splitExtinf(line);
  const beforeAttrs=extractAttributes(before),afterAttrs=extractAttributes(after);
  const attrs={...beforeAttrs,...afterAttrs};
  const metadataAfterComma=Object.keys(afterAttrs).some(k=>/^(?:tvg-|group-title|radio|catchup|timeshift|youtv-|provider-)/.test(k));
  const name=metadataAfterComma?cleanAttributes(after):after;
  // A tag in the title position is not a television channel name.
  return {name:(DIRECTIVE_NAME.test(name)?'':name)||attrs['tvg-name']||'',attrs};
}

export function displayNameFromUrl(raw:string):string {
  try{
    const url=new URL(raw);
    const filename=decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||'').replace(/\.(?:m3u8?|mp4|mpd|ts|m4s|flv|mkv)$/i,'');
    const label=filename&&filename.length<=36&&!/[?&#=]/.test(filename)&&!/^(?:index|playlist|master|live|stream|mono|chunklist|tracks[-\w]*)$/i.test(filename)?filename:'';
    return `${url.hostname}${label?` · ${label}`:''}`.slice(0,160);
  }catch{return 'Unnamed stream';}
}

/** Some IPTV lists put a VLC/Kodi directive *inside* the title of EXTINF. */
function readDirective(raw:string,iptv:IptvMetadata):boolean {
  const line=raw.trim();
  const match=line.match(KV_DIRECTIVE);
  if(match){
    const [,type,body]=match;
    const eq=body!.indexOf('=');
    if(eq<1)return true;
    const key=body!.slice(0,eq).trim().toLowerCase(),value=body!.slice(eq+1).trim();
    if(type!.toUpperCase()==='EXTVLCOPT'){
      iptv.vlcOptions[key]=value;
      if(key==='http-user-agent'||key==='user-agent')iptv.userAgent=value;
      if(key==='http-referrer'||key==='http-referer'||key==='referer'||key==='referrer')iptv.referer=value;
    }else if(type!.toUpperCase()==='KODIPROP')iptv.kodiProps[key]=value;
    else iptv.webProps[key]=value;
    return true;
  }
  if(/^#?EXTHTTP\s*:/i.test(line)){
    const value=line.replace(/^#?EXTHTTP\s*:/i,'').trim();
    try{
      const headers=JSON.parse(value) as unknown;
      if(headers&&typeof headers==='object'&&!Array.isArray(headers)){
        for(const [k,v] of Object.entries(headers)){
          if(typeof v!=='string')continue;
          // Never persist cookies, authorization or arbitrary request credentials.
          if(/^user-agent$/i.test(k))iptv.userAgent=v;
          if(/^referr?er$/i.test(k))iptv.referer=v;
        }
      }
    }catch{/* Keep an unrecognized directive out of the displayed title. */}
    return true;
  }
  return false;
}
function freshMetadata():IptvMetadata {
  return {duration:null,tvgName:'',channelNumber:'',radio:false,tvgShift:'',catchup:'',catchupDays:'',catchupSource:'',epgUrls:[],userAgent:'',referer:'',vlcOptions:{},kodiProps:{},webProps:{},attributes:{}};
}
function appendEpgUrls(into:string[],text:string):void {
  for(const raw of text.split(/[;,]/)){
    const value=raw.trim();if(/^https?:\/\//i.test(value)&&!into.includes(value))into.push(value);
  }
}
function metadataFromAttrs(attrs:Record<string,string>,base:IptvMetadata):IptvMetadata{
  const data: IptvMetadata={...base,vlcOptions:{...base.vlcOptions},kodiProps:{...base.kodiProps},webProps:{...base.webProps},attributes:{...base.attributes,...attrs},epgUrls:[...base.epgUrls]};
  data.tvgName=attrs['tvg-name']||data.tvgName;
  data.channelNumber=attrs['tvg-chno']||attrs['channel-number']||data.channelNumber;
  data.radio=attrs.radio==='true'||attrs.radio==='1'||(attrs.radio===undefined&&data.radio);
  data.tvgShift=attrs['tvg-shift']||attrs.timeshift||data.tvgShift;
  data.catchup=attrs.catchup||attrs['catchup-type']||data.catchup;
  data.catchupDays=attrs['catchup-days']||data.catchupDays;
  data.catchupSource=attrs['catchup-source']||data.catchupSource;
  appendEpgUrls(data.epgUrls,attrs['x-tvg-url']||attrs['url-tvg']||'');
  if(attrs['user-agent'])data.userAgent=attrs['user-agent'];
  if(attrs['http-user-agent'])data.userAgent=attrs['http-user-agent'];
  if(attrs.referer||attrs.referrer)data.referer=attrs.referer||attrs.referrer;
  return data;
}

export function parseM3u(text:string,baseUrl?:string):ParsedPlaylist {
  const cleaned=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  if(isHlsManifest(cleaned))throw Error('This is an HLS video manifest, not an IPTV channel list. Add its URL as a single channel.');
  const channels:Channel[]=[],warnings:string[]=[];
  let meta: {name:string;logo:string;group:string;tvgId:string;language:string;country:string;tags:string[];iptv:IptvMetadata}|null=null;
  let globalIptv=freshMetadata(),title='IPTV Playlist',pendingGroup='';
  for(const [i,raw] of cleaned.split('\n').entries()){
    const line=raw.trim();if(!line)continue;
    if(/^#EXTM3U(?:\s|$)/i.test(line)){
      globalIptv=metadataFromAttrs(extractAttributes(line),globalIptv);continue;
    }
    if(/^#PLAYLIST:/i.test(line)){title=line.slice(10).trim()||title;continue;}
    if(/^#EXTINF:/i.test(line)){
      const {before,after}=splitExtinf(line);
      const parsed=parseExtinf(line),attrs=parsed.attrs;
      const duration=Number(before.replace(/^#EXTINF:/i,'').trim().split(/\s/)[0]);
      const iptv=metadataFromAttrs(attrs,globalIptv);
      if(Number.isFinite(duration))iptv.duration=duration;
      // Malformed producer: #EXTINF:-1,#EXTVLCOPT:http-user-agent=smartlabs
      // Interpret the embedded directive as per-channel metadata, not a name.
      readDirective(after,iptv);
      meta={name:parsed.name,logo:attrs['tvg-logo']||'',group:attrs['group-title']||pendingGroup,tvgId:attrs['tvg-id']||'',language:attrs['tvg-language']||attrs.language||'',country:attrs['tvg-country']||attrs.country||'',tags:attrs['youtv-tags']?.split('|').map(v=>v.trim()).filter(Boolean)||[],iptv};
      pendingGroup='';
      continue;
    }
    if(/^#EXTGRP:/i.test(line)){
      // EXTGRP is channel-scoped; don't leak it into subsequent channels.
      if(meta)meta.group=line.slice(8).trim()||meta.group;
      else pendingGroup=line.slice(8).trim();
      continue;
    }
    if(/^#(?:EXTALBUMARTURL|EXTIMG):/i.test(line)){if(meta)meta.logo=line.slice(line.indexOf(':')+1).trim()||meta.logo;continue;}
    if(line.startsWith('#')){if(meta)readDirective(line,meta.iptv);continue;}
    if(!/^https?:\/\//i.test(line) && !(baseUrl && (/^(?:\/\/|\.\.?\/|\/)/.test(line)||/\.(?:m3u8?|mp4|mpd|ts|m4s)(?:[?#].*)?$/i.test(line)||(meta&&!/\s/.test(line)))))continue;
    try{
      let streamUrl=line;
      const iptv=meta?.iptv||metadataFromAttrs({},globalIptv);
      // Some IPTV players encode per-channel HTTP hints after a | separator.
      // These hints must not be mistaken for part of the HTTP stream URL.
      const bar=streamUrl.indexOf('|');
      if(bar>=0 && /^(?:user-agent|http-user-agent|referr?er|http-referr?er)=/i.test(streamUrl.slice(bar+1))){
        const hints=new URLSearchParams(streamUrl.slice(bar+1));
        for(const [key,value] of hints){
          if(/^(?:user-agent|http-user-agent)$/i.test(key))iptv.userAgent=value;
          if(/^(?:referr?er|http-referr?er)$/i.test(key))iptv.referer=value;
        }
        streamUrl=streamUrl.slice(0,bar);
      }
      const url=normalizeStreamUrl(baseUrl?new URL(streamUrl,baseUrl).href:streamUrl);
      channels.push(createChannel({name:(meta?.name||displayNameFromUrl(url)).slice(0,160),url,logo:meta?.logo||'',group:meta?.group||'',tvgId:meta?.tvgId||'',language:meta?.language||'',country:meta?.country||'',tags:meta?.tags||[],iptv}));
    }catch{warnings.push(`Line ${i+1}: invalid or unsupported stream URL`);}
    meta=null;
  }
  if(!channels.length)throw Error('No valid channels found in this M3U playlist');
  return {title,channels,warnings};
}

export function toM3u(channels:Channel[]):string {
  const clean=(value:string)=>value.replace(/[\r\n"]/g,' ').trim();
  const escapeName=(value:string)=>value.replace(/[\r\n]/g,' ').trim();
  const known=new Set(['tvg-id','tvg-name','tvg-logo','group-title','tvg-country','tvg-language','tvg-chno','radio','tvg-shift','timeshift','catchup','catchup-type','catchup-days','catchup-source','youtv-tags','x-tvg-url','url-tvg']);
  const allEpg=channels.map(ch=>ch.iptv.epgUrls.join(','));
  const sharedEpg=allEpg.length&&allEpg.every(v=>v===allEpg[0])?allEpg[0]:'';
  const header=sharedEpg?`#EXTM3U x-tvg-url="${clean(sharedEpg)}"`:'#EXTM3U';
  const lines=[header];
  for(const c of channels){
    const i=c.iptv;
    const attrs:Record<string,string>={
      'tvg-id':c.tvgId,'tvg-name':i.tvgName,'tvg-logo':c.logo,'group-title':c.group,
      'tvg-country':c.country,'tvg-language':c.language,'tvg-chno':i.channelNumber,
      ...(i.radio?{radio:'true'}:{}),...(i.tvgShift?{'tvg-shift':i.tvgShift}:{}),
      ...(i.catchup?{catchup:i.catchup}:{}),...(i.catchupDays?{'catchup-days':i.catchupDays}:{}),
      ...(i.catchupSource?{'catchup-source':i.catchupSource}:{}),
      ...(c.tags.length?{'youtv-tags':c.tags.map(clean).join('|')}:{}),
      ...(sharedEpg?{}:i.epgUrls.length?{'x-tvg-url':i.epgUrls.join(',')}:{}),
    };
    for(const [key,value] of Object.entries(i.attributes))if(!known.has(key)&&/^[\w-]+$/.test(key))attrs[key]=value;
    const properties=Object.entries(attrs).filter(([key,value])=>value!==''||['tvg-id','tvg-logo','group-title'].includes(key)).map(([key,value])=>`${key}="${clean(value)}"`).join(' ');
    lines.push(`#EXTINF:${i.duration??-1} ${properties},${escapeName(c.name)}`);
    for(const [key,value] of Object.entries(i.vlcOptions))if(/^[\w-]+$/.test(key)&&!/[\r\n]/.test(value))lines.push(`#EXTVLCOPT:${key}=${value}`);
    if(i.userAgent&&!i.vlcOptions['http-user-agent']&&!i.vlcOptions['user-agent'])lines.push(`#EXTVLCOPT:http-user-agent=${clean(i.userAgent)}`);
    if(i.referer&&!['http-referrer','http-referer','referer','referrer'].some(key=>key in i.vlcOptions))lines.push(`#EXTVLCOPT:http-referrer=${clean(i.referer)}`);
    for(const [key,value] of Object.entries(i.kodiProps))if(/^[\w.-]+$/.test(key)&&!/[\r\n]/.test(value))lines.push(`#KODIPROP:${key}=${value}`);
    for(const [key,value] of Object.entries(i.webProps))if(/^[\w.-]+$/.test(key)&&!/[\r\n]/.test(value))lines.push(`#WEBPROP:${key}=${value}`);
    lines.push(c.url);
  }
  return lines.join('\n')+'\n';
}
export function downloadText(text:string,filename:string,mime='text/plain'):void {
  const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
