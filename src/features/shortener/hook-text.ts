import type { TranscriptWord } from "@/lib/transcript";

const SENTENCE_END_REGEX = /[.!?]["')\]]?$/;
const HOOK_MAX_WORDS = 18;
const HOOK_MIN_WORDS = 6;
const HOOK_MAX_CHARACTERS = 96;
const HOOK_DEFAULT_TEXT = "Here's the key moment - watch what happens.";

/**
 * Normalize hook text by collapsing whitespace and fixing punctuation spacing
 */
export const normalizeHookText = (text: string): string =>
  text.replace(/\s+([,.!?])/g, "$1").replace(/\s+/g, " ").trim();

/**
 * Build hook text from transcript words
 * Extracts a complete sentence between HOOK_MIN_WORDS and HOOK_MAX_WORDS
 */
export const buildHookTextFromWords = (words: TranscriptWord[]): string => {
  if (!words.length) return HOOK_DEFAULT_TEXT;
  const selected: string[] = [];
  let wordCount = 0;
  for (const word of words) {
    const token = word.text?.trim() ?? "";
    if (!token) continue;
    selected.push(token);
    wordCount += 1;
    if (wordCount >= HOOK_MIN_WORDS && SENTENCE_END_REGEX.test(token)) {
      break;
    }
    if (wordCount >= HOOK_MAX_WORDS) {
      break;
    }
  }
  const baseSentence = normalizeHookText(selected.join(" "));
  if (!baseSentence) return HOOK_DEFAULT_TEXT;
  if (baseSentence.length <= HOOK_MAX_CHARACTERS) return baseSentence;
  return `${baseSentence.slice(0, HOOK_MAX_CHARACTERS - 3).trim()}...`;
};

/**
 * Coerce and validate hook text, truncating if necessary
 */
export const coerceHookText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = normalizeHookText(value);
  if (!cleaned) return null;
  if (cleaned.length <= HOOK_MAX_CHARACTERS) return cleaned;
  return `${cleaned.slice(0, HOOK_MAX_CHARACTERS - 3).trim()}...`;
};

export { HOOK_DEFAULT_TEXT, HOOK_MAX_CHARACTERS };
