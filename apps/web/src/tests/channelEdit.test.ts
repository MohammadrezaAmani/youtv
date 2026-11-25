import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,test,vi} from 'vitest';
import {createChannel,type Channel} from '@youtv/shared';
import '../locales';
import ChannelDialog from '../features/channels/ChannelDialog';
const fixture=vi.hoisted(()=>({channels:[] as Channel[],add:vi.fn(),update:vi.fn()}));
vi.mock('../stores/useYoutv',()=>({useYoutv:Object.assign(<T,>(selector:(s:{settings:{language:'en'};channels:Channel[];workers:never[];addChannel:typeof fixture.add;updateChannel:typeof fixture.update})=>T)=>selector({settings:{language:'en'},channels:fixture.channels,workers:[],addChannel:fixture.add,updateChannel:fixture.update}),{getState:()=>({settings:{language:'en'}})})}));

test('route edits can save an unchanged URL already present in another catalog',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const editing=createChannel({id:'personal-4kurd',name:'4 Kurd',url:'https://4kuhls.persiana.live/hls/stream.m3u8',proxyMode:'auto'});
 fixture.channels=[editing,{...editing,id:'catalog-4kurd'}];
 const container=document.createElement('div');document.body.append(container);
 const root=createRoot(container),close=vi.fn();
 try{
  await act(()=>root.render(createElement(ChannelDialog,{open:true,editing,onOpenChange:close})));
  const form=document.querySelector('form')!;
  await act(()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(fixture.update).toHaveBeenCalledWith(editing.id,expect.objectContaining({proxyMode:'auto',url:editing.url}));
  expect(close).toHaveBeenCalledWith(false);
 }finally{await act(()=>root.unmount());container.remove();vi.unstubAllGlobals();}
});
