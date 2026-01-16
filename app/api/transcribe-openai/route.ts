import { NextResponse } from "next/server";
import { pickOpenAITranscriptText } from "@/lib/transcript";
import type { OpenAITranscriptResponse } from "@/lib/transcript";

export const runtime = "nodejs";

const supportsWordTimestamps = (modelId: string) =>
  modelId === "whisper-1" ||
  modelId.startsWith("gpt-4o-transcribe") ||
  modelId.startsWith("gpt-4o-mini-transcribe");

export async function POST(req: Request) {
  try {
    // Get API key from server-side env var (no NEXT_PUBLIC_ prefix)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY environment variable" },
        { status: 500 }
      );
    }

    // Parse request body
    const formData = await req.formData();
    const audioFile = formData.get("audio") as File;
    const model = (formData.get("model") as string) ||
                  process.env.OPENAI_TRANSCRIPTION_MODEL ||
                  "whisper-1";
    const responseFormat = formData.get("responseFormat") as string;
    const enableWordTimestamps = formData.get("enableWordTimestamps") === "true";

    if (!audioFile) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    const allowWordTimestamps =
      enableWordTimestamps && supportsWordTimestamps(model);
    let format =
      responseFormat ?? (allowWordTimestamps ? "verbose_json" : "json");
    if (!allowWordTimestamps && format === "verbose_json") {
      format = "json";
    }

    const shouldRequestWordTimestamps =
      allowWordTimestamps && format === "verbose_json";

    // Build request to OpenAI
    const openaiFormData = new FormData();
    openaiFormData.append("file", audioFile);
    openaiFormData.append("model", model);
    openaiFormData.append("response_format", format);
    if (shouldRequestWordTimestamps) {
      openaiFormData.append("timestamp_granularities[]", "word");
    }

    // Make request to OpenAI
    let response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        body: openaiFormData,
      }
    );

    // Retry without timestamps if failed
    if (!response.ok && shouldRequestWordTimestamps) {
      console.warn(
        "OpenAI transcription rejected word timestamps; retrying without timestamps."
      );
      const retryFormData = new FormData();
      retryFormData.append("file", audioFile);
      retryFormData.append("model", model);
      retryFormData.append("response_format", "json");

      response = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          body: retryFormData,
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "OpenAI API error", detail: errorText },
        { status: response.status }
      );
    }

    const result = (await response.json()) as OpenAITranscriptResponse;
    const transcriptText = pickOpenAITranscriptText(result);

    if (!transcriptText) {
      return NextResponse.json(
        { error: "OpenAI transcription response was empty" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      transcript: transcriptText,
      rawResponse: result,
    });
  } catch (error) {
    console.error("[OpenAI Transcribe API Route]", error);
    return NextResponse.json(
      {
        error: "Server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
