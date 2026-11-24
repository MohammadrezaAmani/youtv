import * as React from "react";
import { cn } from "@/lib/utils";
/** Accessible slider with shared tokens; native range exists only inside the UI primitive. */
export const Slider = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, min = 0, max = 100, value = 0, style, ...rest }, ref) => {
  const low = Number(min),
    high = Number(max),
    current = Number(value);
  const progress =
    high > low
      ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100))
      : 0;
  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      value={value}
      style={
        { ...style, "--slider-progress": `${progress}%` } as React.CSSProperties
      }
      className={cn("ui-slider", className)}
      {...rest}
    />
  );
});
Slider.displayName = "Slider";
