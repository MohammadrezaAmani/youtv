import { useMemo } from "react";
import { createChannel, type WorkerProfile } from "@youtv/shared";
import PlayerStage from "@/features/player/PlayerStage";

/** Reuse the TV player's controls and lifecycle. The caller owns routing. */
export default function MediaPlayer({ src, sourceUrl, title, kind = "video", worker, poster, onError }: {
  src: string; sourceUrl: string; title: string; kind?: "video" | "audio" | "hls" | "dash";
  worker?: WorkerProfile; poster?: string; onError?: (message: string) => void;
}) {
  const channel = useMemo(() => createChannel({ name: title.trim().slice(0, 160) || "Media", url: sourceUrl,
    format: kind === "hls" ? "hls" : "video", group: "Media Center", proxyMode: worker ? "proxy" : "direct", workerId: worker?.id || "" }), [sourceUrl, title, kind, worker?.id]);
  const preparedSource = useMemo(() => ({ url: src, kind, worker, poster }), [src, kind, worker, poster]);
  if (!src) return null;
  return <PlayerStage key={`${src}|${kind}`} channel={channel} preparedSource={preparedSource} onTerminalError={onError} />;
}
