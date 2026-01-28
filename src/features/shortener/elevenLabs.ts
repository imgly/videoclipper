import { pickTranscriptText } from "@/lib/transcript";
import type { ElevenLabsTranscriptResponse } from "@/lib/transcript";
import type { TranscriptionResult } from "./types";

export const transcribeWithElevenLabs = async (
  audioBlob: Blob
): Promise<TranscriptionResult> => {
  const modelId =
    process.env.NEXT_PUBLIC_ELEVENLABS_TRANSCRIPTION_MODEL || "scribe_v2";
  const diarizeEnv = process.env.NEXT_PUBLIC_ELEVENLABS_DIARIZE;
  const shouldDiarize =
    diarizeEnv === undefined
      ? true
      : !["false", "0", "off", "no"].includes(diarizeEnv.toLowerCase());

  // Build request to our secure API route
  const formData = new FormData();
  formData.append("audio", audioBlob, "extracted-audio.mp3");
  formData.append("modelId", modelId);
  formData.append("diarize", String(shouldDiarize));

  // Call our secure API route instead of ElevenLabs directly
  const response = await fetch("/api/transcribe-elevenlabs", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.detail || error.error || "ElevenLabs transcription request failed."
    );
  }

  const result = await response.json();
  return { transcript: result.transcript, rawResponse: result.rawResponse };
};
