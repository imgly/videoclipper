# Build in a Day: AI Video Clipping with CE.SDK

---

## Introduction

We built a video shortener in a single day using Claude Code and CE.SDK. It extracts 3-4 short clips from long-form video, handles transcription, identifies the best moments via AI, detects speakers, and outputs vertical/horizontal/square formats—all running in the browser.

**Features:**
- Extracts 3-4 clips per video (highlights, summaries, or cleaned-up edits)
- Outputs 9:16 (vertical), 16:9 (landscape), or 1:1 (square)
- Detects speakers and maps them to faces with user confirmation
- Auto-crops to follow the active speaker
- Adds captions and text hooks
- Non-destructive: change aspect ratio or template without re-processing

> **Best suited for**: Videos with speech/dialogue (podcasts, interviews, presentations, vlogs)

### Why Client-Side?

CE.SDK's CreativeEngine runs in the browser via WebAssembly. Video decoding, timeline manipulation, effects, and preview all happen on the user's device.

**Benefits:**
- **No upload/download wait** — edits preview instantly
- **Non-destructive** — switch aspect ratio or template without re-rendering
- **Lower infrastructure costs** — your costs don't scale with video length or user count

### Tech Stack
- **Frontend**: Next.js + React
- **Video Engine**: CE.SDK (CreativeEngine)
- **Transcription**: ElevenLabs Scribe v2
- **AI Analysis**: Google Gemini

---

## Architecture Overview

### High-Level Flow

```
Illustration // FIGMA
```

### Required API Keys

| Service | Purpose | Environment Variable |
|---------|---------|---------------------|
| CE.SDK | Video editing engine | `NEXT_PUBLIC_CESDK_LICENSE` |
| ElevenLabs | Speech-to-text transcription | `ELEVENLABS_API_KEY` |
| Gemini (via OpenRouter or direct) | AI highlight detection | `OPENROUTER_API_KEY` or `GEMINI_API_KEY` |

---

## Setting Up CE.SDK

### What is CE.SDK?

CE.SDK (CreativeEngine SDK) is a browser-based engine for video, image, and design editing—a programmable video editor you can embed in your app.

**Key Concepts:**
- **Engine**: The core runtime that manages the editing session
- **Scene**: The document/project containing all elements
- **Blocks**: Individual elements (video clips, text, shapes, audio)
- **Timeline**: Time-based arrangement of blocks for video editing

### Installation

```bash
npm install @cesdk/cesdk-js
```

### Initializing the CreativeEngine

```typescript
import CreativeEngine from '@cesdk/cesdk-js';

const engine = await CreativeEngine.init({
  license: process.env.NEXT_PUBLIC_CESDK_LICENSE,
});

// Create a video scene
const scene = engine.scene.createVideo();

// Get the page (timeline container)
const pages = engine.scene.getPages();
const page = pages[0];

// Configure page dimensions for your target aspect ratio
engine.block.setWidth(page, 1080);  // 9:16 vertical
engine.block.setHeight(page, 1920);
```

### Uploading Video to CE.SDK

```typescript
// Create a video block
const videoBlock = engine.block.create('graphic');
const videoFill = engine.block.createFill('video');

// Set the video source
engine.block.setString(
  videoFill,
  'fill/video/fileURI',
  videoUrl  // Can be a blob URL or remote URL
);

// Apply fill to block
engine.block.setFill(videoBlock, videoFill);

// Add to timeline
engine.block.appendChild(page, videoBlock);
```

### Extracting Audio for Transcription

```typescript
// Configure audio-only export
const mimeType = 'audio/mp4';

// Export just the audio track
const audioBlob = await engine.block.export(page, mimeType, {
  targetWidth: 0,
  targetHeight: 0,
});

// audioBlob can now be sent to transcription API
```

### Getting Video Metadata

```typescript
// Get video duration
const duration = engine.block.getDuration(videoBlock);

// Get dimensions from the fill
const videoFill = engine.block.getFill(videoBlock);
const sourceWidth = engine.block.getSourceWidth(videoFill);
const sourceHeight = engine.block.getSourceHeight(videoFill);

console.log(`Video: ${sourceWidth}x${sourceHeight}, ${duration}s`);
```

---

## AI-Powered Transcription & Highlight Detection

### The Pipeline

1. **Audio → Transcription**: Send extracted audio to ElevenLabs Scribe
2. **Transcription → Analysis**: Feed word-level transcript to Gemini
3. **Analysis → Timestamps**: Map AI suggestions back to precise video times

### Transcription with Speaker Diarization

