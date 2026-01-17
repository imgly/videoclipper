import { Loader2 } from "lucide-react";
import type { GeminiConceptChoice, SpeakerPreview } from "@/features/shortener/types";
import type { TranscriptWord } from "@/lib/transcript";
import { calculateDurationFromWords } from "@/features/shortener/keepRanges";

const formatDuration = (seconds: number | null): string | null => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  if (seconds < 60) {
    // Show one decimal place for seconds
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

type HighlightPickerProps = {
  conceptChoices: GeminiConceptChoice[];
  selectedConceptId: string | null;
  applyingConceptId: string | null;
  isApplyingConcept: boolean;
  onSelect: (conceptId: string) => void;
  onShortenAnother?: () => void;
  shortenAnotherLabel?: string;
  speakerPreviews?: Record<string, SpeakerPreview[]>;
  sourceWords?: TranscriptWord[];
  totalDuration?: number;
  title?: string;
  showSpeakerThumbnails?: boolean;
};

const HighlightPicker = ({
  conceptChoices,
  selectedConceptId,
  applyingConceptId,
  isApplyingConcept,
  onSelect,
  onShortenAnother,
  shortenAnotherLabel = "Shorten another video",
  speakerPreviews,
  sourceWords = [],
  totalDuration = 0,
  title = "Results",
  showSpeakerThumbnails = true,
}: HighlightPickerProps) => (
  <div className="rounded-xl border bg-card p-4">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {isApplyingConcept && (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      )}
    </div>
    <div className="mt-3 space-y-3">
      {conceptChoices.map((concept) => {
        const isActive = selectedConceptId === concept.id;
        const isBusy =
          applyingConceptId === concept.id && isApplyingConcept;
        const preciseDuration =
          sourceWords.length && totalDuration > 0 && concept.trimmed_words?.length
            ? calculateDurationFromWords(
                sourceWords,
                concept.trimmed_words,
                totalDuration,
                1 // MIN_CLIP_DURATION_SECONDS
              )
            : concept.estimated_duration_seconds ?? null;
        const durationLabel = formatDuration(preciseDuration);
        const speakers = speakerPreviews?.[concept.id] ?? [];
        return (
          <button
            key={concept.id}
            type="button"
            onClick={() => onSelect(concept.id)}
            disabled={isApplyingConcept && !isBusy}
            className={`w-full rounded-lg border px-4 py-3 text-left transition ${
              isActive
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-muted-foreground/60 hover:bg-muted/20"
            } ${isBusy ? "opacity-70" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {concept.title}
                </p>
                {concept.description && (
                  <p className="mt-1 text-base text-muted-foreground">
                    {concept.description}
                  </p>
                )}
              </div>
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : isActive ? (
                <span className="text-xs font-medium text-primary">
                  Active
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {durationLabel && <span>{durationLabel}</span>}
            </div>
            {showSpeakerThumbnails && speakers.length ? (
              <div className="mt-3 border-t pt-3">
                <div className="mt-2 flex flex-wrap gap-4">
                  {speakers.map((speaker) => {
                    const thumbnails = speaker.thumbnails.slice(0, 3);
                    return (
                      <div
                        key={speaker.id}
                        className="flex -space-x-2"
                      >
                        {thumbnails.length ? (
                          thumbnails.map((thumb) => (
                            <div
                              key={thumb.id}
                              className="h-9 w-9 overflow-hidden rounded-full border bg-background"
                            >
                              <img
                                src={thumb.src}
                                alt="Speaker face"
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          ))
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-dashed text-[10px] text-muted-foreground">
                            No face
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
    {onShortenAnother && (
      <div className="mt-4">
        <button
          type="button"
          onClick={onShortenAnother}
          className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
        >
          {shortenAnotherLabel}
        </button>
      </div>
    )}
  </div>
);

export default HighlightPicker;
