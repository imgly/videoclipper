export type ElevenLabsTranscriptWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
};

export type ElevenLabsTranscriptSegment = {
  text?: string;
  words?: ElevenLabsTranscriptWord[];
};

export type ElevenLabsTranscriptResponse = {
  text?: string;
  transcript?: string;
  combined_text?: string;
  words?: ElevenLabsTranscriptWord[];
  segments?: ElevenLabsTranscriptSegment[];
};

export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
  speaker_id?: string | null;
};

const buildTextFromWords = (words?: ElevenLabsTranscriptWord[] | null) => {
  if (!Array.isArray(words)) return null;
  const text = words
    .map((word) => word.text?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return text || null;
};

const buildTextFromSegments = (
  segments?: ElevenLabsTranscriptSegment[] | null
) => {
  if (!Array.isArray(segments)) return null;
  const text = segments
    .map((segment) => segment.text?.trim() ?? buildTextFromWords(segment.words) ?? "")
    .filter(Boolean)
    .join(" ");
  return text || null;
};

const shouldKeepFragment = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length < 8) return false;
  if (!/[a-zA-Z]/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  return wordCount >= 2;
};

const collectTextFragments = (
  value: unknown,
  seen: Set<string>,
  ordered: string[]
) => {
  if (!value) return;
  if (typeof value === "string") {
    if (shouldKeepFragment(value)) {
      const normalized = value.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        ordered.push(normalized);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTextFragments(entry, seen, ordered));
    return;
  }

  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) =>
      collectTextFragments(entry, seen, ordered)
    );
  }
};

export const pickTranscriptText = (
  payload: ElevenLabsTranscriptResponse
): string | null => {
  const candidates = [
    payload.text,
    payload.transcript,
    payload.combined_text,
    buildTextFromSegments(payload.segments),
    buildTextFromWords(payload.words),
  ]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  if (candidates.length) {
    const seen = new Set<string>();
    const ordered: string[] = [];
    candidates.forEach((candidate) => {
      if (!seen.has(candidate)) {
        seen.add(candidate);
        ordered.push(candidate);
      }
    });
    const combined = ordered.join("\n\n").trim();
    if (combined) {
      return combined;
    }
  }

  const fallbackSeen = new Set<string>();
  const fallbackOrdered: string[] = [];
  collectTextFragments(payload, fallbackSeen, fallbackOrdered);
  const fallbackText = fallbackOrdered.join("\n\n").trim();
  return fallbackText || null;
};

export const extractTranscriptWords = (
  payload: ElevenLabsTranscriptResponse | null
): TranscriptWord[] => {
  if (!payload) return [];
  const directWords = Array.isArray(payload.words) ? payload.words : [];
  const segmentWords = Array.isArray(payload.segments)
    ? payload.segments.flatMap((segment) => segment.words ?? [])
    : [];
  const combined = [...directWords, ...segmentWords];

  const normalized = combined
    .filter(
      (word): word is ElevenLabsTranscriptWord =>
        Boolean(word) &&
        Boolean(word.text?.trim()) &&
        word.type !== "spacing" &&
        word.type !== "audio_event"
    )
    .map((word) => {
      const text = word.text?.trim();
      if (!text) return null;
      const start =
        typeof word.start === "number"
          ? word.start
          : typeof word.start === "string"
          ? Number.parseFloat(word.start)
          : undefined;
      const end =
        typeof word.end === "number"
          ? word.end
          : typeof word.end === "string"
          ? Number.parseFloat(word.end)
          : undefined;
      const safeStart = Number.isFinite(start)
        ? (start as number)
        : Number.isFinite(end)
        ? (end as number) - 0.2
        : 0;
      const safeEnd = Number.isFinite(end)
        ? (end as number)
        : safeStart + 0.2;
      const normalizedWord: TranscriptWord = {
        text,
        start: Math.max(0, safeStart),
        end: Math.max(safeEnd, safeStart),
        speaker_id: word.speaker_id ?? null,
      };
      return normalizedWord;
    })
    .filter((word): word is TranscriptWord => Boolean(word));

  return normalized.sort((a, b) => a.start - b.start);
};

export const transcriptWordsToText = (words?: TranscriptWord[] | null) =>
  words?.map((word) => word.text).join(" ") ?? "";
