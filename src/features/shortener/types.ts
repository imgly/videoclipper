import type {
  ElevenLabsTranscriptResponse,
  TranscriptWord,
} from "@/lib/transcript";

export type TranscriptionResult = {
  transcript: string;
  rawResponse: ElevenLabsTranscriptResponse;
};

export type RefinementMode = "disfluency" | "thirty_seconds" | "sixty_seconds";

export type GeminiConceptRaw = {
  id?: string | null;
  title?: string | null;
  name?: string | null;
  label?: string | null;
  description?: string | null;
  summary?: string | null;
  concept_title?: string | null;
  concept_summary?: string | null;
  hook?: string | null;
  notes?: string | null;
  estimated_duration_seconds?: number | null;
  trimmed_words?: TranscriptWord[];
};

export type GeminiRefinementPayload = {
  hook?: string | null;
  trimmed_words?: TranscriptWord[];
  notes?: string | null;
  estimated_duration_seconds?: number | null;
  default_concept_id?: string | null;
  concepts?: GeminiConceptRaw[];
};

export type GeminiConceptChoice = {
  id: string;
  title: string;
  description: string | null;
  hook: string | null;
  trimmed_words: TranscriptWord[];
  notes: string | null;
  estimated_duration_seconds: number | null;
};

export type GeminiRefinement = {
  hook: string | null;
  trimmed_words: TranscriptWord[];
  notes: string | null;
  estimated_duration_seconds: number | null;
  concepts: GeminiConceptChoice[];
  default_concept_id: string | null;
};

export type GeminiRefinementOptions = {
  variantCount?: number;
};

export type TimeRange = {
  start: number;
  end: number;
};

export type RangeMapping = {
  start: number;
  end: number;
  timelineStart: number;
};

export type ProcessingStepId = "audio" | "transcript" | "analysis";
export type ProcessingStatus = "idle" | "active" | "complete" | "error";

export type CaptionSegment = {
  text: string;
  start: number;
  duration: number;
};
