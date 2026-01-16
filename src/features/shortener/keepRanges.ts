import type { TranscriptWord } from "@/lib/transcript";
import type { TimeRange } from "./types";

const normalizeWordText = (text: string | undefined | null) =>
  text?.toLowerCase().replace(/[^a-z0-9']+/g, "") ?? "";

export const buildKeepRangesFromWords = (
  sourceWords: TranscriptWord[],
  refinedWords: TranscriptWord[],
  totalDuration: number,
  minRangeDurationSeconds = 0
): TimeRange[] => {
  if (!sourceWords.length || !refinedWords.length) return [];
  const clampedDuration = Math.max(
    totalDuration,
    sourceWords[sourceWords.length - 1]?.end ?? 0
  );
  const minDuration = Math.max(0.01, minRangeDurationSeconds);
  const normalizedSource = sourceWords.map((word, index) => ({
    index,
    start: Math.max(0, word.start),
    end: Math.max(word.start, word.end),
    normalized: normalizeWordText(word.text),
  }));

  let searchIndex = 0;
  let lastMatchedIndex = -2;
  let currentRange: TimeRange | null = null;
  const ranges: TimeRange[] = [];

  refinedWords.forEach((refinedWord) => {
    const target = normalizeWordText(refinedWord.text);
    if (!target) return;
    let matchIndex = -1;
    for (let i = searchIndex; i < normalizedSource.length; i += 1) {
      if (normalizedSource[i].normalized === target) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex === -1) {
      return;
    }
    searchIndex = matchIndex + 1;
    const matchedWord = normalizedSource[matchIndex];
    if (currentRange && matchIndex === lastMatchedIndex + 1) {
      currentRange.end = matchedWord.end;
    } else {
      if (currentRange) {
        ranges.push(currentRange);
      }
      currentRange = { start: matchedWord.start, end: matchedWord.end };
    }
    lastMatchedIndex = matchIndex;
  });

  if (currentRange) {
    ranges.push(currentRange);
  }

  return ranges
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, clampedDuration)),
      end: Math.max(0, Math.min(range.end, clampedDuration)),
    }))
    .filter((range) => range.end - range.start >= minDuration);
};

export const calculateDurationFromWords = (
  sourceWords: TranscriptWord[],
  refinedWords: TranscriptWord[],
  totalDuration: number,
  minRangeDurationSeconds = 1
): number => {
  const ranges = buildKeepRangesFromWords(
    sourceWords,
    refinedWords,
    totalDuration,
    minRangeDurationSeconds
  );
  return ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
};
