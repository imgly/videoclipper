import { cn } from "@/lib/utils";
import type { AspectRatioOption } from "@/features/shortener/aspect-ratios";

type AspectRatioPickerProps = {
  options: AspectRatioOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
};

const ICON_BASE_SIZE = 44;

const getRatioDimensions = (ratio: number) => {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return { width: ICON_BASE_SIZE, height: ICON_BASE_SIZE };
  }
  if (ratio >= 1) {
    return { width: ICON_BASE_SIZE, height: ICON_BASE_SIZE / ratio };
  }
  return { width: ICON_BASE_SIZE * ratio, height: ICON_BASE_SIZE };
};

const AspectRatioPicker = ({
  options,
  value,
  onChange,
  disabled = false,
  className,
}: AspectRatioPickerProps) => (
  <div
    className={cn("flex flex-wrap gap-3", className)}
    role="group"
    aria-label="Aspect ratio"
  >
    {options.map((option) => {
      const isActive = value === option.id;
      const { width, height } = getRatioDimensions(option.ratio);
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
            <div
              className={cn(
                "rounded-sm border-2 transition-colors",
                isActive ? "border-foreground/90" : "border-muted-foreground/70"
              )}
              style={{ width, height }}
            />
          </div>
          <span>{option.label}</span>
        </button>
      );
    })}
  </div>
);

export default AspectRatioPicker;
