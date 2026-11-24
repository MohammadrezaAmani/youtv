import { useEffect, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Channel, WorkerProfile } from "@youtv/shared";
import { channelAssetRoutes } from "@/lib/assetRoutes";
import type { ConnectionMode } from "@/lib/proxy";
import { useYoutv } from "@/stores/useYoutv";

type ImageProps = Omit<ComponentPropsWithoutRef<"img">, "src" | "srcSet"> & {
  urls: string[];
  fallback?: ReactNode;
};

// Remount only when the route list changes (URL, Worker, token or policy).
// A stale error event from a previous image cannot advance the new route.
export function RoutedImage(props: ImageProps) {
  return <ImageAttempt key={JSON.stringify(props.urls)} {...props} />;
}
function ImageAttempt({ urls, fallback = null, onError, ...props }: ImageProps) {
  const [index, setIndex] = useState(0);
  const src = urls[index];
  if (!src) return <>{fallback}</>;
  return <img {...props} key={src} src={src} referrerPolicy="no-referrer" onError={event => {
    setIndex(current => current === index ? current + 1 : current);
    if (index + 1 >= urls.length) onError?.(event);
  }} />;
}

export function ChannelImage({ channel, route, ...props }: Omit<ImageProps, "urls"> & {
  channel: Channel;
  route?: { mode: ConnectionMode; worker?: WorkerProfile };
}) {
  const settings = useYoutv(state => state.settings);
  const workers = useYoutv(state => state.workers);
  return <RoutedImage {...props} urls={channelAssetRoutes(channel.logo, channel, settings, workers, route)} />;
}

type VideoProps = Omit<ComponentPropsWithoutRef<"video">, "src" | "poster" | "children"> & {
  urls: string[];
  posters: string[];
};
export function RoutedVideo(props: VideoProps) {
  return <VideoAttempt key={JSON.stringify([props.urls, props.posters])} {...props} />;
}
function VideoAttempt({ urls, posters, onError, ...props }: VideoProps) {
  const [index, setIndex] = useState(0);
  const [posterIndex, setPosterIndex] = useState(0);
  const poster = posters[posterIndex];
  // The video element does not emit a useful event when only its poster fails.
  useEffect(() => {
    if (!poster) return;
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onerror = () => setPosterIndex(current => current === posterIndex ? current + 1 : current);
    image.src = poster;
    return () => { image.onerror = null; };
  }, [poster, posterIndex]);
  const src = urls[index];
  if (!src) return null;
  return <video {...props} key={src} src={src} poster={poster} onError={event => {
    setIndex(current => current === index ? current + 1 : current);
    if (index + 1 >= urls.length) onError?.(event);
  }} />;
}
