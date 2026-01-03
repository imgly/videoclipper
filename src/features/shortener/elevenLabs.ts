import { pickTranscriptText } from "@/lib/transcript";
import type { ElevenLabsTranscriptResponse } from "@/lib/transcript";
import type { TranscriptionResult } from "./types";

export const transcribeWithElevenLabs = async (
  audioBlob: Blob
): Promise<TranscriptionResult> => {
  const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing ElevenLabs API key. Set VITE_ELEVENLABS_API_KEY in your environment."
    );
  }

  const modelId =
    process.env.NEXT_PUBLIC_ELEVENLABS_TRANSCRIPTION_MODEL || "scribe_v1";
  const diarizeEnv = process.env.NEXT_PUBLIC_ELEVENLABS_DIARIZE;
  const shouldDiarize =
    diarizeEnv === undefined
      ? true
      : !["false", "0", "off", "no"].includes(diarizeEnv.toLowerCase());

  const formData = new FormData();
  formData.append("file", audioBlob, "extracted-audio.mp4");
  formData.append("model_id", modelId);
  if (shouldDiarize) {
    formData.append("diarize", "true");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      errorMessage || "ElevenLabs transcription request was not successful."
    );
  }

  const result = (await response.json()) as ElevenLabsTranscriptResponse;
  console.debug("ElevenLabs transcription response", result);
  const transcriptText = pickTranscriptText(result);
  if (!transcriptText) {
    throw new Error("ElevenLabs transcription response was empty.");
  }

  return { transcript: transcriptText, rawResponse: result };
};
