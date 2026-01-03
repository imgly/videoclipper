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
  const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OpenAI API key. Set NEXT_PUBLIC_OPENAI_API_KEY in your environment."
    );
  }

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

  const shouldRequestWordTimestamps =
    allowWordTimestamps && responseFormat === "verbose_json";
  const buildFormData = (format: string, includeTimestamps: boolean) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "extracted-audio.mp4");
    formData.append("model", modelId);
    formData.append("response_format", format);
    if (includeTimestamps) {
      formData.append("timestamp_granularities[]", "word");
    }
    return formData;
  };
  const requestTranscription = async (
    format: string,
    includeTimestamps: boolean
  ): Promise<OpenAITranscriptionAttempt> => {
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        body: buildFormData(format, includeTimestamps),
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        message: await response.text(),
      };
    }
    return { ok: true, data: (await response.json()) as OpenAITranscriptResponse };
  };

  let attempt = await requestTranscription(
    responseFormat,
    shouldRequestWordTimestamps
  );
  if (!attempt.ok && shouldRequestWordTimestamps) {
    console.warn(
      "OpenAI transcription rejected word timestamps; retrying without timestamps."
    );
    attempt = await requestTranscription("json", false);
  }
  if (!attempt.ok) {
    throw new Error(
      attempt.message || "OpenAI transcription request was not successful."
    );
  }

  const result = attempt.data;
  console.debug("OpenAI transcription response", result);
  const transcriptText = pickOpenAITranscriptText(result);
  if (!transcriptText) {
    throw new Error("OpenAI transcription response was empty.");
  }

  return { transcript: transcriptText, rawResponse: result };
};
