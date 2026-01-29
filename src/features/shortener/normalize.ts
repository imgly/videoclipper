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

const SENTENCE_END_REGEX = /[.!?]["')\]]?$/;

/**
 * Words that typically indicate we're starting mid-sentence when they appear
 * at the beginning of a clip without prior context.
 */
const MID_SENTENCE_STARTERS = new Set([
  // Coordinating conjunctions
  "and", "but", "or", "so", "yet", "nor",
  // Subordinating conjunctions
  "because", "since", "although", "though", "while", "whereas",
  "if", "unless", "until", "when", "whenever", "where", "wherever",
  "that", "which", "who", "whom", "whose",
  // Relative/connecting words often mid-sentence
  "like", "as", "than",
  // Filler/continuation phrases
  "yeah", "yep", "right", "okay", "ok",
]);

/**
 * Check if the trimmed content appears to start mid-sentence based on
 * linguistic patterns (not just punctuation).
 *
 * IMPORTANT: Uses originalTrimmedText (from Gemini) to check capitalization,
 * not the matched source words which may have different casing.
 */
const looksLikeMidSentence = (
  trimmedWords: TranscriptWord[],
  originalTrimmedText?: string
): boolean => {
  if (!trimmedWords.length) return false;

  // If we have the original text from Gemini, check ITS capitalization
  // This is more reliable than the matched source words
  if (originalTrimmedText) {
    const firstOriginalWord = originalTrimmedText.trim().split(/\s+/)[0] || "";
    const firstChar = firstOriginalWord.charAt(0);

    // If Gemini started with a capital letter, trust that it's a sentence start
    if (firstChar && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
      // Capitalized - but still check for conjunctions that can be capitalized mid-sentence
      const firstWordLower = firstOriginalWord.toLowerCase().replace(/[^a-z]/g, "");
      // Only these conjunctions at start (even capitalized) might indicate mid-sentence
      // in very specific contexts, but generally a capital letter means sentence start
      if (!["and", "but", "or", "so"].includes(firstWordLower)) {
        return false; // Capitalized non-conjunction = proper sentence start
      }
    }
  }

  // Fall back to checking the matched words if no original text
  const firstWord = trimmedWords[0].text.trim();
  const firstWordLower = firstWord.toLowerCase();

  // Check for known mid-sentence starter words
  if (MID_SENTENCE_STARTERS.has(firstWordLower)) {
    return true;
  }

  // Check if first word is lowercase (except "I" and common sentence starters)
  const firstChar = firstWord.charAt(0);
  if (firstChar && firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase()) {
    if (firstWordLower !== "i") {
      return true;
    }
  }

  // Check for patterns like "why I was thinking" - question words used in statements
  if (trimmedWords.length >= 3) {
    const pattern = trimmedWords.slice(0, 4).map(w => w.text.toLowerCase()).join(" ");
    if (/^(why|what|how)\s+i\s+(was|am|have|had|think|thought|feel|felt)/.test(pattern)) {
      return true;
    }
  }

  return false;
};

const tokenizeTrimmedText = (text: string): string[] =>
  String(text ?? "")
    .split(/\s+/)
    .map(normalizeWordToken)
    .filter(Boolean);

/**
 * Extend trimmed words backward to include the full sentence if it starts mid-sentence.
 * This ensures highlight clips don't begin in the middle of a thought.
 * Uses both punctuation-based detection and linguistic heuristics.
 *
 * @param originalTrimmedText - The original text from Gemini (preserves capitalization)
 */
const extendToSentenceStart = (
  sourceWords: TranscriptWord[],
  trimmedWords: TranscriptWord[],
  originalTrimmedText?: string
): TranscriptWord[] => {
  if (!trimmedWords.length || !sourceWords.length) return trimmedWords;

  // Check linguistic patterns - pass original text to preserve Gemini's capitalization
  const linguisticallyMidSentence = looksLikeMidSentence(trimmedWords, originalTrimmedText);

  // If Gemini's text starts with a capital letter (proper sentence), don't extend
  if (!linguisticallyMidSentence) {
    return trimmedWords;
  }

  const firstTrimmed = trimmedWords[0];
  const firstTrimmedNorm = normalizeWordToken(firstTrimmed.text);

  // Find the index of the first trimmed word in source
  let firstIndex = -1;
  for (let i = 0; i < sourceWords.length; i++) {
    if (
      normalizeWordToken(sourceWords[i].text) === firstTrimmedNorm &&
      Math.abs((sourceWords[i].start ?? 0) - (firstTrimmed.start ?? 0)) < 0.5
    ) {
      firstIndex = i;
      break;
    }
  }

  if (firstIndex <= 0) {
    // Already at the start of source, or couldn't find it
    return trimmedWords;
  }

  // Check if previous word ends with sentence-ending punctuation
  const prevWord = sourceWords[firstIndex - 1];
  const hasPunctuationBoundary = prevWord && SENTENCE_END_REGEX.test(prevWord.text.trim());

  // If we have punctuation boundary, we're at a sentence start (despite linguistic patterns)
  if (hasPunctuationBoundary) {
    return trimmedWords;
  }

  // Walk backward to find sentence start
  let sentenceStartIndex = firstIndex;
  for (let i = firstIndex - 1; i >= 0; i--) {
    sentenceStartIndex = i;

    // Check for punctuation boundary
    if (i > 0) {
      const prior = sourceWords[i - 1];
      if (prior && SENTENCE_END_REGEX.test(prior.text.trim())) {
        break;
      }
    }

    // Check for significant time gap (> 1.5 seconds suggests new thought)
    if (i > 0) {
      const currentStart = sourceWords[i].start ?? 0;
      const priorEnd = sourceWords[i - 1].end ?? sourceWords[i - 1].start ?? 0;
      const gap = currentStart - priorEnd;
      if (gap > 1.5) {
        break;
      }
    }

    // Check for speaker change
    if (i > 0) {
      const currentSpeaker = sourceWords[i].speaker_id;
      const priorSpeaker = sourceWords[i - 1].speaker_id;
      if (
        currentSpeaker != null &&
        priorSpeaker != null &&
        currentSpeaker !== priorSpeaker
      ) {
        break;
      }
    }
  }

  // Prepend the missing words
  const prependWords: TranscriptWord[] = [];
  for (let i = sentenceStartIndex; i < firstIndex; i++) {
    const word = sourceWords[i];
    if (word && typeof word.text === "string") {
      prependWords.push({
        text: word.text,
        start: word.start,
        end: word.end,
        speaker_id: word.speaker_id ?? null,
      });
    }
  }

  if (prependWords.length > 0) {
    return [...prependWords, ...trimmedWords];
  }

  return trimmedWords;
};

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
    trimmedWords = extendToSentenceStart(sourceWords, trimmedWords, trimmedText);
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
    trimmedWords = extendToSentenceStart(sourceWords, trimmedWords, trimmedText);
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
