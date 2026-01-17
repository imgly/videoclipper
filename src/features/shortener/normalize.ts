import type { TranscriptWord } from "@/lib/transcript";
import type {
  GeminiConceptChoice,
  GeminiConceptRaw,
  GeminiRefinement,
  GeminiRefinementPayload,
} from "./types";

const normalizeOptionalNumber = (value: unknown): number | null => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTextValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeWordToken = (value: string | undefined | null): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, "");

const tokenizeTrimmedText = (text: string): string[] =>
  String(text ?? "")
    .split(/\s+/)
    .map(normalizeWordToken)
    .filter(Boolean);

/**
 * Convert trimmed_text string to trimmed_words array by matching against source words.
 * This performs sequential text matching to find corresponding words with timestamps.
 */
const buildTrimmedWordsFromText = (
  sourceWords: TranscriptWord[],
  trimmedText: string
): TranscriptWord[] => {
  if (!Array.isArray(sourceWords) || !sourceWords.length || !trimmedText) {
    return [];
  }
  const tokens = tokenizeTrimmedText(trimmedText);
  if (!tokens.length) return [];

  const normalizedSource = sourceWords.map((word, index) => ({
    index,
    normalized: normalizeWordToken(word?.text),
  }));

  let sourceIndex = 0;
  const trimmedWords: TranscriptWord[] = [];

  tokens.forEach((token) => {
    if (!token) return;
    for (let i = sourceIndex; i < normalizedSource.length; i += 1) {
      if (normalizedSource[i].normalized === token) {
        const sourceWord = sourceWords[i];
        if (sourceWord && typeof sourceWord.text === "string") {
          trimmedWords.push({
            text: sourceWord.text,
            start: sourceWord.start,
            end: sourceWord.end,
            speaker_id: sourceWord.speaker_id ?? null,
          });
        }
        sourceIndex = i + 1;
        return;
      }
    }
  });

  return trimmedWords;
};

const normalizeTranscriptWordList = (
  words: TranscriptWord[] | undefined | null
): TranscriptWord[] => {
  if (!Array.isArray(words)) return [];
  return words
    .map((word) => {
      const text = word?.text?.trim();
      if (!text) return null;
      const start = Number.parseFloat(String(word?.start ?? 0));
      const end = Number.parseFloat(String(word?.end ?? 0));
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
      }
      return {
        text,
        start,
        end,
        speaker_id: word?.speaker_id ?? null,
      };
    })
    .filter((word): word is TranscriptWord => Boolean(word))
    .sort((a, b) => a.start - b.start);
};

const slugifyId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const ensureConceptId = (
  rawId: string | null,
  fallbackTitle: string,
  index: number,
  seenIds: Set<string>
) => {
  const source = rawId?.trim() || fallbackTitle || `concept-${index + 1}`;
  const base = slugifyId(source) || `concept-${index + 1}`;
  let candidate = base;
  let attempt = 1;
  while (seenIds.has(candidate)) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  seenIds.add(candidate);
  return candidate;
};

const normalizeGeminiConceptChoice = (
  concept: GeminiConceptRaw | null | undefined,
  index: number,
  seenIds: Set<string>,
  sourceWords: TranscriptWord[]
): GeminiConceptChoice | null => {
  if (!concept) return null;

  // Prefer building trimmed_words from trimmed_text (lean response from Gemini)
  const trimmedText = normalizeTextValue(
    (concept as { trimmed_text?: string }).trimmed_text
  );
  let trimmedWords: TranscriptWord[] = [];

  if (trimmedText && sourceWords.length) {
    trimmedWords = buildTrimmedWordsFromText(sourceWords, trimmedText);
  }

  // Fall back to existing trimmed_words if provided (legacy/fallback)
  if (!trimmedWords.length) {
    trimmedWords = normalizeTranscriptWordList(concept.trimmed_words);
  }

  if (!trimmedWords.length) {
    return null;
  }

  const title =
    normalizeTextValue(
      concept.title ??
        concept.name ??
        concept.label ??
        concept.concept_title
    ) || `Concept ${index + 1}`;
  const description =
    normalizeTextValue(
      concept.description ??
        concept.summary ??
        concept.concept_summary
    ) || null;
  const hook = normalizeTextValue(concept.hook) || null;
  const notes = normalizeTextValue(concept.notes) || null;
  const estimated = normalizeOptionalNumber(
    concept.estimated_duration_seconds
  );
  const idSource =
    normalizeTextValue(concept.id ?? concept.name ?? concept.label) || null;
  const id = ensureConceptId(idSource, title, index, seenIds);
  return {
    id,
    title,
    description,
    hook,
    trimmed_words: trimmedWords,
    notes,
    estimated_duration_seconds: estimated,
  };
};

export const normalizeGeminiRefinement = (
  value: GeminiRefinementPayload,
  sourceWords: TranscriptWord[] = []
): GeminiRefinement => {
  // Prefer building trimmed_words from trimmed_text (lean response from Gemini)
  const trimmedText = normalizeTextValue(
    (value as { trimmed_text?: string })?.trimmed_text
  );
  let trimmedWords: TranscriptWord[] = [];

  if (trimmedText && sourceWords.length) {
    trimmedWords = buildTrimmedWordsFromText(sourceWords, trimmedText);
  }

  // Fall back to existing trimmed_words if provided (legacy/fallback)
  if (!trimmedWords.length) {
    trimmedWords = normalizeTranscriptWordList(value?.trimmed_words);
  }

  const seenConceptIds = new Set<string>();
  const concepts = Array.isArray(value?.concepts)
    ? value.concepts
        .map((concept, index) =>
          normalizeGeminiConceptChoice(concept, index, seenConceptIds, sourceWords)
        )
        .filter((concept): concept is GeminiConceptChoice => Boolean(concept))
    : [];

  let defaultConceptId = normalizeTextValue(value?.default_concept_id);
  if (
    defaultConceptId &&
    !concepts.some((concept) => concept.id === defaultConceptId)
  ) {
    defaultConceptId = null;
  }
  if (!defaultConceptId && concepts.length) {
    defaultConceptId = concepts[0].id;
  }

  const preferredConcept = defaultConceptId
    ? concepts.find((concept) => concept.id === defaultConceptId) ?? null
    : null;
  const fallbackConcept = preferredConcept ?? concepts[0] ?? null;

  const notes = normalizeTextValue(value?.notes) ?? fallbackConcept?.notes ?? null;
  const hook = normalizeTextValue(value?.hook) ?? fallbackConcept?.hook ?? null;
  const estimated =
    normalizeOptionalNumber(value?.estimated_duration_seconds) ??
    fallbackConcept?.estimated_duration_seconds ??
    null;
  const resolvedWords =
    trimmedWords.length > 0 ? trimmedWords : fallbackConcept?.trimmed_words ?? [];

  return {
    hook,
    trimmed_words: resolvedWords,
    notes,
    estimated_duration_seconds: estimated,
    concepts,
    default_concept_id: fallbackConcept?.id ?? null,
  };
};
