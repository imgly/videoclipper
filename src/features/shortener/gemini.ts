import type { TranscriptWord } from "@/lib/transcript";
import { normalizeGeminiRefinement } from "./normalize";
import type {
  GeminiRefinement,
  GeminiRefinementOptions,
  RefinementMode,
} from "./types";

export const requestGeminiRefinement = async (
  words: TranscriptWord[],
  shorteningMode: RefinementMode,
  options?: GeminiRefinementOptions
): Promise<{ refinement: GeminiRefinement; fileUploadUsed: boolean; rawText: string }> => {
  const geminiProvider =
    process.env.NEXT_PUBLIC_GEMINI_PROVIDER?.trim().toLowerCase() ||
    "openrouter";
  const defaultClientModel =
    geminiProvider === "openrouter"
      ? "google/gemini-2.0-flash-exp"
      : "models/gemini-2.5-flash-lite";
  const model =
    process.env.NEXT_PUBLIC_GEMINI_MODEL?.trim() || defaultClientModel;

  const proxyBase =
    process.env.NEXT_PUBLIC_GEMINI_PROXY_URL?.replace(/\/$/, "") ?? "";
  const payload: Record<string, unknown> = {
    model,
    words,
    shorteningMode,
    provider: geminiProvider,
  };
  if (options?.variantCount && options.variantCount > 1) {
    payload.variantCount = options.variantCount;
  }

  const response = await fetch(
    `${proxyBase ? proxyBase : ""}/api/gemini-refine`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      errorMessage || "Gemini transcription refinement request failed."
    );
  }

  const fileUploadUsed =
    response.headers.get("x-gemini-file-upload") === "true";

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const aggregatedText = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((part: { text?: string }) => part?.text ?? "")
        .join("")
        .trim()
    : candidate?.output_text?.trim?.() ?? "";

  if (!aggregatedText) {
    throw new Error("Gemini response did not include any text output.");
  }

  let parsed: GeminiRefinement;
  try {
    parsed = JSON.parse(aggregatedText);
  } catch (error) {
    console.error("Gemini raw response", aggregatedText);
    throw new Error("Gemini response was not valid JSON.");
  }

  return {
    refinement: normalizeGeminiRefinement(parsed),
    fileUploadUsed,
    rawText: aggregatedText,
  };
};
