import { ChannelImage } from "@/components/common/RoutedAsset";
import { ActionButton } from "@/components/ui/action-button";
import {
  Heart,
  Play,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Radio,
  Pin,
  Check,
  Tags,
  ExternalLink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Channel } from "@youtv/shared";
import { useYoutv } from "@/stores/useYoutv";
import { ui } from "@/lib/labels";

type Props = {
  channel: Channel;
  healthStatus?: "online" | "offline" | "unknown" | "untested";
  onOpen: () => void;
  onEdit: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onTagClick?: (tag: string) => void;
};
export default function ChannelCard({
  channel,
  healthStatus = "untested",
  onOpen,
  onEdit,
  selectable = false,
  selected = false,
  onToggleSelect,
  onTagClick,
}: Props) {
  const { t } = useTranslation(),
    settings = useYoutv((s) => s.settings);
  const text = (key: Parameters<typeof ui>[0]) => ui(key, settings.language);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = useYoutv((s) => s.toggleFavorite),
    pin = useYoutv((s) => s.togglePinned),
    remove = useYoutv((s) => s.deleteChannel);
  useEffect(() => {
    if (!menu) return;
    const click = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", click);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", click);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  return (
    <article
      className={`channel-card modern-card ${selected ? "card-selected" : ""}`}
    >
      <ActionButton
        className="channel-poster"
        onClick={onOpen}
        aria-label={`${selectable ? text("select") : t("watch")} ${channel.name}`}
      >
        <ChannelImage
          channel={channel}
          loading="lazy"
          alt=""
          fallback={<div className="poster-placeholder">
            <span className="poster-pattern" />
            <Radio size={39} strokeWidth={1.2} />
          </div>}
        />
        <span className="poster-vignette" />
        <span
          className={`channel-health-badge state-${healthStatus}`}
          title={healthStatus}
        >
          <i />
          {healthStatus === "online"
            ? settings.language === "fa"
              ? "متصل"
              : "Online"
            : healthStatus === "offline"
              ? settings.language === "fa"
                ? "قطع"
                : "Offline"
              : healthStatus === "unknown"
                ? settings.language === "fa"
                  ? "نامشخص"
                  : "Unknown"
                : settings.language === "fa"
                  ? "تست‌نشده"
                  : "Untested"}
        </span>
        {channel.pinned && (
          <span className="card-pin">
            <Pin size={13} />
          </span>
        )}
        <span className="poster-play">
          {selectable ? (
            selected ? (
              <Check size={28} />
            ) : (
              <span className="select-ring" />
            )
          ) : (
            <Play fill="currentColor" size={25} />
          )}
        </span>
      </ActionButton>
      <div className="channel-description">
        <div className="channel-details">
          <ActionButton
            className="channel-name"
            onClick={onOpen}
            title={channel.name}
          >
            {channel.name}
          </ActionButton>
          <div className="channel-meta">
            <span>{channel.group || t("channels")}</span>
            {channel.country && <span>· {channel.country}</span>}
            {channel.language && <span>· {channel.language}</span>}
          </div>
          {channel.description && (
            <p className="card-subtitle" title={channel.description}>
              {channel.description}
            </p>
          )}
          {channel.tags.length > 0 && (
            <div className="card-tag-row">
              {channel.tags.slice(0, 3).map((tag) => (
                <ActionButton
                  key={tag}
                  className="card-tag"
                  onClick={() => onTagClick?.(tag)}
                  title={`${text("tag")}: ${tag}`}
                >
                  #{tag}
                </ActionButton>
              ))}
              {channel.tags.length > 3 && (
                <span className="more-tags">+{channel.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>
        <div className="card-actions">
          {selectable ? (
            <ActionButton
              className={`icon-action ${selected ? "is-favorite" : ""}`}
              onClick={onToggleSelect}
              aria-label={text("select")}
              title={text("select")}
            >
              <Check size={18} />
            </ActionButton>
          ) : (
            <ActionButton
              className={`icon-action ${channel.favorite ? "is-favorite" : ""}`}
              onClick={() => toggle(channel.id)}
              aria-pressed={channel.favorite}
              aria-label={t("favorite")}
              title={t("favorite")}
            >
              <Heart
                size={18}
                fill={channel.favorite ? "currentColor" : "none"}
              />
            </ActionButton>
          )}
          <div className="menu-anchor" ref={ref}>
            <ActionButton
              className="icon-action"
              aria-label={text("more")}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={19} />
            </ActionButton>
            {menu && (
              <div className="action-menu modern-menu" role="menu">
                <ActionButton
                  role="menuitem"
                  onClick={() => {
                    onOpen();
                    setMenu(false);
                  }}
                >
                  <Play size={15} />
                  {text("quickPlay")}
                </ActionButton>
                <ActionButton
                  role="menuitem"
                  onClick={() => {
                    onEdit();
                    setMenu(false);
                  }}
                >
                  <Pencil size={15} />
                  {t("edit")}
                </ActionButton>
                <ActionButton
                  role="menuitem"
                  onClick={() => {
                    pin(channel.id);
                    setMenu(false);
                  }}
                >
                  <Pin size={15} />
                  {channel.pinned ? text("unpin") : text("pin")}
                </ActionButton>
                <ActionButton
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard?.writeText(channel.url);
                    setMenu(false);
                  }}
                >
                  <Copy size={15} />
                  {text("copy")}
                </ActionButton>
                <a
                  role="menuitem"
                  href={channel.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => setMenu(false)}
                >
                  <ExternalLink size={15} />
                  {t("url")}
                </a>
                <ActionButton
                  role="menuitem"
                  className="menu-danger"
                  onClick={() => {
                    if (
                      window.confirm(`${t("deleteConfirm")} (${channel.name})`)
                    )
                      remove(channel.id);
                    setMenu(false);
                  }}
                >
                  <Trash2 size={15} />
                  {t("delete")}
                </ActionButton>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
