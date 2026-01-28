# Build in a Day: AI Video-Clipping — From Long-Form to Viral Clips with CE.SDK

---

## 1. Introduction

### The Challenge
Turning long-form video into engaging short clips is time-consuming and requires skilled editing. What if we could automate the entire process—from identifying the best moments to creating polished, multi-format outputs?

### What We're Building
An AI-powered video shortener that:

- **Automatically creates 3-4 shorts** from a long video
- **Multiple output modes**: highlights, summaries, or cleaned-up edits
- **Flexible aspect ratios**: 9:16 (vertical), 16:9 (landscape), 1:1 (square)
- **Semi-automatic speaker detection** with user confirmation (quiz-style interaction)
- **Face detection** for automatic zoom and crop on speakers
- **Auto-captions & text hooks** for social media engagement
- **Fully editable results** — style, layout, and format changes without re-processing

> **Best suited for**: Videos with significant speech/dialogue (podcasts, interviews, presentations, vlogs)

### Why Client-Side Video Editing?

CE.SDK's CreativeEngine runs entirely in the browser via WebAssembly. This means all the heavy lifting — video decoding, timeline manipulation, effects rendering, and preview generation — happens directly on the user's device rather than on remote servers.

**Why this matters:**

- **2-3x faster turnaround** — No upload/download overhead, no queue waiting. Edits preview instantly.
- **Non-destructive editing** — Changed your mind about the aspect ratio? Want a different template? Just switch it. No need to re-process the entire video like with cloud services.
- **Lower infrastructure costs** — Processing happens on the user's device, not your servers. Your costs don't scale with video length or user count.
- **Better user experience** — Real-time preview means users see exactly what they'll get, instantly.

### Built in a Day
This entire application was built in a single day using:
- **Claude Code** for AI-assisted development
- **CE.SDK** as the video editing engine
- The combination of a powerful SDK + AI coding tools enables rapid prototyping of complex video applications

### Tech Stack
- **Frontend**: Next.js + React
- **Video Engine**: CE.SDK (CreativeEngine)
- **Transcription**: ElevenLabs Scribe v2
- **AI Analysis**: Google Gemini

---

## 2. Architecture Overview

### High-Level Flow

```
Illustration // FIGMA 
```

### Ingredients: API Keys Required

| Service | Purpose | Environment Variable |
|---------|---------|---------------------|
| CE.SDK | Video editing engine | `NEXT_PUBLIC_CESDK_LICENSE` |
| ElevenLabs | Speech-to-text transcription | `ELEVENLABS_API_KEY` |
| Gemini (via OpenRouter or direct) | AI highlight detection | `OPENROUTER_API_KEY` or `GEMINI_API_KEY` |

---

## 3. Setting Up CE.SDK

### What is CE.SDK?

CE.SDK (CreativeEngine SDK) is a powerful, browser-based creative engine that enables real-time video, image, and design editing. Think of it as a programmable video editor that runs entirely in the browser.

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

## 4. AI-Powered Transcription & Highlight Detection

### The Pipeline

1. **Audio → Transcription**: Send extracted audio to ElevenLabs Scribe
2. **Transcription → Analysis**: Feed word-level transcript to Gemini
3. **Analysis → Timestamps**: Map AI suggestions back to precise video times

### Transcription with Speaker Diarization

ElevenLabs Scribe v2 provides:
- Word-level timestamps (start/end time for each word)
- Speaker diarization (which speaker said what)
- High accuracy even with multiple speakers

The output gives us a structured transcript where each word has a precise timestamp, enabling frame-accurate editing.

### AI Highlight Detection with Gemini

The key to good results is a well-crafted prompt. Here's the essential structure:

```
You are analyzing a video transcript to identify the most compelling segments
for short-form content.

TRANSCRIPT:
[Word-by-word transcript with timestamps]

TASK:
Identify 3-4 segments that would make engaging short videos. For each segment:
1. Find the exact starting and ending words
2. Ensure clean sentence boundaries (no mid-sentence cuts)
3. Aim for 30-60 second segments

OUTPUT FORMAT (JSON):
{
  "concepts": [
    {
      "id": "concept_1",
      "title": "Compelling hook title",
      "description": "What makes this segment engaging",
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

## 5. Working with the CE.SDK Timeline

This section is your cookbook for common timeline operations.

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

## 6. Speaker Detection & Face Tracking

### Why Semi-Automatic?

We chose a **human-in-the-loop** approach: a quick 5-second confirmation beats re-processing a 10-minute video when auto-detection fails. The quiz-style "Who is this speaker?" interaction also turns a technical step into an engaging moment.

### How It Works

1. **Sample frames** throughout the video
2. **Detect & cluster faces** using face-api.js (browser-based, no server needed)
3. **User confirms** speaker identities via thumbnails
4. **Correlate with transcript** diarization to map speakers → face locations

The result: verified speaker-to-face mapping enabling dynamic cropping and picture-in-picture layouts.

---

## 7. Multi-Speaker Templates & Dynamic Switching

### The Concept

When a video has multiple speakers, we can create engaging layouts that show:
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
3. Ensure the active speaker is always in the prominent position

This creates a "smart" layout that follows the conversation naturally.

---

## 8. Preview & Playback

### Setting Up the CE.SDK Canvas

```typescript
// Create a container element
const container = document.getElementById('cesdk-canvas');

