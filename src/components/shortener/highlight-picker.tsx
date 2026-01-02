import { Loader2 } from "lucide-react";
import type { GeminiConceptChoice } from "@/features/shortener/types";

type HighlightPickerProps = {
  conceptChoices: GeminiConceptChoice[];
  selectedConceptId: string | null;
  applyingConceptId: string | null;
  isApplyingConcept: boolean;
  onSelect: (conceptId: string) => void;
  onShortenAnother?: () => void;
  shortenAnotherLabel?: string;
};

const HighlightPicker = ({
  conceptChoices,
  selectedConceptId,
  applyingConceptId,
  isApplyingConcept,
  onSelect,
  onShortenAnother,
  shortenAnotherLabel = "Shorten another video",
}: HighlightPickerProps) => (
  <div className="rounded-xl border bg-card p-4">
    {isApplyingConcept && (
      <div className="flex justify-end">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      </div>
    )}
    <div className={isApplyingConcept ? "mt-3 space-y-3" : "space-y-3"}>
      {conceptChoices.map((concept) => {
        const isActive = selectedConceptId === concept.id;
        const isBusy =
          applyingConceptId === concept.id && isApplyingConcept;
        const durationLabel =
          typeof concept.estimated_duration_seconds === "number" &&
          Number.isFinite(concept.estimated_duration_seconds)
            ? `≈ ${Math.round(concept.estimated_duration_seconds)}s`
            : null;
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
                <p className="text-sm font-semibold text-foreground">
                  {concept.title}
                </p>
                {concept.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
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
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {durationLabel && <span>{durationLabel}</span>}
              {concept.notes && <span>{concept.notes}</span>}
            </div>
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
