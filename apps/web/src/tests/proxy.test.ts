import {it,expect} from 'vitest';
import {createChannel,defaultState,workerSchema} from '@youtv/shared';
import {resolveStream,proxyUrl} from '../lib/proxy';
it('builds a token-bearing, URL-encoded worker request',()=>{
  const worker={id:'a',name:'Own',baseUrl:'https://worker.example.com/',token:'my-long-key',enabled:true};
  const channel=createChannel({name:'X',url:'https://media.example.com/live.m3u8?sig=x&ttl=1',proxyMode:'proxy',workerId:'a'});
  const result=resolveStream(channel,defaultState.settings,[worker]);
  expect(result.mode).toBe('proxy');
  expect(new URL(result.url).searchParams.get('url')).toBe(channel.url);
  expect(proxyUrl(channel.url,worker,'text')).toContain('/text?');
});

it('carries per-channel IPTV HTTP hints through the Worker URL',()=>{
  const worker={id:'w',name:'Personal',baseUrl:'https://worker.example.org/',token:'x'.repeat(32),enabled:true};
  const channel=createChannel({name:'TV',url:'https://media.example.org/live.m3u8',iptv:{...createChannel({name:'X',url:'https://media.example.org/x'}).iptv,userAgent:'smartlabs',referer:'https://player.example.org/'},proxyMode:'proxy',workerId:'w'});
  const url=new URL(resolveStream(channel,defaultState.settings,[worker]).url);
  expect(url.searchParams.get('ua')).toBe('smartlabs');
  expect(url.searchParams.get('ref')).toBe('https://player.example.org/');
});


it('allows a configured Worker without a client token and omits key for HLS and text',()=>{
  const worker={id:'no-token',name:'Open worker',baseUrl:'https://public.workers.dev/',token:'',enabled:true};
  const channel=createChannel({name:'Public stream',url:'https://live.presstv.co.uk/hls/ifilmfa.m3u8',proxyMode:'proxy',workerId:worker.id});
  const result=resolveStream(channel,defaultState.settings,[worker]);
  expect(result.mode).toBe('proxy');
  const output=new URL(result.url);
  expect(output.pathname).toBe('/proxy');
  expect(output.searchParams.get('url')).toBe(channel.url);
  expect(output.searchParams.has('key')).toBe(false);
  expect(output.searchParams.get('hls')).toBe('1');
  expect(new URL(proxyUrl(channel.url,worker,'text')).searchParams.has('key')).toBe(false);
  expect(new URL(proxyUrl(channel.url,worker,'probe')).searchParams.has('key')).toBe(false);
});

it('new Worker profiles default to no access token when the field is absent',()=>{
  const saved=workerSchema.parse({id:'no-secret',name:'Open worker',baseUrl:'https://demo.workers.dev/'});
  expect(saved.token).toBe('');
  expect(new URL(proxyUrl('https://media.example.com/live.m3u8',saved,'proxy',true)).searchParams.has('key')).toBe(false);
});
