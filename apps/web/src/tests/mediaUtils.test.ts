import {describe,expect,it} from 'vitest';
import {srtToVtt,secondsToClock,makeTeletextUrl,isProbablyHls} from '@/features/player/mediaUtils';
describe('player helpers',()=>{
 it('converts SRT timestamps preserving cues',()=>{expect(srtToVtt('1\r\n00:00:01,100 --> 00:00:03,200\r\nHello')).toContain('00:00:01.100 --> 00:00:03.200');});
 it('converts durations',()=>{expect(secondsToClock(3671)).toBe('1:01:11');expect(secondsToClock(91)).toBe('1:31');});
 it('builds Teletext page URLs without arbitrary schemes',()=>{expect(makeTeletextUrl('https://example.org/page/{page}.txt',101)).toContain('/101.txt');expect(()=>makeTeletextUrl('file:///{page}',100)).toThrow();expect(()=>makeTeletextUrl('https://x/{page}',900)).toThrow();});
 it('uses format hint for extensionless HLS',()=>expect(isProbablyHls('https://host/live?id=1','hls')).toBe(true));
});
