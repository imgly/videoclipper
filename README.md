# Video Shortener UI Boilerplate

This project is a Next.js (React + TypeScript) starter that comes preconfigured with Tailwind CSS and shadcn/ui. It includes a ready-to-run example page with a dark/light theme toggle, reusable UI primitives, and sensible linting + formatting defaults so you can focus on building product features.

## What's inside?

- **React 18 + TypeScript** running on Next.js for full-stack flexibility.
- **Tailwind CSS** configured with CSS variables for light/dark themes.
- **shadcn/ui primitives** (`button`, `card`, `input`, `dropdown-menu`, `label`) wired up and ready to extend.
- **Theme provider + toggle** to persist user preference in `localStorage`.
- **ESLint + Prettier** set up for type-aware linting and formatting consistency.

## Getting started

> Dependencies are not installed automatically. Run the commands below inside this directory.

1. Install packages:
   ```bash
   npm install
   ```
   _Alternative_: `pnpm install` or `yarn install`.

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. Open the URL printed in the terminal (Next defaults to http://localhost:3000).

### Environment variables

Create a `.env.local` (or `.env`) file before running the app and provide your ElevenLabs/Gemini credentials so transcripts can be generated/refined:

```
NEXT_PUBLIC_ELEVENLABS_API_KEY=sk_live_...
# Optional: override the transcription model (defaults to scribe_v1)
NEXT_PUBLIC_ELEVENLABS_TRANSCRIPTION_MODEL=scribe_v1

GEMINI_API_KEY=AIza...  # used by the Next.js API route when calling Google directly
# Optional: choose which provider handles Gemini requests (google | openrouter).
# If the server-side GEMINI_PROVIDER is omitted, the API route will fall back to NEXT_PUBLIC_GEMINI_PROVIDER.
# GEMINI_PROVIDER=google
# NEXT_PUBLIC_GEMINI_PROVIDER=google
# Optional: pin a specific Gemini model (defaults to a provider-specific recommended model)
NEXT_PUBLIC_GEMINI_MODEL=models/gemini-2.5-flash-lite
# Optional: override the Gemini REST version (defaults to v1). Set to v1beta if you need legacy models.
# GEMINI_API_VERSION=v1
# Optional: override the upload API version separately (defaults to v1beta when GEMINI_API_VERSION=v1)
# GEMINI_UPLOAD_API_VERSION=v1beta
# Optional: call a remote Gemini proxy instead of the current origin
# NEXT_PUBLIC_GEMINI_PROXY_URL=https://api.your-domain.com
# Optional: OpenRouter-specific configuration (used when GEMINI_PROVIDER or NEXT_PUBLIC_GEMINI_PROVIDER is set to openrouter)
# OPENROUTER_API_KEY=sk-or-...
# OPENROUTER_SITE_URL=https://your-app.example.com
# OPENROUTER_APP_TITLE=Video Shortener
# OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
# (Local dev only) you may fall back to NEXT_PUBLIC_OPENROUTER_API_KEY if you can't set server env vars, but avoid shipping it client-side.
# NEXT_PUBLIC_OPENROUTER_API_KEY=sk-or-...
```

If you get a `models/... is not found for API version v1beta` error from Google, switch to the GA endpoints by setting `GEMINI_API_VERSION=v1` (or another version listed in `ListModels`).

To run through OpenRouter, set `GEMINI_PROVIDER=openrouter` (or just `NEXT_PUBLIC_GEMINI_PROVIDER=openrouter`), provide an OpenRouter API key, and point `NEXT_PUBLIC_GEMINI_MODEL` at an OpenRouter model id such as `google/gemini-2.0-flash-exp`. The server inherits the provider flag from the client env if needed, so both sides stay in sync.

Restart the dev server after adding or changing environment variables.

## CE.SDK video shortener tutorial map

Use the files below as a guided path through the implementation. Each step aligns with a CE.SDK concept you can teach in the tutorial.

1. **Boot the engine + canvas**
   - `src/cesdk/use-cesdk-engine.ts` sets up CreativeEngine, creates the video scene, and attaches the canvas.
   - `src/components/shortener/preview-canvas.tsx` renders the canvas container and upload drop zone.

2. **Load a video and audio track**
   - `src/App.tsx` contains `loadVideoFile`, which inserts the video block, syncs duration, and creates the audio block.

3. **Extract audio + transcribe**
   - `src/features/shortener/elevenLabs.ts` calls ElevenLabs and returns structured transcript output.
   - `src/App.tsx` wires extraction progress to the UI and stores word-level timestamps.

4. **Refine with Gemini**
   - `src/features/shortener/gemini.ts` requests edits and normalizes the response for UI use.
   - `src/features/shortener/normalize.ts` keeps the response stable for multiple providers.

5. **Apply trims + captions**
   - `src/features/shortener/keepRanges.ts` converts transcript edits into timeline ranges.
   - `src/App.tsx` applies trims in `applyTranscriptCuts` and updates captions.

6. **Preview + advanced editing**
   - `src/components/shortener/preview-canvas.tsx` renders the canvas and hover playback overlays for the trim preview.
   - `src/components/shortener/timeline-scrubber.tsx` shows the result playback controls + segment scrubber.
   - `src/cesdk/use-cesdk-editor.ts` opens the full CE.SDK editor modal.

**UI composition**
- `src/App.tsx` orchestrates the flow and state wiring.
- `src/components/shortener/shortener-sidebar.tsx` renders the trim options, status, and highlight picker.

## Available scripts

- `npm run dev` – start Next.js in development mode.
- `npm run build` – create a production build.
- `npm run start` – run the production build locally.
- `npm run lint` – run ESLint on the project files.
- `npm run format` – format the project with Prettier.

## Tailwind + shadcn tips

- Add new shadcn/ui components with the CLI: `npx shadcn@latest add button`. The configuration lives in `components.json` and already points to the `@/components` and `@/lib` aliases.
- Tailwind scans `app/**/*.{ts,tsx}` and `src/**/*.{ts,tsx}`. Remember to keep component markup inside those paths so classes are picked up.
- Theme tokens are defined in `app/globals.css`. Customize them or add new CSS variables to extend the design system.

## Next steps

- Replace the demo UI in `src/App.tsx` (rendered via `app/page.tsx`) with your application logic.
- Update metadata in `app/layout.tsx`.
- Deploy to your preferred Next.js host (e.g., Vercel, Netlify, Cloudflare Pages) once you're ready to ship.
