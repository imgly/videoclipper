import { NextResponse } from "next/server";
import { pickTranscriptText } from "@/lib/transcript";
import type { ElevenLabsTranscriptResponse } from "@/lib/transcript";

export const runtime = "nodejs";

export async function POST(req: Request) {
  console.log("[ElevenLabs] 1. Route hit");
  try {
    // Get API key from server-side env var (no NEXT_PUBLIC_ prefix)
    const apiKey = process.env.ELEVENLABS_API_KEY;
    console.log("[ElevenLabs] 2. API key exists:", !!apiKey);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing ELEVENLABS_API_KEY environment variable" },
        { status: 500 }
      );
    }

    // Parse request body
    console.log("[ElevenLabs] 3. Parsing formData...");
    const formData = await req.formData();
    console.log("[ElevenLabs] 4. FormData parsed");
    const audioFile = formData.get("audio") as File;
    console.log("[ElevenLabs] 5. Audio file size:", audioFile?.size);
    const modelId = (formData.get("modelId") as string) ||
                    process.env.ELEVENLABS_TRANSCRIPTION_MODEL ||
                    "scribe_v1";
    const diarizeParam = formData.get("diarize");

    // Default to true if not specified
    const shouldDiarize = diarizeParam === null ? true : diarizeParam === "true";

    if (!audioFile) {
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    // Build request to ElevenLabs
    const elevenLabsFormData = new FormData();
    elevenLabsFormData.append("file", audioFile);
    elevenLabsFormData.append("model_id", modelId);
    if (shouldDiarize) {
      elevenLabsFormData.append("diarize", "true");
    }

    // Make request to ElevenLabs (10 min timeout for large files)
    console.log("[ElevenLabs] 6. Sending request to ElevenLabs...");
    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      body: elevenLabsFormData,
      signal: AbortSignal.timeout(600000), // 10 minutes
    });
    console.log("[ElevenLabs] 7. Response received, status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: "ElevenLabs API error", detail: errorText },
        { status: response.status }
      );
    }

    const result = (await response.json()) as ElevenLabsTranscriptResponse;
    const transcriptText = pickTranscriptText(result);

    if (!transcriptText) {
      return NextResponse.json(
        { error: "ElevenLabs transcription response was empty" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      transcript: transcriptText,
      rawResponse: result,
    });
  } catch (error) {
    console.error("[ElevenLabs Transcribe API Route]", error);
    return NextResponse.json(
      {
        error: "Server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
