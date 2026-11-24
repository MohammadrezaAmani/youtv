import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  LocalRecordingSession,
  initialRecorder,
  type RecorderSnapshot,
} from "./recorder";
export function useLocalRecorder(
  videoRef: RefObject<HTMLVideoElement | null>,
  channelName: string,
  sourceIdentity: string,
) {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot>(initialRecorder);
  const recorder = useRef<LocalRecordingSession | null>(null);
  const start = useCallback(
    async (videoBitsPerSecond = 4_000_000) => {
      const video = videoRef.current;
      if (!video) return;
      if (recorder.current) recorder.current.stop();
      const session = new LocalRecordingSession((state) => {
        if (recorder.current === session) setSnapshot(state);
      });
      recorder.current = session;
      try {
        await session.start(video, channelName, videoBitsPerSecond);
      } catch (error) {
        setSnapshot((state) => ({
          ...state,
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [videoRef, channelName],
  );
  const stop = useCallback(() => recorder.current?.stop(), []);
  const pause = useCallback(() => recorder.current?.pause(), []);
  const resume = useCallback(() => recorder.current?.resume(), []);
  useEffect(() => {
    setSnapshot({ ...initialRecorder });
    return () => {
      // Switching channels or sources finalizes the current clip.
      recorder.current?.stop();
      recorder.current = null;
    };
  }, [sourceIdentity]);
  return { snapshot, start, stop, pause, resume };
}
