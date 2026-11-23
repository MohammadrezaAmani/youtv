import { createChannel, normalizeStreamUrl, type Channel } from '@youtv/shared';

export type ParsedPlaylist = {title: string; channels: Channel[]; warnings: string[]};

export function isHlsManifest(text: string): boolean {
  const content=text.replace(/^\uFEFF/,'').trimStart();
  return content.startsWith('#EXTM3U') && /^#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION|PART-INF|PLAYLIST-TYPE|MAP|KEY):?/m.test(content);
}

/**
 * IPTV producers use two incompatible EXTINF layouts:
 *   #EXTINF:-1 tvg-name="Station" group-title="News",Station
 *   #EXTINF:0, tvg-name="Station" group-title="News" - Station
 * Metadata after the first comma belongs to the same EXTINF entry, not to
 * the channel title. Attributes may contain embedded commas and spaces.
 */
function splitExtinf(line: string): {before: string; after: string} {
  let quoted: '\"' | "'" | null = null;
  for (let i=0;i<line.length;i++) {
    const char=line[i];
    if((char==='"'||char==="'")&&line[i-1]!=='\\') {
      if(quoted===char) quoted=null;
      else if(!quoted) quoted=char;
    }
    if(char===','&&!quoted)return {before:line.slice(0,i),after:line.slice(i+1).trim()};
  }
  return {before:line,after:''};
}

function extractAttributes(input:string): Record<string,string> {
  const attrs:Record<string,string>={};
  const regex=/(?:^|\s)([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,]+))/g;
  for(const match of input.matchAll(regex)){
    attrs[match[1]!.toLowerCase()]=match[2]??match[3]??match[4]??'';
  }
  return attrs;
}

/** Return the cleaned name and the parsed metadata from an EXTINF line. */
export function parseExtinf(line:string):{name:string;attrs:Record<string,string>} {
  const {before,after}=splitExtinf(line);
  const afterAttrs=extractAttributes(after);
  const attrs={...extractAttributes(before),...afterAttrs};
  const hasTrailingAttributes=Object.keys(afterAttrs).some(key=>key.startsWith('tvg-')||key==='group-title'||key==='youtv-tags');
  let name=after;
  if(hasTrailingAttributes){
    // Remove valid key=value runs, including quoted values with spaces/commas.
    name=after.replace(/(?:^|\s)[\w-]+\s*=\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,]+)/g,' ').trim();
    // The nonstandard format often writes " - Display name" after attributes.
    name=name.replace(/^\s*[-–—|:]+\s*/,'').trim();
  }
  // If the payload has no display name, use the authoritative tvg-name.
  name=name||attrs['tvg-name']||'';
  return {name,attrs};
}

export function parseM3u(text: string, baseUrl?:string): ParsedPlaylist {
  const cleaned=text.replace(/^\uFEFF/,'');
  if (!cleaned.trimStart().startsWith('#EXTM3U')) throw new Error('The file must start with #EXTM3U');
  if (isHlsManifest(cleaned)) throw new Error('This is an HLS video manifest, not an IPTV channel list. Add its URL as a single channel.');
  const channels:Channel[]=[];const warnings:string[]=[];
  let meta: {name:string;logo:string;group:string;tvgId:string;language:string;country:string;tags:string[]} | null=null;
  let fallbackGroup='';
  for (const [i,raw] of cleaned.split(/\r?\n/).entries()) {
    const line=raw.trim();
    if (!line)continue;
    if (line.startsWith('#EXTGRP:')) {fallbackGroup=line.slice(8).trim();continue;}
    if (line.startsWith('#EXTINF:')) {
      const {attrs,name}=parseExtinf(line);
      meta={name:name||attrs['tvg-name']||`Channel ${i+1}`,logo:attrs['tvg-logo']||'',group:attrs['group-title']||fallbackGroup,
        tvgId:attrs['tvg-id']||'',language:attrs['tvg-language']||'',country:attrs['tvg-country']||'',tags:attrs['youtv-tags']?.split('|').map(v=>v.trim()).filter(Boolean)||[]};
      continue;
    }
    if(line.startsWith('#'))continue;
    try {
      const url=normalizeStreamUrl(baseUrl?new URL(line,baseUrl).href:line);
      if(!meta) {warnings.push(`Line ${i+1}: missing #EXTINF; channel name derived from URL`);}
      const name=meta?.name || new URL(url).hostname;
      channels.push(createChannel({name,url,logo:meta?.logo||'',group:meta?.group||'',tvgId:meta?.tvgId||'',language:meta?.language||'',country:meta?.country||'',tags:meta?.tags||[]}));
    } catch {
      if(warnings.length<25) warnings.push(`Line ${i+1}: invalid or unsupported stream URL`);
    }
    meta=null;
  }
  if (channels.length===0) throw new Error('No valid channels found in this M3U playlist');
  return {title:'IPTV Playlist',channels,warnings};
}
export function toM3u(channels:Channel[]):string {
  const cleaned=(s:string)=>s.replace(/\r|\n|"/g,' ').trim();
  return ['#EXTM3U',...channels.flatMap(c=>[
    `#EXTINF:-1 tvg-id="${cleaned(c.tvgId)}" tvg-logo="${cleaned(c.logo)}" ${c.tags.length?`youtv-tags="${c.tags.map(cleaned).join('|')}" `:''}group-title="${cleaned(c.group)}",${cleaned(c.name)}`,
    c.url
  ])].join('\n')+'\n';
}
export function downloadText(text:string,filename:string,mime='text/plain'):void {
  const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
