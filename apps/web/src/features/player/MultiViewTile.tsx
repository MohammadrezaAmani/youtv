import { ChannelImage } from "@/components/common/RoutedAsset";
import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { hlsRelayLoader } from "./hlsRelayLoader";
import { releasePlayback } from "./playbackLifecycle";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { Channel } from "@youtv/shared";
import { ActionButton } from "@/components/ui/action-button";
import {
  activeWorker,
  resolveStream,
  effectiveConnectionMode,
} from "@/lib/proxy";
import { getHlsProfile } from "./liveBuffer";
import { isProbablyHls } from "./mediaUtils";
import {
  isAppleMobileBrowser,
  isBlockedMixedMedia,
  needsUserPlayGesture,
  isInterruptedPlay,
  selectPlaybackEngine,
} from "./playbackSupport";
import { useYoutv } from "@/stores/useYoutv";

type Props = {
  channel: Channel;
  audible: boolean;
  onAudio: () => void;
  onFocus: () => void;
  onRemove: () => void;
  primary: boolean;
};

/** Independent media pipeline for every visible tile. Every HLS engine is destroyed on unmount. */
export default function MultiViewTile({
  channel,
  audible,
  onAudio,
  onFocus,
  onRemove,
  primary,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const settings = useYoutv((state) => state.settings);
  const workers = useYoutv((state) => state.workers);
  const [status, setStatus] = useState<
    "loading" | "playing" | "paused" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [retries, setRetries] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [forceProxy, setForceProxy] = useState(false);
  // Device emulation can change navigator values while a video is playing.
  // Keep capabilities fixed for this mounted player; responsive CSS only
  // changes the layout, never the media engine or connection policy.
  const [appleMobile] = useState(() =>
    typeof navigator !== "undefined" &&
    isAppleMobileBrowser(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    ),
  );
  const mode = useMemo(() => {
    try {
      const effective = effectiveConnectionMode(channel, settings);
      const useWorker =
        appleMobile &&
        effective === "auto" &&
        Boolean(activeWorker(channel, settings, workers)) &&
        Boolean(channel.iptv.userAgent || channel.iptv.referer);
      return {
        stream: resolveStream(
          channel,
          settings,
          workers,
          forceProxy || useWorker,
        ),
        error: "",
      };
    } catch (e) {
      return {
        stream: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [channel, settings, workers, forceProxy, appleMobile]);
  const url = mode.stream?.url ?? "";
  const hls = isProbablyHls(channel.url, channel.format);
  const sourceIsHls = hls || url.includes("hls=1");
  const nativeHls = useMemo(
    () =>
      typeof document !== "undefined" &&
      !!document
        .createElement("video")
        .canPlayType("application/vnd.apple.mpegurl"),
    [],
  );
  const hlsJsSupported = useMemo(() => Hls.isSupported(), []);
  const playbackEngine = selectPlaybackEngine({
    isHls: sourceIsHls,
    nativeHls,
    hlsJsSupported,
    appleMobile,
    relayed: Boolean(mode.stream?.worker),
  });
  const effectiveMode = effectiveConnectionMode(channel, settings);
  const canFallback =
    effectiveMode === "auto" &&
    !forceProxy &&
    Boolean(activeWorker(channel, settings, workers));
  useEffect(() => {
    setForceProxy(false);
  }, [channel.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = !audible;
  }, [audible]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!url) {
      setStatus("error");
      setError(mode.error || "Source unavailable");
      return;
    }
    let disposed = false;
    let engine: Hls | null = null;
    let networkFailures = 0;
    let mediaFailures = 0;
    setStatus("loading");
    setError("");
    video.muted = !audible;
    video.playsInline = true;
    if (appleMobile) video.setAttribute("webkit-playsinline", "");
    const tryPlay = () => {
      if (!disposed)
        void video.play().catch((error) => {
          if (!disposed && !isInterruptedPlay(error)) {
            setStatus(needsUserPlayGesture(error) ? "paused" : "error");
            if (!needsUserPlayGesture(error))
              setError(error instanceof Error ? error.message : String(error));
          }
        });
    };
    const onPlaying = () => {
      if (!disposed) setStatus("playing");
    };
    const onPause = () => {
      if (!disposed) setStatus("paused");
    };
    const onError = () => {
      if (!disposed && video.error && video.error.code !== 1) {
        if (engine) return; // hls.js owns network/decoder recovery.
        if (canFallback) {
          setForceProxy(true);
          return;
        }
        setStatus("error");
        setError(
          video.error?.code === 4
            ? "Unsupported codec or media format"
            : "Media network or playback error",
        );
      }
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onError);
    if (isBlockedMixedMedia(window.location.protocol, url)) {
      if (canFallback) {
        setForceProxy(true);
      } else {
        setStatus("error");
        setError(
          "This HTTP media requires an active HTTPS Worker; keep its original HTTP URL.",
        );
      }
    } else if (playbackEngine === "hlsjs") {
      video.crossOrigin = "anonymous";
      engine = new Hls({
        ...getHlsProfile(settings.hlsLatencyMode),
        loader: hlsRelayLoader(mode.stream?.worker, url),
        maxBufferLength: settings.hlsLatencyMode === "low" ? 16 : 24,
        maxMaxBufferLength: settings.hlsLatencyMode === "low" ? 32 : 42,
        // Do not switch network renditions merely because the tile is resized.
        capLevelToPlayerSize: false,
      });
      engine.on(Hls.Events.MANIFEST_PARSED, tryPlay);
      engine.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaFailures++ < 1) {
          engine?.recoverMediaError();
          return;
        }
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR && (engine?.levels.length ?? 0) > 0 &&
          networkFailures++ < 2
        ) {
          engine?.startLoad();
          return;
        }
        if (canFallback) {
          setForceProxy(true);
          return;
        }
        setStatus("error");
        setError(data.details);
      });
      engine.loadSource(url);
      engine.attachMedia(video);
    } else if (playbackEngine === "unsupported") {
      setStatus("error");
      setError("HLS not supported");
    } else {
      // Native HLS must not opt in to cross-origin CORS, unlike hls.js.
      video.removeAttribute("crossorigin");
      video.src = url;
      video.load();
      tryPlay();
    }
    return () => {
      disposed = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onError);
      releasePlayback(video, engine);
    };
    // Reinitialization depends on channel/source and explicit retry, not on audio selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, url, hls, retries, playbackEngine, settings.hlsLatencyMode]);

  return (
    <section
      className={`multiview-tile ${primary ? "is-primary" : ""} ${expanded ? "is-expanded" : ""}`}
    >
      <div className="multiview-head">
        <div className="multiview-identity">
          {channel.logo && <ChannelImage channel={channel} route={{ mode: effectiveMode, worker: mode.stream?.worker }} alt="" loading="lazy" />}
          <strong title={channel.name}>{channel.name}</strong>
        </div>
        <div className="multiview-actions">
          <ActionButton
            aria-label={audible ? "Mute tile" : "Unmute tile"}
            title={audible ? "Mute" : "Listen"}
            onClick={() => {
              const video = videoRef.current;
              if (video) {
                video.muted = audible;
                if (!audible && video.paused)
                  void video.play().catch(() => setStatus("paused"));
              }
              onAudio();
            }}
          >
            {audible ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </ActionButton>
          <ActionButton
            aria-label="Focus channel"
            title="Focus"
            onClick={onFocus}
          >
            <Maximize2 size={15} />
          </ActionButton>
          <ActionButton
            aria-label={expanded ? "Reduce tile" : "Enlarge tile"}
            title={expanded ? "Reduce" : "Enlarge"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </ActionButton>
          {!primary && (
            <ActionButton
              aria-label="Remove tile"
              title="Remove"
              onClick={onRemove}
            >
              <X size={16} />
            </ActionButton>
          )}
        </div>
      </div>
      <div className="multiview-screen">
        <video
          ref={videoRef}
          playsInline
          preload={appleMobile ? "metadata" : "auto"}
          autoPlay
          muted={!audible}
        />
        {status === "loading" && (
          <div className="multiview-spinner" aria-label="Loading video" />
        )}
        {status === "error" && (
          <div className="multiview-error">
            <span>{error || mode.error}</span>
            <ActionButton onClick={() => setRetries((n) => n + 1)}>
              <RefreshCw size={17} />
            </ActionButton>
          </div>
        )}
        {status === "paused" && (
          <ActionButton
            className="multiview-play"
            aria-label="Play tile"
            onClick={() => void videoRef.current?.play()}
          >
            <Play fill="currentColor" size={22} />
          </ActionButton>
        )}
      </div>
      <div className="multiview-foot">
        <ActionButton
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) void video.play();
            else video.pause();
          }}
          aria-label="Toggle playback"
        >
          {status === "playing" ? <Pause size={15} /> : <Play size={15} />}
        </ActionButton>
        <span>{channel.group || channel.country || "YouTV"}</span>
      </div>
    </section>
  );
}
