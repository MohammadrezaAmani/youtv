import test from 'node:test';
import assert from 'node:assert/strict';
import {searchNormalize,channelMatches,filterChannels,defaultFilters,parseTags,facets} from '../lib/library.ts';
const channel=(id,name,extra={})=>({id,name,url:`https://owned.example.net/${id}.m3u8`,logo:'',format:'hls',group:'',language:'',country:'',tvgId:'',favorite:false,tags:[],description:'',pinned:false,proxyMode:'inherit',workerId:'',createdAt:1,updatedAt:1,sourceId:'',...extra});
test('RTL-aware normalization and token-based search',()=>{
  assert.equal(searchNormalize('موسيقي و برنامه‌ي خبري'),'موسیقی و برنامه ی خبری');
  assert.equal(channelMatches(channel('1','شبكه خبري',{tags:['ورزشی']}),'شبکه ورزشی'),true);
  assert.equal(channelMatches(channel('2','خبر',{tags:['ورزش']}),'خبر موسیقی'),false);
  assert.equal(channelMatches(channel('3','International',{tags:['science']}),'Internationl science'),true);
});
test('filters intersect all dimensions without fake remote data',()=>{
  const records=[channel('1','A',{tags:['sport'],group:'X',country:'IR',favorite:true}),channel('2','B',{tags:['sport'],group:'X',country:'TR'})];
  assert.deepEqual(filterChannels(records,{...defaultFilters,tag:'sport',country:'IR',favoritesOnly:true},[]).map(x=>x.id),['1']);
});
test('pinned channels and recent order',()=>{
  const records=[channel('1','A'),channel('2','B'),channel('3','C',{pinned:true})];
  assert.deepEqual(filterChannels(records,{...defaultFilters,sort:'last-played'},['2','1']).map(x=>x.id),['3','2','1']);
});
test('unique tags and facets',()=>{
  assert.deepEqual(parseTags('A, B، A; C'),['A','B','C']);
  assert.deepEqual(facets([channel('1','A',{tags:['one'],group:'News'}),channel('2','B',{tags:['two'],group:'News'})]).groups,['News']);
  assert.deepEqual(facets([channel('1','A')]).sources,['__personal']);
});
