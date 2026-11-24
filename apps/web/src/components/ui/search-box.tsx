import * as React from "react";
import { Search, X } from "lucide-react";
import { ActionButton } from "@/components/ui/action-button";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  size?: "default" | "compact";
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onSubmit?: () => void;
  ariaLabel?: string;
};

export function SearchBox({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  size = "default",
  autoFocus,
  inputRef,
  onSubmit,
  ariaLabel,
}: Props) {
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <form
      className={cn(
        "youtv-search",
        size === "compact" && "is-compact",
        className,
      )}
      onSubmit={submit}
      role="search"
    >
      <span className="youtv-search-icon" aria-hidden="true">
        <Search size={size === "compact" ? 16 : 18} />
      </span>
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder || "Search"}
        className={cn("youtv-search-input", inputClassName)}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <ActionButton
          className="youtv-search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={size === "compact" ? 15 : 16} />
        </ActionButton>
      ) : (
        <span className="youtv-search-hint" aria-hidden="true">
          /
        </span>
      )}
    </form>
  );
}
