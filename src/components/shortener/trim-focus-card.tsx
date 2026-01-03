import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import AspectRatioPicker from "@/components/shortener/aspect-ratio-picker";
import { Button } from "@/components/ui/button";
import { ASPECT_RATIO_OPTIONS } from "@/features/shortener/aspect-ratios";
import type {
  RefinementMode,
  SpeechToTextProvider,
} from "@/features/shortener/types";

type TrimFocusCardProps = {
  refinementMode: RefinementMode;
  onRefinementModeChange: (mode: RefinementMode) => void;
  autoProcessing: boolean;
  isStartDisabled: boolean;
  onStart: () => void;
  aspectRatioId?: string | null;
  onAspectRatioChange?: (ratioId: string) => void;
  showAspectRatio?: boolean;
  speechProvider?: SpeechToTextProvider;
  onSpeechProviderChange?: (provider: SpeechToTextProvider) => void;
  showSpeechProvider?: boolean;
  preview?: ReactNode;
  previewFooter?: ReactNode;
  showOptions?: boolean;
  showAction?: boolean;
  layout?: "split" | "full";
};

const OPTIONS: {
  value: RefinementMode;
  title: string;
  description: string;
}[] = [
  {
    value: "disfluency",
    title: "Clean delivery",
    description: "Remove filler words and pacing bumps. Length stays similar.",
  },
  {
    value: "thirty_seconds",
    title: "30-second highlight",
    description: "Trim to a punchy 30 seconds while keeping the key beats.",
  },
  {
    value: "sixty_seconds",
    title: "1-minute highlight",
    description: "Keep the most impactful beats and target roughly 60 seconds.",
  },
];

const SPEECH_PROVIDER_OPTIONS: {
  value: SpeechToTextProvider;
  title: string;
  description: string;
}[] = [
  {
    value: "elevenlabs",
    title: "ElevenLabs",
    description: "Fast, word-level timestamps.",
  },
  {
    value: "openai-whisper",
    title: "OpenAI Whisper",
    description: "whisper-1 with word timestamps.",
  },
  {
    value: "openai-gpt4o",
    title: "OpenAI GPT-4o",
    description: "Higher quality with word-level timestamps.",
  },
];

const TrimFocusCard = ({
  refinementMode,
  onRefinementModeChange,
  autoProcessing,
  isStartDisabled,
  onStart,
  aspectRatioId,
  onAspectRatioChange,
  showAspectRatio = false,
  speechProvider,
  onSpeechProviderChange,
  showSpeechProvider = false,
  preview,
  previewFooter,
  showOptions = true,
  showAction = true,
  layout = "split",
}: TrimFocusCardProps) => {
  const isFullLayout = layout === "full";
  const shouldShowOptions = showOptions;
  const shouldShowAction = showAction;
  const shouldShowAspectRatio =
    showAspectRatio && Boolean(onAspectRatioChange) && Boolean(aspectRatioId);
  const shouldShowSpeechProvider =
    showSpeechProvider &&
    Boolean(onSpeechProviderChange) &&
    Boolean(speechProvider);
  const hasActions =
    shouldShowOptions ||
    shouldShowAspectRatio ||
    shouldShowSpeechProvider ||
    shouldShowAction;
  const options = shouldShowOptions ? (
    <div className="space-y-2 text-left">
      <p className="text-sm font-medium text-foreground">Trim focus</p>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const isActive = refinementMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onRefinementModeChange(option.value)}
              className={`rounded-md border p-3 text-left transition ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-muted"
              }`}
              aria-pressed={isActive}
              disabled={autoProcessing}
            >
              <div className="text-sm font-medium text-foreground">
                {option.title}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const aspectRatioOptions = shouldShowAspectRatio ? (
    <div className="space-y-2 text-left">
      <p className="text-sm font-medium text-foreground">Target aspect ratio</p>
      <AspectRatioPicker
        options={ASPECT_RATIO_OPTIONS}
        value={aspectRatioId ?? ASPECT_RATIO_OPTIONS[1]?.id ?? "16:9"}
        onChange={(ratioId) => onAspectRatioChange?.(ratioId)}
        disabled={autoProcessing}
      />
    </div>
  ) : null;

  const speechProviderOptions = shouldShowSpeechProvider ? (
    <div className="space-y-2 text-left">
      <p className="text-sm font-medium text-foreground">Speech to text</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {SPEECH_PROVIDER_OPTIONS.map((option) => {
          const isActive = speechProvider === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSpeechProviderChange?.(option.value)}
              className={`rounded-md border p-3 text-left transition ${
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-muted"
              }`}
              aria-pressed={isActive}
              disabled={autoProcessing}
            >
              <div className="text-sm font-medium text-foreground">
                {option.title}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const action = shouldShowAction ? (
    <Button className="w-full" onClick={onStart} disabled={isStartDisabled}>
      {autoProcessing ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </>
      ) : (
        "Start automatic edit"
      )}
    </Button>
  ) : null;

  const content = hasActions ? (
    <div className="space-y-4">
      {options}
      {aspectRatioOptions}
      {speechProviderOptions}
      {action}
    </div>
  ) : null;

  if (!preview) {
    return <div className="rounded-xl border bg-card p-4">{content}</div>;
  }

  if (isFullLayout) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        {preview}
        {previewFooter && <div className="p-4">{previewFooter}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_1px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="w-full">{preview}</div>
          {previewFooter}
        </div>
        <div className="hidden self-stretch bg-border md:block" aria-hidden="true" />
        <div
          className={`transition-opacity duration-300 ${
            !hasActions ? "pointer-events-none opacity-0" : ""
          }`}
          aria-hidden={!hasActions}
        >
          {content}
        </div>
      </div>
    </div>
  );
};

export default TrimFocusCard;
