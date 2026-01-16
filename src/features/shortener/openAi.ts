import { pickOpenAITranscriptText } from "@/lib/transcript";
import type { OpenAITranscriptResponse } from "@/lib/transcript";
import type { TranscriptionResult } from "./types";

type OpenAITranscriptionOptions = {
  model?: string;
  responseFormat?: "json" | "text" | "verbose_json";
  enableWordTimestamps?: boolean;
};

type OpenAITranscriptionAttempt =
  | { ok: true; data: OpenAITranscriptResponse }
  | { ok: false; message: string };

const supportsWordTimestamps = (modelId: string) =>
  modelId === "whisper-1" ||
  modelId.startsWith("gpt-4o-transcribe") ||
  modelId.startsWith("gpt-4o-mini-transcribe");

export const transcribeWithOpenAI = async (
  audioBlob: Blob,
  options: OpenAITranscriptionOptions = {}
): Promise<TranscriptionResult> => {
  const modelId =
    options.model ??
    process.env.NEXT_PUBLIC_OPENAI_TRANSCRIPTION_MODEL ??
    "whisper-1";
  const enableWordTimestamps =
    options.enableWordTimestamps ?? supportsWordTimestamps(modelId);
  const allowWordTimestamps =
    enableWordTimestamps && supportsWordTimestamps(modelId);
  let responseFormat =
    options.responseFormat ?? (allowWordTimestamps ? "verbose_json" : "json");
  if (!allowWordTimestamps && responseFormat === "verbose_json") {
    responseFormat = "json";
  }

  // Build request to our secure API route
  const formData = new FormData();
  formData.append("audio", audioBlob, "extracted-audio.mp4");
  formData.append("model", modelId);
  formData.append("responseFormat", responseFormat);
  formData.append("enableWordTimestamps", String(enableWordTimestamps));

  // Call our secure API route instead of OpenAI directly
  const response = await fetch("/api/transcribe-openai", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.detail || error.error || "OpenAI transcription request failed."
    );
  }

  const result = await response.json();
  return { transcript: result.transcript, rawResponse: result.rawResponse };
};
