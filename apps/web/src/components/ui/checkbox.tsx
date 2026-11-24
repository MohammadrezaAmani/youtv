import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
type Props = {
  checked: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
  onChange?: (e: { target: { checked: boolean } }) => void;
};
/** Native checkbox semantics (including label activation) with a fully custom visual control. */
export function Checkbox({
  checked,
  disabled,
  id,
  name,
  className,
  onChange,
  ...rest
}: Props) {
  return (
    <span className={cn("ui-control-shell", className)}>
      <input
        type="checkbox"
        className="ui-control-native"
        id={id}
        name={name}
        checked={checked}
        disabled={disabled}
        aria-label={rest["aria-label"]}
        onChange={(e) =>
          onChange?.({ target: { checked: e.currentTarget.checked } })
        }
      />
      <span aria-hidden="true" className="ui-checkbox">
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
    </span>
  );
}
