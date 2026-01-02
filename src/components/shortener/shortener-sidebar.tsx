import type {
  GeminiConceptChoice,
  ProcessingStatus,
  ProcessingStepId,
  RefinementMode,
} from "@/features/shortener/types";
import HighlightPicker from "./highlight-picker";
import ProcessingStatusCard from "./processing-status-card";
import TrimFocusCard from "./trim-focus-card";

type ShortenerSidebarProps = {
  refinementMode: RefinementMode;
  onRefinementModeChange: (mode: RefinementMode) => void;
  autoProcessing: boolean;
  isStartDisabled: boolean;
  onStart: () => void;
  hasStartedWorkflow: boolean;
  statuses: Record<ProcessingStepId, ProcessingStatus>;
  progress: number;
  autoProcessingError: string | null;
  conceptChoices: GeminiConceptChoice[];
  selectedConceptId: string | null;
  applyingConceptId: string | null;
  isApplyingConcept: boolean;
  onSelectConcept: (conceptId: string) => void;
};

const ShortenerSidebar = ({
  refinementMode,
  onRefinementModeChange,
  autoProcessing,
  isStartDisabled,
  onStart,
  hasStartedWorkflow,
  statuses,
  progress,
  autoProcessingError,
  conceptChoices,
  selectedConceptId,
  applyingConceptId,
  isApplyingConcept,
  onSelectConcept,
}: ShortenerSidebarProps) => (
  <div className="space-y-6">
    <TrimFocusCard
      refinementMode={refinementMode}
      onRefinementModeChange={onRefinementModeChange}
      autoProcessing={autoProcessing}
      isStartDisabled={isStartDisabled}
      onStart={onStart}
    />

    {hasStartedWorkflow && (
      <ProcessingStatusCard
        statuses={statuses}
        progress={progress}
        autoProcessingError={autoProcessingError}
      />
    )}

    {conceptChoices.length > 0 && (
      <HighlightPicker
        conceptChoices={conceptChoices}
        selectedConceptId={selectedConceptId}
        applyingConceptId={applyingConceptId}
        isApplyingConcept={isApplyingConcept}
        onSelect={onSelectConcept}
      />
    )}

  </div>
);

export default ShortenerSidebar;
