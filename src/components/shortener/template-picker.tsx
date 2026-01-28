import type { SpeakerTemplateId, SpeakerTemplateOption } from "@/features/shortener/types";
import OptionPicker from "./option-picker";

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
        <div className="absolute left-2 right-2 top-1/2 flex -translate-y-1/2 items-center justify-center">
          <div className="h-[1.5px] w-full rotate-45 bg-muted-foreground/60" />
        </div>
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

  // Default: stacked
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
  <OptionPicker
    options={options}
    value={value}
    onChange={onChange}
    renderPreview={(id, isActive) => (
      <PreviewOutline templateId={id} isActive={isActive} />
    )}
    disabled={disabled}
    className={className}
    ariaLabel="Template"
  />
);

export default TemplatePicker;
