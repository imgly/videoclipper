import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type OptionPickerOption<T extends string> = {
  id: T;
  label: string;
};

export type OptionPickerProps<T extends string> = {
  options: OptionPickerOption<T>[];
  value: T;
  onChange: (id: T) => void;
  renderPreview: (id: T, isActive: boolean) => ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

const OptionPicker = <T extends string>({
  options,
  value,
  onChange,
  renderPreview,
  disabled = false,
  className,
  ariaLabel = "Options",
}: OptionPickerProps<T>) => (
  <div
    className={cn("flex flex-wrap gap-3", className)}
    role="group"
    aria-label={ariaLabel}
  >
    {options.map((option) => {
      const isActive = value === option.id;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cn(
            "flex w-24 flex-col items-center gap-2 rounded-xl border px-3 py-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isActive
              ? "border-primary text-foreground"
              : "border-muted text-muted-foreground hover:border-muted-foreground/60",
            disabled && "pointer-events-none opacity-50"
          )}
          aria-pressed={isActive}
          disabled={disabled}
        >
          <div className="flex h-12 w-12 items-center justify-center">
            {renderPreview(option.id, isActive)}
          </div>
          <span>{option.label}</span>
        </button>
      );
    })}
  </div>
);

export default OptionPicker;
