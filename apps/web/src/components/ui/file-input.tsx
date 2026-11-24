import * as React from "react";
import { cn } from "@/lib/utils";
/** Semantically correct file input; styling is driven by a parent label or an explicit trigger. */
export const FileInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="file"
    className={cn("ui-file-input", className)}
    {...props}
  />
));
FileInput.displayName = "FileInput";