ElevenLabs Scribe v2 provides:
- Word-level timestamps (start/end time for each word)
- Speaker diarization (which speaker said what)

The output is a structured transcript where each word has a precise timestamp, enabling frame-accurate editing.

### AI Highlight Detection with Gemini

The prompt structure matters. Here's what works:

```
You are analyzing a video transcript to identify segments for short-form content.

TRANSCRIPT:
[Word-by-word transcript with timestamps]

TASK:
Identify 3-4 segments that work as standalone short videos. For each segment:
1. Find the exact starting and ending words
2. Ensure clean sentence boundaries (no mid-sentence cuts)
3. Aim for 30-60 second segments

OUTPUT FORMAT (JSON):
{
  "concepts": [
    {
      "id": "concept_1",
      "title": "Hook title",
      "description": "Why this segment works as a standalone clip",
      "trimmed_text": "The exact transcript text to keep...",
      "estimated_duration_seconds": 45
    }
  ]
}

CRITERIA FOR SELECTION:
- Strong hooks (surprising statements, questions, bold claims)
- Complete thoughts (don't cut mid-explanation)
- Emotional peaks (humor, insight, controversy)
- Standalone value (makes sense without context)
```

### Mapping Back to Timestamps

Once Gemini returns the `trimmed_text`, we match it against our word-level transcript to find exact timestamps:

```
AI returns:     "The secret to success is actually quite simple..."
Transcript has: [{ word: "The", start: 45.2 }, { word: "secret", start: 45.4 }, ...]

Result:         Trim video from 45.2s to 52.8s
```

This text-matching approach is more reliable than asking the AI to output timestamps directly.

---

## Working with the CE.SDK Timeline

### Understanding Blocks

```typescript
// Video/Image content
const graphic = engine.block.create('graphic');

// Audio track
const audio = engine.block.create('audio');

// Text overlay
const text = engine.block.create('text');

// Each block can be positioned on the timeline
engine.block.setTimeOffset(block, startTimeInSeconds);
engine.block.setDuration(block, durationInSeconds);
```

### Manipulating Trim Points

Trimming controls which portion of the source media is shown:

```typescript
const videoFill = engine.block.getFill(videoBlock);

// Set where in the source video to start (in seconds)
engine.block.setTrimOffset(videoFill, 45.2);

// Set how long to play from that point
engine.block.setTrimLength(videoFill, 30.0);

// Also update the block's duration to match
engine.block.setDuration(videoBlock, 30.0);
```

### Working with Fills and Their Timing

```typescript
// Get the fill (contains the actual media)
const fill = engine.block.getFill(block);

// Fills have their own timing properties
const trimStart = engine.block.getTrimOffset(fill);
const trimDuration = engine.block.getTrimLength(fill);

// The block's duration should typically match the fill's trim length
engine.block.setDuration(block, trimDuration);
```

### Creating Time-Based Edits from Transcript Words

```typescript
interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  speaker_id?: string;
}

function applyTranscriptTrim(
  engine: CreativeEngine,
  videoBlock: number,
  words: TranscriptWord[]
) {
  if (words.length === 0) return;

  const startTime = words[0].start;
  const endTime = words[words.length - 1].end;
  const duration = endTime - startTime;

  const fill = engine.block.getFill(videoBlock);

  engine.block.setTrimOffset(fill, startTime);
  engine.block.setTrimLength(fill, duration);
  engine.block.setDuration(videoBlock, duration);
}
```

### Generating Speaker Thumbnails

```typescript
async function generateSpeakerThumbnail(
  engine: CreativeEngine,
  videoBlock: number,
  timestampSeconds: number,
  size: number = 128
): Promise<string> {
  const fill = engine.block.getFill(videoBlock);

  // Seek to the specific timestamp
  engine.block.setTrimOffset(fill, timestampSeconds);
  engine.block.setTrimLength(fill, 0.1); // Just a single frame

  // Export as image
  const blob = await engine.block.export(videoBlock, 'image/jpeg', {
    targetWidth: size,
    targetHeight: size,
  });

  return URL.createObjectURL(blob);
}
```

---

## Speaker Detection & Face Tracking

### Why Semi-Automatic?

Fully automatic speaker detection fails often enough that we added a confirmation step. Users verify detected faces against speaker names from the transcript—takes a few seconds and prevents bad crops on the entire video.

### How It Works

1. **Sample frames** throughout the video
2. **Detect & cluster faces** using face-api.js (runs in browser, no server needed)
3. **User confirms** speaker identities via thumbnails
4. **Correlate with transcript** diarization to map speakers → face locations

