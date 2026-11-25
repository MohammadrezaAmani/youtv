import {expect,test} from 'vitest';
import {playbackPreparation} from '../features/player/playbackPreparation';
const sample={elapsedMs:3000,inactivityMs:500,bufferedSeconds:5,targetSeconds:10,downloadedBytes:500000,totalBytes:1000000,bytesPerSecond:250000,mediaBitsPerSecond:1600000};
test('estimates remaining startup from actual throughput and bitrate',()=>{
 const result=playbackPreparation(sample);
 expect(result.phase).toBe('buffering');expect(result.etaSeconds).toBe(4);
 expect(result.elapsedSeconds).toBe(3);
});
test('does not promise an ETA for an unknown or stalled connection',()=>{
 expect(playbackPreparation({...sample,bytesPerSecond:0}).etaSeconds).toBeNull();
 expect(playbackPreparation({...sample,mediaBitsPerSecond:0}).etaSeconds).toBeNull();
 const waiting=playbackPreparation({...sample,inactivityMs:9000});
 expect(waiting.phase).toBe('waiting');expect(waiting.etaSeconds).toBeNull();expect(waiting.inactiveSeconds).toBe(9);
});
test('recognizes ready media despite small track timestamp offsets',()=>{
 expect(playbackPreparation({...sample,bufferedSeconds:9.88}).phase).toBe('ready');
 expect(playbackPreparation({...sample,nativeReady:true,bufferedSeconds:2}).phase).toBe('ready');
});
