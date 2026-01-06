import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_GOOGLE_MODEL = "models/gemini-1.5-flash";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.0-flash-exp";
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION?.trim() || "v1";
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

const GENERATION_CONFIG = {
  temperature: 0.2,
  topK: 32,
  topP: 0.9,
};

const FACE_INSTRUCTIONS =
  "Detect every visible human face in the image. " +
  "Return ONLY valid JSON in this shape: " +
  '{"faces":[{"x0":0,"y0":0,"x1":1,"y1":1,"confidence":0.0}]}. ' +
  "Coordinates must be normalized (0-1) relative to the full image, with (0,0) at the top-left. " +
  "If no faces are visible, return {\"faces\":[]}. Do not include code fences.";

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
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (provider === "openrouter") {
    return trimmed || DEFAULT_OPENROUTER_MODEL;
  }
  const cleaned = trimmed.replace(/^\/+/, "");
  if (!cleaned) return DEFAULT_GOOGLE_MODEL;
  return cleaned.startsWith("models/") ? cleaned : `models/${cleaned}`;
};

const parseImageDataUrl = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};

const stripJsonFences = (value) =>
  value
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();

const extractGeminiResponseText = (payload) => {
  const candidate = payload?.candidates?.[0];
  const aggregatedText = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim()
    : candidate?.output_text?.trim?.() ?? "";
  return aggregatedText ? stripJsonFences(aggregatedText) : "";
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

const extractStructuredAssistantText = (payload) => {
  const choice = payload?.choices?.[0];
  if (!choice) return "";
  const content =
    choice?.message?.content ??
    choice?.content ??
    (typeof choice.text === "string" ? choice.text : "");
  const flattened = flattenOpenRouterMessageContent(content).trim();
  return flattened ? stripJsonFences(flattened) : "";
};

const tryParseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
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

    const imageDataUrl = body?.imageDataUrl;
    const image = parseImageDataUrl(imageDataUrl);
    if (!image) {
      return NextResponse.json(
        { error: "Missing or invalid imageDataUrl." },
        { status: 400 }
      );
    }

    const targetModel = normalizeModelId(body?.model, provider);

    let data;
    if (usingOpenRouter) {
      const openRouterAttempt = await generateWithOpenRouter({
        apiKey,
        targetModel,
        imageDataUrl,
      });
      if (!openRouterAttempt.ok) {
        return NextResponse.json(
          { error: "Gemini API error", detail: openRouterAttempt.detail },
          { status: openRouterAttempt.status }
        );
      }
      data = openRouterAttempt.data;
    } else {
      const geminiAttempt = await generateWithGemini({
        apiKey,
        targetModel,
        image,
      });
      if (!geminiAttempt.ok) {
        return NextResponse.json(
          { error: "Gemini API error", detail: geminiAttempt.detail },
          { status: geminiAttempt.status }
        );
      }
      data = geminiAttempt.data;
    }

    const rawText = usingOpenRouter
      ? extractStructuredAssistantText(data)
      : extractGeminiResponseText(data);
    const parsed = tryParseJson(rawText);
    const responsePayload = {
      provider,
      model: targetModel,
      rawText,
      parsed,
      data: rawText ? undefined : data,
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error) {
    console.error("[Gemini Face Boxes Route]", error);
    return NextResponse.json(
      {
        error: "Server error",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

async function generateWithGemini({ apiKey, targetModel, image }) {
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: FACE_INSTRUCTIONS },
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          },
        ],
      },
    ],
    generationConfig: GENERATION_CONFIG,
  };

  const geminiUrl = `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/${targetModel}:generateContent?key=${apiKey}`;

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

async function generateWithOpenRouter({ apiKey, targetModel, imageDataUrl }) {
  const payload = {
    model: targetModel,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: FACE_INSTRUCTIONS },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
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

  return { ok: true, data: await response.json() };
}
