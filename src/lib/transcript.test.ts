import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/elevenlabs-response.json";
import {
  ElevenLabsTranscriptResponse,
  extractTranscriptWords,
  pickTranscriptText,
  transcriptWordsToText,
} from "./transcript";

const sample = fixture as ElevenLabsTranscriptResponse;

describe("pickTranscriptText", () => {
  it("returns the richest consolidated transcript available", () => {
    const text = pickTranscriptText(sample);
    expect(text).toBeTruthy();
    expect(text).toContain("We're diving deep into the world of prospecting FSBO leads.");
    expect(text).toContain("Happy prospecting.");
  });
});

describe("extractTranscriptWords", () => {
  const words = extractTranscriptWords(sample);

  it("filters non-verbal tokens and sorts by start time", () => {
    expect(words.length).toBe(36);
    expect(words[0]).toEqual({ text: "We're", start: 1.73, end: 1.84, speaker_id: null });
    expect(words.some((word) => /(laughs)/i.test(word.text))).toBe(false);
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index].start).toBeGreaterThanOrEqual(words[index - 1].start);
    }
  });

  it("joins back into plain text when needed", () => {
    const condensed = transcriptWordsToText(words.slice(0, 12));
    expect(condensed.startsWith("We're We're diving diving deep")).toBe(true);

    const fullText = transcriptWordsToText(words);
    expect(fullText.trim().endsWith("Happy prospecting.")).toBe(true);
  });
});
