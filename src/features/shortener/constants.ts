import type { ProcessingStepId, ProcessingStatus } from "./types";

export const PROCESSING_STEPS: { id: ProcessingStepId; label: string }[] = [
  { id: "audio", label: "Generating audio" },
  { id: "transcript", label: "Generating transcript" },
  { id: "analysis", label: "Analyzing transcript" },
];

export const createInitialProcessingState = (): Record<
  ProcessingStepId,
  ProcessingStatus
> => ({
  audio: "idle",
  transcript: "idle",
  analysis: "idle",
});
