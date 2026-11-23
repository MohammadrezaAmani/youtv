import {describe,expect,it,vi} from 'vitest';
import {enterPlayerFullscreen,isElementFullscreen,isPlayerFullscreen,togglePlayerFullscreen} from '../features/player/fullscreen';

type LegacyVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
  webkitSupportsFullscreen?: boolean;
};
type LegacyDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type LegacyPlayer = HTMLElement & {webkitRequestFullscreen?: () => void};

function elements() {
  return {
    player: {} as LegacyPlayer,
    video: {} as LegacyVideo,
    doc: {fullscreenEnabled:true,fullscreenElement:null} as unknown as LegacyDoc,
  };
}

describe('fullscreen across Safari, iPhone and desktop browsers',()=>{
  it('uses the standards-based element fullscreen API when available',async()=>{
    const {player,video,doc}=elements();
    const request=vi.fn().mockResolvedValue(undefined);
    player.requestFullscreen=request;
    expect(await togglePlayerFullscreen(player,video,doc)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('uses prefixed element fullscreen on older Safari versions',async()=>{
    const {player,video,doc}=elements();
    player.webkitRequestFullscreen=vi.fn();
    expect(await enterPlayerFullscreen(player,video,doc)).toBe(true);
    expect(player.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('uses native iPhone video fullscreen synchronously when element fullscreen is disabled',async()=>{
    const {player,video,doc}=elements();
    Object.defineProperty(doc,'fullscreenEnabled',{value:false});
    player.requestFullscreen=vi.fn();
    video.webkitSupportsFullscreen=true;
    video.webkitEnterFullscreen=vi.fn();
    const promise=togglePlayerFullscreen(player,video,doc);
    expect(video.webkitEnterFullscreen).toHaveBeenCalledTimes(1);
    expect(player.requestFullscreen).not.toHaveBeenCalled();
    expect(await promise).toBe(true);
  });

  it('falls back to native video when the standard API rejects',async()=>{
    const {player,video,doc}=elements();
    player.requestFullscreen=vi.fn().mockRejectedValue(new Error('Not supported'));
    video.webkitEnterFullscreen=vi.fn();
    expect(await enterPlayerFullscreen(player,video,doc)).toBe(true);
    expect(video.webkitEnterFullscreen).toHaveBeenCalledTimes(1);
  });

  it('exits native iOS fullscreen via the video and reports its state',async()=>{
    const {player,video,doc}=elements();
    video.webkitDisplayingFullscreen=true;
    video.webkitExitFullscreen=vi.fn();
    expect(isPlayerFullscreen(doc,video)).toBe(true);
    expect(await togglePlayerFullscreen(player,video,doc)).toBe(true);
    expect(video.webkitExitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('exits prefixed Safari element fullscreen',async()=>{
    const {player,video,doc}=elements();
    doc.webkitFullscreenElement=player;
    doc.webkitExitFullscreen=vi.fn();
    expect(isElementFullscreen(doc)).toBe(true);
    expect(await togglePlayerFullscreen(player,video,doc)).toBe(true);
    expect(doc.webkitExitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does not attempt unsupported native video fullscreen',async()=>{
    const {player,video,doc}=elements();
    Object.defineProperty(doc,'fullscreenEnabled',{value:false});
    video.webkitSupportsFullscreen=false;
    video.webkitEnterFullscreen=vi.fn();
    expect(await enterPlayerFullscreen(player,video,doc)).toBe(false);
    expect(video.webkitEnterFullscreen).not.toHaveBeenCalled();
  });

  it('handles unavailable targets safely',async()=>{
    const {player,video,doc}=elements();
    expect(await togglePlayerFullscreen(null,video,doc)).toBe(false);
    expect(await enterPlayerFullscreen(player,null,doc)).toBe(false);
  });
});
