import type {Channel} from '@youtv/shared';

export const MAX_MULTI_VIEWS=4;

export function addMultiChannel(primaryId:string,extras:string[],id:string):string[]{
  if(!id||id===primaryId)return extras.filter(value=>value!==primaryId).slice(0,MAX_MULTI_VIEWS-1);
  return Array.from(new Set([...extras.filter(value=>value!==primaryId),id])).slice(0,MAX_MULTI_VIEWS-1);
}

export function relatedToChannel(channels:Channel[],active:Channel,max=60):Channel[]{
  const candidates=channels.filter(channel=>channel.id!==active.id);
  const selected=new Map<string,Channel>();
  const add=(filtered:Channel[])=>{
    for(const channel of filtered){if(selected.size>=max)break;selected.set(channel.id,channel);}
  };
  add(candidates.filter(channel=>Boolean(active.sourceId&&active.group&&channel.sourceId===active.sourceId&&channel.group===active.group)));
  add(candidates.filter(channel=>Boolean(active.group&&channel.group===active.group)));
  add(candidates.filter(channel=>Boolean(active.sourceId&&channel.sourceId===active.sourceId)));
  if(!selected.size)add(candidates.filter(channel=>channel.tags.some(tag=>active.tags.includes(tag))));
  if(!selected.size&&active.country)add(candidates.filter(channel=>channel.country===active.country));
  return [...selected.values()];
}
