import { NextResponse } from "next/server";
import {
  BASE_INSTRUCTIONS,
  SINGLE_RESPONSE_SCHEMA,
  buildMultiConceptSchema,
  SHORTENING_MODE_INSTRUCTIONS,
} from "./prompts";

export const runtime = "nodejs";

const DEFAULT_GOOGLE_MODEL = "models/gemini-1.5-pro";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3-pro-preview";
const JSON_MIME_TYPE = "application/json; charset=utf-8";
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1";
const GEMINI_UPLOAD_API_VERSION =
  process.env.GEMINI_UPLOAD_API_VERSION?.trim() ||
  (GEMINI_API_VERSION === "v1" ? "v1beta" : GEMINI_API_VERSION);
const GENERATION_CONFIG = {
  temperature: 0.2,
  topK: 40,
  topP: 0.9,
};

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.replace(/\/$/, "") ||
  "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL =
  process.env.OPENROUTER_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";
const OPENROUTER_APP_TITLE =
  process.env.OPENROUTER_APP_TITLE || "VideoClipper";
const DEFAULT_SHORTENING_MODE = "disfluency";
const MIN_VARIANT_COUNT = 1;
const MAX_VARIANT_COUNT = 3;
const DEFAULT_VARIANT_COUNT = 1;

const isValidShorteningMode = (value) =>
  typeof value === "string" && Object.hasOwn(SHORTENING_MODE_INSTRUCTIONS, value);

const normalizeVariantCount = (value) => {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return DEFAULT_VARIANT_COUNT;
  return Math.min(
    MAX_VARIANT_COUNT,
    Math.max(MIN_VARIANT_COUNT, numeric)
  );
};

const buildInstructions = (mode, variantCount) => {
  const resolved = isValidShorteningMode(mode)
    ? mode
    : DEFAULT_SHORTENING_MODE;
  const focus = SHORTENING_MODE_INSTRUCTIONS[resolved];
  const resolvedVariants = normalizeVariantCount(variantCount);
  const schemaSection =
    resolvedVariants > 1
      ? buildMultiConceptSchema(resolvedVariants)
      : SINGLE_RESPONSE_SCHEMA;
  return `${BASE_INSTRUCTIONS}\n\n${schemaSection}\n\nShortening objective:\n${focus}\n\nImplementation notes:\n- Keep trimmed_words in the exact chronological order of the transcript.\n- Never create new wording; deletions only.\n- estimated_duration_seconds should equal the total runtime after retiming (sum of end-start for trimmed_words, rounded to 0.1s).\n- Use notes to briefly describe the main deletions or any unmet constraints.`;
};

const readEnvProvider = () => {
  const explicit =
    process.env.GEMINI_PROVIDER?.trim().toLowerCase() ||
    process.env.NEXT_PUBLIC_GEMINI_PROVIDER?.trim().toLowerCase();
  if (explicit) return explicit;
  const hasOpenRouterKey =
    !!(
      process.env.OPENROUTER_API_KEY ||
      process.env.NEXT_PUBLIC_OPENROUTER_API_KEY
    );
  return hasOpenRouterKey ? "openrouter" : "google";
};

const normalizeProvider = (value) =>
  value === "openrouter" ? "openrouter" : "google";

const resolveProvider = (requestedProvider) => {
  const candidate =
    typeof requestedProvider === "string" && requestedProvider.trim()
      ? requestedProvider.trim().toLowerCase()
      : readEnvProvider();
  return normalizeProvider(candidate);
};

const normalizeModelId = (value, provider) => {
  if (provider === "openrouter") {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || DEFAULT_OPENROUTER_MODEL;
  }

  const trimmedValue =
    typeof value === "string" ? value.trim().replace(/^\/+/, "") : "";
  if (!trimmedValue) return DEFAULT_GOOGLE_MODEL;
  return trimmedValue.startsWith("models/")
    ? trimmedValue
    : `models/${trimmedValue}`;
};

