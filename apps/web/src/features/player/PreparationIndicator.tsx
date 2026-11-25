import { useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A player control, with details outside the document flow. */
export function PreparationIndicator({ progress, label, children }: {
  progress: number;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 8, left: 8 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = button.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(300, window.innerWidth - 24);
      const height = panel.current?.offsetHeight ?? 180;
      setPosition({
        left: Math.max(12, Math.min(window.innerWidth - width - 12, trigger.right - width)),
        top: Math.max(12, trigger.top - height - 8),
      });
    };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !button.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return <>
    <button ref={button} type="button" className="preparation-indicator" aria-label={label}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle className="preparation-ring-track" cx="14" cy="14" r="11" />
        <circle className="preparation-ring-value" cx="14" cy="14" r="11" pathLength="100"
          strokeDasharray="100" strokeDashoffset={100 - percent} />
      </svg>
      <span aria-hidden="true">?</span>
      <span className="sr-only" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} />
    </button>
    {open && createPortal(<div ref={panel} id={id} className="preparation-popover" role="dialog" aria-label={label}
      dir="auto" style={position} onKeyDown={event => event.stopPropagation()}>{children}</div>, document.fullscreenElement ?? document.body)}
  </>;
}
