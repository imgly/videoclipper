import { Loader2 } from "lucide-react";
import type { GeminiConceptChoice, SpeakerPreview } from "@/features/shortener/types";

type HighlightPickerProps = {
  conceptChoices: GeminiConceptChoice[];
  selectedConceptId: string | null;
  applyingConceptId: string | null;
  isApplyingConcept: boolean;
  onSelect: (conceptId: string) => void;
  onShortenAnother?: () => void;
  shortenAnotherLabel?: string;
  speakerPreviews?: Record<string, SpeakerPreview[]>;
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
}: HighlightPickerProps) => (
  <div className="rounded-xl border bg-card p-4">
    <div className="flex items-center justify-between">
      <p className="text-sm font-medium text-foreground">Results</p>
      {isApplyingConcept && (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      )}
    </div>
    <div className="mt-3 space-y-3">
      {conceptChoices.map((concept) => {
        const isActive = selectedConceptId === concept.id;
        const isBusy =
          applyingConceptId === concept.id && isApplyingConcept;
        const durationLabel =
          typeof concept.estimated_duration_seconds === "number" &&
          Number.isFinite(concept.estimated_duration_seconds)
            ? `≈ ${Math.round(concept.estimated_duration_seconds)}s`
            : null;
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
                : "border-muted"
            } ${isBusy ? "opacity-70" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {concept.title}
                </p>
                {concept.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
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
            {speakers.length ? (
              <div className="mt-3 border-t pt-3">
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {speakers.map((speaker) => {
                    const thumbnails = speaker.thumbnails.slice(0, 3);
                    return (
                      <div
                        key={speaker.id}
                        className="flex items-center gap-2"
                      >
                        <div className="flex -space-x-2">
                          {thumbnails.length ? (
                            thumbnails.map((thumb) => (
                              <div
                                key={thumb.id}
                                className="h-9 w-9 overflow-hidden rounded-full border bg-background"
                              >
                                <img
                                  src={thumb.src}
                                  alt={`${speaker.label} face`}
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
                        <span className="text-xs font-medium text-foreground">
                          {speaker.label}
                        </span>
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
      <div className="mt-4 border-t pt-3">
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