export async function POST(req) {
  try {
    const body = await req.json();
    const provider = resolveProvider(body?.provider);
    const usingOpenRouter = provider === "openrouter";
    const apiKey = usingOpenRouter
      ? process.env.OPENROUTER_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.VITE_GEMINI_API_KEY ||
        process.env.NEXT_PUBLIC_OPENROUTER_API_KEY ||
        ""
      : process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "";

    if (!apiKey) {
      const missingEnv = usingOpenRouter
        ? "OPENROUTER_API_KEY (or GEMINI_API_KEY)"
        : "GEMINI_API_KEY";
      return NextResponse.json(
        { error: `Missing ${missingEnv} environment variable` },
        { status: 500 }
      );
    }

    const { model, words, shorteningMode, variantCount: requestedVariants } =
      body || {};

    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json(
        { error: "Missing transcript words" },
        { status: 400 }
      );
    }

    const targetModel = normalizeModelId(model, provider);
    const wordsJson = JSON.stringify(words);
    const resolvedShorteningMode = isValidShorteningMode(shorteningMode)
      ? shorteningMode
      : DEFAULT_SHORTENING_MODE;
    const defaultVariantFallback =
      resolvedShorteningMode === "sixty_seconds" ||
      resolvedShorteningMode === "thirty_seconds"
        ? MAX_VARIANT_COUNT
        : DEFAULT_VARIANT_COUNT;
    const variantCount = normalizeVariantCount(
      requestedVariants ?? defaultVariantFallback
    );
    const instructions = buildInstructions(
      resolvedShorteningMode,
      variantCount
    );

    const inlineParts = [
      {
        text: `${instructions}\n\nREQUESTED_VARIANTS: ${variantCount}\nTRANSCRIPT_WORDS_JSON:\n${wordsJson}`,
      },
    ];

    let data;
    let fileUploadUsed = false;

    if (usingOpenRouter) {
      const openRouterAttempt = await generateWithOpenRouter({
        apiKey,
        targetModel,
        instructions,
        wordsJson,
      });

      if (!openRouterAttempt.ok) {
        return NextResponse.json(
          { error: "Gemini API error", detail: openRouterAttempt.detail },
          { status: openRouterAttempt.status }
        );
      }

      data = openRouterAttempt.data;
    } else {
      try {
        const fileUri = await uploadTranscriptFile({
          apiKey,
          contents: wordsJson,
          apiVersion: GEMINI_UPLOAD_API_VERSION,
        });

        const fileParts = [
          {
            text: `${instructions}\n\nREQUESTED_VARIANTS: ${variantCount}\nTRANSCRIPT_FILE_URI: ${fileUri}\nThe attached file contains the TRANSCRIPT_WORDS_JSON array.`,
          },
          {
            fileData: { fileUri, mimeType: "application/json" },
          },
        ];

        const fileAttempt = await generateWithGemini({
          apiKey,
          targetModel,
          parts: fileParts,
          apiVersion: GEMINI_API_VERSION,
        });

        if (fileAttempt.ok) {
          data = fileAttempt.data;
          fileUploadUsed = true;
        } else {
          console.warn(
            "[Gemini API Route] Gemini request with uploaded file failed; retrying with inline payload",
            fileAttempt.detail
          );
        }
      } catch (uploadError) {
        console.warn(
          "[Gemini API Route] File upload failed, falling back to inline payload",
          uploadError
        );
      }

      if (!data) {
        const inlineAttempt = await generateWithGemini({
          apiKey,
          targetModel,
          parts: inlineParts,
          apiVersion: GEMINI_API_VERSION,
        });

        if (!inlineAttempt.ok) {
          return NextResponse.json(
            { error: "Gemini API error", detail: inlineAttempt.detail },
            { status: inlineAttempt.status }
          );
        }

        data = inlineAttempt.data;
      }
    }

    const headers = fileUploadUsed
      ? { "x-gemini-file-upload": "true" }
      : undefined;

    return NextResponse.json(data, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("[Gemini API Route]", error);
    return NextResponse.json(
      {
        error: "Server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

async function uploadTranscriptFile({ apiKey, contents, apiVersion }) {
  const metadataResponse = await fetch(
    `${GEMINI_BASE_URL}/upload/${apiVersion}/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": JSON_MIME_TYPE,
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Header-Content-Length": String(Buffer.byteLength(contents, "utf8")),
        "X-Goog-Upload-Header-Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: {
          displayName: `transcript-${Date.now()}.json`,
          mimeType: "application/json",
        },
      }),
    }
  );

  if (!metadataResponse.ok) {
    const message = await metadataResponse.text();
    throw new Error(`Failed to start file upload: ${message}`);
  }

  const uploadUrl = metadataResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Upload URL missing from Gemini response");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body: contents,
  });

  if (!uploadResponse.ok) {
    const message = await uploadResponse.text();
    throw new Error(`Failed to upload transcript: ${message}`);
  }

  const uploaded = await uploadResponse.json();
  const fileRecord = uploaded?.file ?? uploaded;
  const fileUri = fileRecord?.uri || fileRecord?.fileUri || null;
  const fileName = fileRecord?.name || null;

  if (!fileUri && !fileName) {
    throw new Error("Uploaded file metadata is missing identifiers");
  }

  if (fileUri) {
    return fileUri;
  }

  // Older responses might only include the resource name (files/abc)
  return `files/${fileName.replace(/^files\//, "")}`;
}

async function generateWithGemini({ apiKey, targetModel, parts, apiVersion }) {
  const payload = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: GENERATION_CONFIG,
  };

  const geminiUrl = `${GEMINI_BASE_URL}/${apiVersion}/${targetModel}:generateContent?key=${apiKey}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    return { ok: true, data: await response.json() };
  }

  const errorText = await response.text();
  return {
    ok: false,
    status: response.status,
    detail: errorText,
  };
}

async function generateWithOpenRouter({
  apiKey,
  targetModel,
  instructions,
  wordsJson,
}) {
  const messages = [
    {
      role: "system",
      content: [
        {
          type: "text",
          text: instructions,
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `TRANSCRIPT_WORDS_JSON:\n${wordsJson}`,
        },
      ],
    },
  ];

  const payload = {
    model: targetModel,
    messages,
    temperature: GENERATION_CONFIG.temperature,
    top_p: GENERATION_CONFIG.topP,
    response_format: { type: "json_object" },
  };

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": OPENROUTER_SITE_URL,
      "X-Title": OPENROUTER_APP_TITLE,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      ok: false,
      status: response.status,
      detail,
    };
  }

  const raw = await response.json();
  const aggregatedText = extractStructuredAssistantText(raw);

  if (!aggregatedText) {
    console.warn("[Gemini API Route] OpenRouter response missing assistant text", raw);
    return {
      ok: false,
      status: 502,
      detail: "OpenRouter response did not include any text output.",
    };
  }

  return {
    ok: true,
    data: buildGeminiCandidateFromText(aggregatedText),
  };
}

const extractStructuredAssistantText = (payload) => {
  const choice = payload?.choices?.[0];
  if (!choice) return "";
  const content =
    choice?.message?.content ??
    choice?.content ??
    (typeof choice.text === "string" ? choice.text : "");
  const flattened = flattenOpenRouterMessageContent(content).trim();
  if (!flattened) return "";
  return stripJsonFences(flattened);
};

const flattenOpenRouterMessageContent = (content) => {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return "";
        if (typeof part === "string") return part;
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        if (typeof part.type === "string") {
          if (part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        }
        if (Array.isArray(part.content)) {
          return flattenOpenRouterMessageContent(part.content);
        }
        return "";
      })
      .join("");
  }
  if (typeof content.text === "string") return content.text;
  if (typeof content.content === "string") return content.content;
  return "";
};

const stripJsonFences = (value) =>
  value
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();

const buildGeminiCandidateFromText = (text) => ({
  candidates: [
    {
      content: {
        parts: [{ text }],
      },
      output_text: text,
    },
  ],
});
