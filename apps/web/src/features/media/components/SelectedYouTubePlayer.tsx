import { useEffect, useState } from "react";
import type { WorkerProfile } from "@youtv/shared";
import { Button } from "@/components/ui/button";
import { resolveYouTubePlayback, type YouTubePlaybackSource } from "../services/youtube";
import { mediaError } from "../services/mediaRoutes";
import MediaPlayer from "./MediaPlayer";

type Props = {
  workers: WorkerProfile[]; videoId: string; itag: number; audioItag?: number;
  title: string; fa: boolean;
};
type Ready = { index: number; type: YouTubePlaybackSource["type"]; url: string };

/** Selected playback deliberately stays on configured Workers, even when direct
 * iframe fallback is enabled. Every fallback re-resolves the SAME track(s). */
export default function SelectedYouTubePlayer({ workers, videoId, itag, audioItag, title, fa }: Props) {
  const [start, setStart] = useState(0);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setReady(null); setError(""); setLoading(true);
    void (async () => {
      const failures: string[] = [];
      for (let index = start; index < workers.length; index++) {
        const worker = workers[index];
        if (!worker) continue;
        try {
          const source = await resolveYouTubePlayback(worker, videoId, itag, audioItag, controller.signal);
          if (controller.signal.aborted) return;
          const url = source.type === "dash"
            ? (objectUrl = URL.createObjectURL(new Blob([source.manifest], { type: "application/dash+xml" })))
            : source.url;
          setReady({ index, type: source.type, url }); setLoading(false); return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          failures.push(`${worker.name}: ${mediaError(cause, worker)}`);
        }
      }
      if (!controller.signal.aborted) {
        setError(failures.join(" | ") || (fa ? "مسیر دیگری برای این فرمت وجود ندارد." : "No other Worker route for this format."));
        setLoading(false);
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [workers, videoId, itag, audioItag, start, revision, fa]);
  const failed = (index: number) => {
    setReady(null);
    setStart(current => Math.max(current, index + 1));
  };
  return <div className="media-selected-player">
    <p className="media-provider">{fa ? "پخش فرمت انتخاب‌شده" : "Selected format playback"} · itag {itag}{audioItag !== undefined ? ` + ${audioItag}` : ""}{ready ? ` · ${workers[ready.index]?.name || ""}` : ""}</p>
    {loading && <p role="status">{fa ? "در حال آماده‌سازی پخش از Worker…" : "Preparing playback through Worker…"}</p>}
    {error && <div className="media-inline-warning" role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setStart(0); setRevision(value => value + 1); }}>{fa ? "تلاش مجدد" : "Retry"}</Button></div>}
    {ready && <MediaPlayer src={ready.url} sourceUrl={`https://www.youtube.com/watch?v=${videoId}`} title={title} kind={ready.type === "dash" ? "dash" : ready.type === "audio" ? "audio" : "video"} worker={workers[ready.index]} onError={() => failed(ready.index)} />}

  </div>;
}
