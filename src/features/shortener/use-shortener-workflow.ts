import { useState } from "react";
import { createInitialProcessingState } from "./constants";
import type {
  GeminiConceptChoice,
  ProcessingStatus,
  ProcessingStepId,
  RefinementMode,
} from "./types";

export const useShortenerWorkflow = () => {
  const [refinementMode, setRefinementMode] =
    useState<RefinementMode>("disfluency");
  const [autoProcessing, setAutoProcessing] = useState(false);
  const [autoProcessStatuses, setAutoProcessStatuses] = useState<
    Record<ProcessingStepId, ProcessingStatus>
  >(createInitialProcessingState);
  const [autoProcessingError, setAutoProcessingError] = useState<string | null>(
    null
  );
  const [conceptChoices, setConceptChoices] = useState<GeminiConceptChoice[]>([]);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [isApplyingConcept, setIsApplyingConcept] = useState(false);
  const [applyingConceptId, setApplyingConceptId] = useState<string | null>(null);
  const [hasStartedWorkflow, setHasStartedWorkflow] = useState(false);

  const resetProcessingStatuses = () => {
    setAutoProcessStatuses(createInitialProcessingState());
  };

  const updateProcessingStatus = (
    step: ProcessingStepId,
    status: ProcessingStatus
  ) => {
    setAutoProcessStatuses((prev) => ({
      ...prev,
      [step]: status,
    }));
  };

  const resetWorkflowState = () => {
    setAutoProcessing(false);
    setAutoProcessingError(null);
    resetProcessingStatuses();
    setConceptChoices([]);
    setSelectedConceptId(null);
    setIsApplyingConcept(false);
    setApplyingConceptId(null);
    setHasStartedWorkflow(false);
  };

  const beginWorkflow = () => {
    setHasStartedWorkflow(true);
    setAutoProcessing(true);
    setAutoProcessingError(null);
    resetProcessingStatuses();
    setConceptChoices([]);
    setSelectedConceptId(null);
    setIsApplyingConcept(false);
    setApplyingConceptId(null);
  };

  return {
    refinementMode,
    setRefinementMode,
    autoProcessing,
    setAutoProcessing,
    autoProcessStatuses,
    autoProcessingError,
    setAutoProcessingError,
    conceptChoices,
    setConceptChoices,
    selectedConceptId,
    setSelectedConceptId,
    isApplyingConcept,
    setIsApplyingConcept,
    applyingConceptId,
    setApplyingConceptId,
    hasStartedWorkflow,
    updateProcessingStatus,
    resetWorkflowState,
    beginWorkflow,
  };
};