This gives us verified speaker-to-face mapping for dynamic cropping and picture-in-picture layouts.

---

## Multi-Speaker Templates & Dynamic Switching

### The Concept

When a video has multiple speakers, we can create layouts that show:
- The **active speaker** prominently
- **Other speakers** in smaller picture-in-picture views
- **Dynamic switching** as the conversation flows

### Creating Picture-in-Picture with CE.SDK

```typescript
// Duplicate the video block for each speaker slot
const pipBlock = engine.block.duplicate(originalVideoBlock);

// Position and size the PiP
engine.block.setWidth(pipBlock, 200);
engine.block.setHeight(pipBlock, 200);
engine.block.setPositionX(pipBlock, 20);  // 20px from left
engine.block.setPositionY(pipBlock, 20);  // 20px from top

// Enable cropping
engine.block.setClipped(pipBlock, true);
engine.block.setContentFillMode(pipBlock, 'Cover');
```

### Key Technique: Muting Duplicate Audio

When duplicating video blocks for multi-speaker layouts, each copy has its own audio track. We must mute all but one:

```typescript
// For each speaker slot after the first
if (slotIndex > 0) {
  engine.block.setMuted(duplicatedBlock, true);
}
```

### Dynamic Speaker Switching

As the active speaker changes throughout the video, we:
1. Detect which speaker is talking (from transcript diarization)
2. Swap speaker positions in the template
3. Keep the active speaker in the prominent position

The layout updates automatically as the conversation switches between speakers.

---

## Preview, Playback & Export

### Setting Up the Canvas

```typescript
const container = document.getElementById('cesdk-canvas');
engine.element.attachTo(container);
```

### Playback Controls

```typescript
engine.player.play();
engine.player.pause();
engine.player.setPlaybackTime(30.5); // seek to 30.5 seconds

const currentTime = engine.player.getPlaybackTime();
const isPlaying = engine.player.isPlaying();
```

### Syncing UI State

```typescript
engine.player.onPlaybackTimeChanged(() => {
  const time = engine.player.getPlaybackTime();
  updateTimeDisplay(time);
  updateProgressBar(time / totalDuration);
});

engine.player.onPlaybackStateChanged(() => {
  updatePlayButton(engine.player.isPlaying());
});
```

### Export Options

```typescript
const exportOptions = {
  targetWidth: 1080,
  targetHeight: 1920,
  framerate: 30,
  videoBitrate: 8_000_000,  // 8 Mbps
};

const blob = await engine.block.export(
  page,
  'video/mp4',
  exportOptions,
  (progress) => updateProgressBar(progress * 100)
);

// Trigger download
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'shortened-video.mp4';
a.click();
```

For longer videos, consider showing estimated time remaining or allowing background export.

---

## The Finished App

[Screenshots/GIF of the app in action]

The user flow:

**Upload** → Drop a long-form video into the browser

**Configure** → Pick output mode (highlights/summary/cleanup) and aspect ratio (9:16, 16:9, 1:1)

**Verify speakers** → Match detected faces to transcript speaker names

**Review clips** → Browse the 3-4 AI-suggested segments, adjust if needed

**Choose template** → Solo speaker, sidecar, stacked, etc.

**Preview** → Scrub through the timeline, see exactly what you'll get

**Export** → Download the final video directly from the browser

---

## What's Next

### Ideas for Extension

- **Caption style controls**: Custom fonts, animations, and positioning for subtitles
- **B-roll insertion**: Automatically add relevant stock footage
- **Music & sound effects**: AI-selected background audio
- **Brand templates**: Custom overlays, intros, outros
- **Batch processing**: Process multiple videos in sequence

### Taking It Server-Side

Client-side processing has limits: large files strain browser memory, and users must keep the tab open during export. A hybrid approach works better for production—upload in the background while users edit, then render on a server.

CE.SDK runs server-side with the same API. For batch processing, background jobs, or offloading rendering from user devices, see the [CE.SDK Renderer for creative automation](https://img.ly/blog/ce-sdk-renderer-creative-automation/).

### Resources

- [CE.SDK Documentation](https://img.ly/docs/cesdk)
- [CE.SDK Video Editing Guide](https://img.ly/docs/cesdk/video)
- [GitHub: Video Shortener Source](https://github.com/imgly/video-shortener)
- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [Gemini API Docs](https://ai.google.dev/docs)

---

*Made by [IMG.LY](https://img.ly) with [CE.SDK](https://img.ly/creative-sdk)*
