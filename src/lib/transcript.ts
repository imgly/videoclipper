export type ElevenLabsTranscriptWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
  speaker?: string;
};

export type ElevenLabsTranscriptSegment = {
  text?: string;
  words?: ElevenLabsTranscriptWord[];
  speaker_id?: string;
  speaker?: string;
};

export type ElevenLabsTranscriptResponse = {
  text?: string;
  transcript?: string;
  combined_text?: string;
  words?: ElevenLabsTranscriptWord[];
  segments?: ElevenLabsTranscriptSegment[];
};

export type OpenAITranscriptWord = {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  speaker_id?: string;
  speaker?: string;
};

export type OpenAITranscriptSegment = {
  text?: string;
  start?: number;
  end?: number;
  words?: OpenAITranscriptWord[];
  speaker_id?: string;
  speaker?: string;
};

export type OpenAITranscriptResponse = {
  text?: string;
  words?: OpenAITranscriptWord[];
  segments?: OpenAITranscriptSegment[];
};

export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
  speaker_id?: string | null;
};

// Generic word-like interface for extraction
type WordLike = {
  text?: string;
  word?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
  speaker?: string;
};

type SegmentLike = {
  text?: string;
  words?: WordLike[];
  speaker_id?: string;
  speaker?: string;
};

type TranscriptPayload = {
  text?: string;
  transcript?: string;
  combined_text?: string;
  words?: WordLike[];
  segments?: SegmentLike[];
};

// Configuration for different transcript providers
type ExtractConfig = {
  getText: (word: WordLike) => string | undefined;
  shouldSkip?: (word: WordLike) => boolean;
};

const elevenLabsConfig: ExtractConfig = {
  getText: (word) => word.text,
  shouldSkip: (word) => word.type === "spacing" || word.type === "audio_event",
};

const openAIConfig: ExtractConfig = {
  getText: (word) => word.word ?? word.text,
};

// Generic helper to build text from words
const buildTextFromWords = (
  words: WordLike[] | null | undefined,
  config: ExtractConfig
): string | null => {
  if (!Array.isArray(words)) return null;
  const text = words
    .map((word) => config.getText(word)?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return text || null;
};

// Generic helper to build text from segments
const buildTextFromSegments = (
  segments: SegmentLike[] | null | undefined,
  config: ExtractConfig
): string | null => {
  if (!Array.isArray(segments)) return null;
  const text = segments
    .map(
      (segment) =>
        segment.text?.trim() ?? buildTextFromWords(segment.words, config) ?? ""
    )
    .filter(Boolean)
    .join(" ");
  return text || null;
};

const normalizeSpeakerId = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
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

// Generic transcript text picker
const pickTranscriptTextGeneric = (
  payload: TranscriptPayload,
  config: ExtractConfig
): string | null => {
  const candidates = [
    payload.text,
    payload.transcript,
    payload.combined_text,
    buildTextFromSegments(payload.segments, config),
    buildTextFromWords(payload.words, config),
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

export const pickTranscriptText = (
  payload: ElevenLabsTranscriptResponse
): string | null => pickTranscriptTextGeneric(payload, elevenLabsConfig);

export const pickOpenAITranscriptText = (
  payload: OpenAITranscriptResponse
): string | null => pickTranscriptTextGeneric(payload, openAIConfig);

// Generic word extraction
const extractTranscriptWordsGeneric = (
  payload: TranscriptPayload | null,
  config: ExtractConfig
): TranscriptWord[] => {
  if (!payload) return [];
  const directWords = Array.isArray(payload.words) ? payload.words : [];
  const directEntries = directWords.map((word) => ({ word }));
  const segmentEntries = Array.isArray(payload.segments)
    ? payload.segments.flatMap((segment) =>
        (segment.words ?? []).map((word) => ({
          word,
          segmentSpeaker: segment.speaker_id ?? segment.speaker,
        }))
      )
    : [];
  const combined = [...directEntries, ...segmentEntries];

  const normalized = combined
    .filter(
      (entry): entry is { word: WordLike; segmentSpeaker?: unknown } =>
        Boolean(entry?.word) && Boolean(config.getText(entry.word)?.trim())
    )
    .filter((entry) => !config.shouldSkip?.(entry.word))
    .map((entry) => {
      const text = config.getText(entry.word)?.trim();
      if (!text) return null;
      const start =
        typeof entry.word.start === "number"
          ? entry.word.start
          : typeof entry.word.start === "string"
          ? Number.parseFloat(entry.word.start)
          : undefined;
      const end =
        typeof entry.word.end === "number"
          ? entry.word.end
          : typeof entry.word.end === "string"
          ? Number.parseFloat(entry.word.end)
          : undefined;
      const safeStart = Number.isFinite(start)
        ? (start as number)
        : Number.isFinite(end)
        ? (end as number) - 0.2
        : 0;
      const safeEnd = Number.isFinite(end)
        ? (end as number)
        : safeStart + 0.2;
      const speakerId = normalizeSpeakerId(
        entry.word.speaker_id ?? entry.word.speaker ?? entry.segmentSpeaker
      );
      const normalizedWord: TranscriptWord = {
        text,
        start: Math.max(0, safeStart),
        end: Math.max(safeEnd, safeStart),
        speaker_id: speakerId,
      };
      return normalizedWord;
    })
    .filter((word): word is TranscriptWord => Boolean(word));

  return normalized.sort((a, b) => a.start - b.start);
};

export const extractTranscriptWords = (
  payload: ElevenLabsTranscriptResponse | null
): TranscriptWord[] => extractTranscriptWordsGeneric(payload, elevenLabsConfig);

export const extractOpenAITranscriptWords = (
  payload: OpenAITranscriptResponse | null
): TranscriptWord[] => extractTranscriptWordsGeneric(payload, openAIConfig);

export const buildTranscriptWordsFromText = (
  text?: string | null,
  totalDuration?: number | null
): TranscriptWord[] => {
  if (typeof text !== "string") return [];
  const tokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return [];
  const duration =
    Number.isFinite(totalDuration) && (totalDuration as number) > 0
      ? (totalDuration as number)
      : tokens.length * 0.35;
  const step = duration / tokens.length;
  let cursor = 0;
  return tokens.map((token, index) => {
    const start = cursor;
    const end = index === tokens.length - 1 ? duration : start + step;
    cursor = end;
    return {
      text: token,
      start: Math.max(0, start),
      end: Math.max(end, start),
      speaker_id: null,
    };
  });
};

export const transcriptWordsToText = (words?: TranscriptWord[] | null) =>
  words?.map((word) => word.text).join(" ") ?? "";