// Attach the engine's canvas
engine.element.attachTo(container);

// The engine will render the current scene to this canvas
```

### Controlling Playback

```typescript
// Play/Pause
engine.player.play();
engine.player.pause();

// Seek to specific time
engine.player.setPlaybackTime(30.5); // 30.5 seconds

// Get current playback time
const currentTime = engine.player.getPlaybackTime();

// Check playback state
const isPlaying = engine.player.isPlaying();
```

### Syncing UI State

```typescript
// Listen for playback time changes
engine.player.onPlaybackTimeChanged(() => {
  const time = engine.player.getPlaybackTime();
  updateTimeDisplay(time);
  updateProgressBar(time / totalDuration);
});

// Listen for play/pause state changes
engine.player.onPlaybackStateChanged(() => {
  const playing = engine.player.isPlaying();
  updatePlayButton(playing);
});
```

---

## 9. Exporting the Final Video

### Export Options

```typescript
const exportOptions = {
  targetWidth: 1080,
  targetHeight: 1920,
  framerate: 30,
  videoBitrate: 8_000_000,  // 8 Mbps
};

const mimeType = 'video/mp4';
```

### Exporting with Progress

```typescript
const blob = await engine.block.export(
  page,
  mimeType,
  exportOptions,
  (progress) => {
    // progress is 0.0 to 1.0
    updateProgressBar(progress * 100);
    console.log(`Export: ${Math.round(progress * 100)}%`);
  }
);

// Create download link
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'shortened-video.mp4';
a.click();
```

### Handling Large Exports

For longer videos, consider:
- Showing estimated time remaining
- Allowing background export
- Chunked export for very large files

---

## 10. Demo: The Finished App

[Screenshots/GIF of the app in action]

1. **Upload** a long-form video
2. **Select mode**: Highlights, Summary, or Cleanup
3. **Choose aspect ratio**: 9:16, 16:9, or 1:1
4. **Confirm speakers**: Quick quiz-style verification of detected faces
5. **Review AI suggestions**: 3-4 auto-detected highlights
6. **Pick a template**: Solo, Sidecar, Stacked, etc.
7. **Preview & adjust**: Real-time editing in browser
8. **Export**: Download the final short-form video

---

## 11. Conclusion & Next Steps

### What We Covered

- Loading and manipulating video with CE.SDK
- Extracting audio and transcribing with word-level timestamps
- AI-powered highlight detection with Gemini
- Semi-automatic speaker detection (human-in-the-loop for accuracy)
- Multi-speaker templates with dynamic switching
- Real-time preview and export

### Ideas for Extension

- **Caption style controls**: Custom fonts, animations, and positioning for subtitles
- **B-roll insertion**: Automatically add relevant stock footage
- **Music & sound effects**: AI-selected background audio
- **Brand templates**: Custom overlays, intros, outros
- **Batch processing**: Process multiple videos in sequence

### Taking It Server-Side

While client-side processing offers speed and cost advantages, it has limitations — large files can strain browser memory, and users must keep the tab open during export. For a more robust solution, consider a hybrid approach: upload videos in the background while users continue editing, then offload final rendering to a server.

CE.SDK's multi-platform architecture makes this straightforward — the same code runs server-side too. If you need batch processing, background jobs, or want to offload rendering from user devices, check out the [CE.SDK Renderer for creative automation](https://img.ly/blog/ce-sdk-renderer-creative-automation/). It enables high-throughput video generation on your own infrastructure — same API, different runtime.

### Resources

- [CE.SDK Documentation](https://img.ly/docs/cesdk)
- [CE.SDK Video Editing Guide](https://img.ly/docs/cesdk/video)
- [GitHub: Video Shortener Source](https://github.com/imgly/video-shortener)
- [ElevenLabs API Docs](https://elevenlabs.io/docs)
- [Gemini API Docs](https://ai.google.dev/docs)

---

*Made by [IMG.LY](https://img.ly) with [CE.SDK](https://img.ly/creative-sdk) — the creative engine for browser-based design and video editing.*
