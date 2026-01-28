import { cn } from "@/lib/utils";
import type { AspectRatioOption } from "@/features/shortener/aspect-ratios";
import OptionPicker from "./option-picker";

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
}: AspectRatioPickerProps) => {
  const ratioMap = new Map(options.map((opt) => [opt.id, opt.ratio]));

  const renderPreview = (id: string, isActive: boolean) => {
    const ratio = ratioMap.get(id) ?? 1;
    const { width, height } = getRatioDimensions(ratio);
    return (
      <div
        className={cn(
          "rounded-sm border-2 transition-colors",
          isActive ? "border-foreground/90" : "border-muted-foreground/70"
        )}
        style={{ width, height }}
      />
    );
  };

  return (
    <OptionPicker
      options={options}
      value={value}
      onChange={onChange}
      renderPreview={renderPreview}
      disabled={disabled}
      className={className}
      ariaLabel="Aspect ratio"
    />
  );
};

export default AspectRatioPicker;
