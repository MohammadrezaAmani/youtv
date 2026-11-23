import {describe, expect, it} from 'vitest';
import {isAppleMobileBrowser,isBlockedMixedMedia,needsUserPlayGesture,selectPlaybackEngine} from '../features/player/playbackSupport';

describe('mobile playback choices',()=>{
  it('detects iOS Safari, in-app browsers, and desktop-mode iPads',()=>{
    expect(isAppleMobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isAppleMobileBrowser('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe(true);
    expect(isAppleMobileBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5)).toBe(true);
    expect(isAppleMobileBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 0)).toBe(false);
    expect(isAppleMobileBrowser('Mozilla/5.0 (Linux; Android 15)', 'Linux', 5)).toBe(false);
  });
  it('prefers native HLS on iPhone even if hls.js supports Managed Media Source',()=>{
    expect(selectPlaybackEngine({isHls:true,nativeHls:true,hlsJsSupported:true,appleMobile:true})).toBe('native');
    expect(selectPlaybackEngine({isHls:true,nativeHls:true,hlsJsSupported:true,appleMobile:false})).toBe('hlsjs');
    expect(selectPlaybackEngine({isHls:true,nativeHls:true,hlsJsSupported:false,appleMobile:true})).toBe('native');
    expect(selectPlaybackEngine({isHls:true,nativeHls:false,hlsJsSupported:false,appleMobile:true})).toBe('unsupported');
    expect(selectPlaybackEngine({isHls:false,nativeHls:false,hlsJsSupported:false,appleMobile:true})).toBe('native');
  });
  it('distinguishes mixed-content blocks and autoplay permissions',()=>{
    expect(isBlockedMixedMedia('https:','http://example.net/live.m3u8')).toBe(true);
    expect(isBlockedMixedMedia('http:','http://example.net/live.m3u8')).toBe(false);
    expect(isBlockedMixedMedia('https:','https://example.net/live.m3u8')).toBe(false);
    expect(needsUserPlayGesture(Object.assign(new Error('The request is not allowed'),{name:'NotAllowedError'}))).toBe(true);
    expect(needsUserPlayGesture(new Error('Network error'))).toBe(false);
  });
});
