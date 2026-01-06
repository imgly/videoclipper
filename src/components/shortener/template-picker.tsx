import { cn } from "@/lib/utils";
import type { SpeakerTemplateId, SpeakerTemplateOption } from "@/features/shortener/types";

type TemplatePickerProps = {
  options: SpeakerTemplateOption[];
  value: SpeakerTemplateId;
  onChange: (id: SpeakerTemplateId) => void;
  disabled?: boolean;
  className?: string;
};

const PreviewOutline = ({
  templateId,
  isActive,
}: {
  templateId: SpeakerTemplateId;
  isActive: boolean;
}) => {
  const stroke = isActive ? "border-foreground/90" : "border-muted-foreground/70";
  const outline = `rounded-sm border-2 ${stroke}`;

  if (templateId === "sidecar") {
    return (
      <div className="relative h-12 w-12">
        <div className={`absolute left-1 top-1 bottom-1 right-4 ${outline}`} />
        <div className="absolute right-1 top-1 bottom-1 flex w-2.5 flex-col gap-1">
          <div className={`flex-1 ${outline}`} />
          <div className={`flex-1 ${outline}`} />
          <div className={`flex-1 ${outline}`} />
        </div>
      </div>
    );
  }

  if (templateId === "overlay") {
    return (
      <div className="relative h-12 w-12">
        <div className={`absolute inset-1 ${outline}`} />
        <div className="absolute bottom-1 left-1 right-1 flex h-3 gap-1">
          <div className={`flex-1 ${outline}`} />
          <div className={`flex-1 ${outline}`} />
          <div className={`flex-1 ${outline}`} />
        </div>
      </div>
    );
  }

  if (templateId === "none") {
    return (
      <div className="relative h-12 w-12">
        <div className={`absolute inset-2 ${outline}`} />
        <div className="absolute inset-2 rotate-45 border-t-2 border-dashed border-muted-foreground/60" />
      </div>
    );
  }

  if (templateId === "solo") {
    return (
      <div className="relative h-12 w-12">
        <div className={`absolute inset-1 ${outline}`} />
      </div>
    );
  }

  if (templateId === "multi") {
    return (
      <div className="relative h-12 w-12">
        <div className={`absolute left-1 right-1 top-1 h-6 ${outline}`} />
        <div className="absolute bottom-1 left-1 right-1 flex h-3 gap-1">
          <div className={`flex-1 ${outline}`} />
          <div className={`flex-1 ${outline}`} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-12 w-12">
      <div className={`absolute left-1 top-1 right-1 h-6 ${outline}`} />
      <div className="absolute bottom-1 left-1 right-1 flex h-3 gap-1">
        <div className={`flex-1 ${outline}`} />
        <div className={`flex-1 ${outline}`} />
        <div className={`flex-1 ${outline}`} />
      </div>
    </div>
  );
};

const TemplatePicker = ({
  options,
  value,
  onChange,
  disabled = false,
  className,
}: TemplatePickerProps) => (
  <div
    className={cn("flex flex-wrap gap-3", className)}
    role="group"
    aria-label="Template"
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
              ? "border-primary bg-primary/5 text-foreground"
              : "border-muted text-muted-foreground hover:border-muted-foreground/60",
            disabled && "pointer-events-none opacity-50"
          )}
          aria-pressed={isActive}
          disabled={disabled}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted/30">
            <PreviewOutline templateId={option.id} isActive={isActive} />
          </div>
          <span>{option.label}</span>
        </button>
      );
    })}
  </div>
);

export default TemplatePicker;
