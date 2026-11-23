import {describe,it,expect} from 'vitest';
import {createChannel} from '@youtv/shared';
import {channelMatches,defaultFilters,filterChannels,facets,parseTags,searchNormalize} from '@/lib/library';

const make=(name:string,extra:Record<string,unknown>={})=>createChannel({name,url:`https://video.example.org/${encodeURIComponent(name)}.m3u8`,...extra});
describe('YouTV library',()=>{
  it('normalizes Persian Arabic variants and searches tags',()=>{
    const ch=make('شبكه خبري',{tags:['آموزشی','ورزش'],description:'برنامه زنده'});
    expect(searchNormalize('شبكه ي خبري')).toContain('شبکه ی خبری');
    expect(channelMatches(ch,'شبکه ورزش')).toBe(true);
    expect(channelMatches(ch,'خبر موسیقی')).toBe(false);
    expect(channelMatches(make('International',{tags:['science']}),'Internationl science')).toBe(true);
  });
  it('supports intersecting tag/country/group and favorites',()=>{
    const a=make('A',{tags:['sports'],country:'IR',group:'National',favorite:true});
    const b=make('B',{tags:['sports'],country:'TR',group:'National',favorite:false});
    const result=filterChannels([a,b],{...defaultFilters,tag:'sports',country:'IR',favoritesOnly:true},[]);
    expect(result.map(c=>c.name)).toEqual(['A']);
  });
  it('pins independently of alphabetical sort and indexes last playback',()=>{
    const a=make('A'),b=make('B'),c=make('C',{pinned:true});
    expect(filterChannels([a,b,c],{...defaultFilters,sort:'last-played'},[b.id,a.id]).map(x=>x.name)).toEqual(['C','B','A']);
  });
  it('deduplicates tags and calculates facets from actual items',()=>{
    expect(parseTags('News, Sports، News; Politics')).toEqual(['News','Sports','Politics']);
    expect(facets([make('A',{group:'News',tags:['one']}),make('B',{group:'News',tags:['two']})]).groups).toEqual(['News']);
  });
});
