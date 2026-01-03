import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/elevenlabs-response.json";
import {
  ElevenLabsTranscriptResponse,
  OpenAITranscriptResponse,
  buildTranscriptWordsFromText,
  extractOpenAITranscriptWords,
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

  it("inherits speaker ids from segments when word labels are missing", () => {
    const payload: ElevenLabsTranscriptResponse = {
      segments: [
        {
          speaker_id: "speaker-a",
          words: [{ text: "Hello", start: 0, end: 0.4 }],
        },
        {
          speaker: "speaker-b",
          words: [
            { text: "world", start: 0.5, end: 0.9, speaker_id: "override" },
          ],
        },
      ],
    };
    const segmentWords = extractTranscriptWords(payload);
    expect(segmentWords[0]?.speaker_id).toBe("speaker-a");
    expect(segmentWords[1]?.speaker_id).toBe("override");
  });
});

describe("extractOpenAITranscriptWords", () => {
  it("normalizes word timestamps from OpenAI verbose_json", () => {
    const payload: OpenAITranscriptResponse = {
      text: "Hello world.",
      words: [
        { word: "Hello", start: 0.1, end: 0.2 },
        { word: " world.", start: 0.21, end: 0.4 },
      ],
    };
    const words = extractOpenAITranscriptWords(payload);
    expect(words).toEqual([
      { text: "Hello", start: 0.1, end: 0.2, speaker_id: null },
      { text: "world.", start: 0.21, end: 0.4, speaker_id: null },
    ]);
  });
});

describe("buildTranscriptWordsFromText", () => {
  it("creates evenly spaced word timings when timestamps are missing", () => {
    const words = buildTranscriptWordsFromText("Hello world", 2);
    expect(words).toEqual([
      { text: "Hello", start: 0, end: 1, speaker_id: null },
      { text: "world", start: 1, end: 2, speaker_id: null },
    ]);
  });
});
