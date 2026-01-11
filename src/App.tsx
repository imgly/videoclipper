"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Input,
  Output,
  Conversion,
  BlobSource,
  BufferTarget,
  WavOutputFormat,
  ALL_FORMATS,
} from "mediabunny";
import {
  buildTranscriptWordsFromText,
  extractOpenAITranscriptWords,
  extractTranscriptWords,
} from "@/lib/transcript";
import type {
  ElevenLabsTranscriptResponse,
  OpenAITranscriptResponse,
  TranscriptWord,
} from "@/lib/transcript";
import { transcribeWithElevenLabs } from "@/features/shortener/elevenLabs";
import { transcribeWithOpenAI } from "@/features/shortener/openAi";
import { requestGeminiRefinement } from "@/features/shortener/gemini";
import { buildKeepRangesFromWords } from "@/features/shortener/keepRanges";
import { useShortenerWorkflow } from "@/features/shortener/use-shortener-workflow";
import type {
  CaptionSegment,
  FaceBounds,
  GeminiRefinement,
  ProcessingStepId,
  RangeMapping,
  RefinementMode,
  SpeakerFaceThumbnail,
  SpeakerPreview,
  SpeakerSnippet,
  SpeakerTemplateId,
  SpeechToTextProvider,
  TimeRange,
} from "@/features/shortener/types";
import type { CreativeEngineInstance } from "@/cesdk/engine";
import { useCesdkEditor } from "@/cesdk/use-cesdk-editor";
import { useCesdkEngine } from "@/cesdk/use-cesdk-engine";
import AppHeader from "@/components/shortener/app-header";
import AspectRatioPicker from "@/components/shortener/aspect-ratio-picker";
import DebugModal from "@/components/shortener/debug-modal";
import EditorModal from "@/components/shortener/editor-modal";
import HighlightPicker from "@/components/shortener/highlight-picker";
import ProcessingStatusCard from "@/components/shortener/processing-status-card";
import PreviewCanvas from "@/components/shortener/preview-canvas";
import TemplatePicker from "@/components/shortener/template-picker";
import TimelineScrubber from "@/components/shortener/timeline-scrubber";
import TrimFocusCard from "@/components/shortener/trim-focus-card";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { SPEAKER_TEMPLATE_OPTIONS } from "@/features/shortener/templates";
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_ASPECT_RATIO_ID,
  resolveAspectRatio,
} from "@/features/shortener/aspect-ratios";

const CAPTION_MAX_WORDS = 8;
const CAPTION_MAX_DURATION = 3.2;
const CAPTION_MAX_CHARACTERS = 48;
const SENTENCE_END_REGEX = /[.!?]["')\]]?$/;
const SOFT_BREAK_REGEX = /[,;:]/;
const CAPTION_SENTENCE_GAP = 0.6;
const CAPTION_SOFT_BREAK_GAP = 0.35;
const CAPTIONS_TRACK_TYPE = "captionTrack";
const CAPTION_ENTRY_TYPE = "caption";
const FACE_MODEL_URI = "/models";
const FACE_THUMBNAIL_HEIGHT = 256;
const FACE_THUMBNAIL_TIMEOUT_MS = 2500;
const FACE_THUMBNAIL_EXPORT_SIZE = 320;
const FACE_THUMBNAIL_EXPORT_FALLBACKS = [256, 192, 160, 128];
const FACE_DEBUG_EXPORT_SIZE = 640;
const FACE_DEBUG_EXPORT_TIMEOUT_MS = 12000;
const FACE_CROP_SCALE = 1.6;
const FACE_CROP_MIN_RATIO = 0.2;
const FACE_CROP_MAX_SIZE = 720;
const FACE_CROP_RECT_SCALE = 1.05;
const FACE_CROP_RECT_EXTRA_WIDTH = 48;
const FACE_CROP_RECT_EXTRA_HEIGHT = 56;
const FACE_CROP_RECT_TOP_BIAS = 0.8;
const FACE_CROP_CORNER_RADIUS_RATIO = 0.18;
const FACE_CROP_CORNER_RADIUS_MIN = 16;
const FACE_CROP_CORNER_RADIUS_MAX = 72;
const FACE_OVERLAY_COLORS = [
  { r: 0.95, g: 0.32, b: 0.32, a: 0.22 },
  { r: 0.23, g: 0.64, b: 0.95, a: 0.22 },
  { r: 0.2, g: 0.82, b: 0.49, a: 0.22 },
  { r: 0.98, g: 0.74, b: 0.18, a: 0.22 },
  { r: 0.78, g: 0.38, b: 0.89, a: 0.22 },
  { r: 0.95, g: 0.49, b: 0.2, a: 0.22 },
] as const;
const SPEAKER_SNIPPET_MIN_SECONDS = 3;
const SPEAKER_SEGMENT_GAP_SECONDS = 0.8;
const HOOK_DURATION_SECONDS = 5;
const HOOK_MAX_WORDS = 18;
const HOOK_MIN_WORDS = 6;
const HOOK_MAX_CHARACTERS = 96;
const HOOK_DEFAULT_TEXT = "Here's the key moment - watch what happens.";
const DEFAULT_ANALYSIS_SECONDS = 30;
const MIN_CLIP_DURATION_SECONDS = 1;

const calculateSceneDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number
) => {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    return { width: 1920, height: 1080 };
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 1920, height: 1080 };
  }
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio >= targetRatio) {
    return {
      width: sourceHeight * targetRatio,
      height: sourceHeight,
    };
  }
  return {
    width: sourceWidth,
    height: sourceWidth / targetRatio,
  };
};

const normalizeHookText = (text: string) =>
  text.replace(/\s+([,.!?])/g, "$1").replace(/\s+/g, " ").trim();

const buildHookTextFromWords = (words: TranscriptWord[]) => {
  if (!words.length) return HOOK_DEFAULT_TEXT;
  const selected: string[] = [];
  let wordCount = 0;
  for (const word of words) {
    const token = word.text?.trim() ?? "";
    if (!token) continue;
    selected.push(token);
    wordCount += 1;
    if (
      wordCount >= HOOK_MIN_WORDS &&
      SENTENCE_END_REGEX.test(token)
    ) {
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

const coerceHookText = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const cleaned = normalizeHookText(value);
  if (!cleaned) return null;
  if (cleaned.length <= HOOK_MAX_CHARACTERS) return cleaned;
  return `${cleaned.slice(0, HOOK_MAX_CHARACTERS - 3).trim()}...`;
};

type AnalysisEstimate = {
  minSeconds: number;
  maxSeconds: number;
  wordCount: number;
};

type FaceApiModule = typeof import("face-api.js");
type FaceDetectionResult = {
  detection?: { box: { x: number; y: number; width: number; height: number } };
  box?: { x: number; y: number; width: number; height: number };
};
type FaceCropRegion = {
  size: number;
  x: number;
  y: number;
};
type FaceCropRect = {
  width: number;
  height: number;
  x: number;
  y: number;
};
type NormalizedCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type PreloadScript = {
  version: 1;
  refinementMode: RefinementMode;
  desiredVariants: number;
  words: TranscriptWord[];
  refinement: GeminiRefinement;
  speakerSnippets: SpeakerSnippet[];
  faceSlotsBySpeaker: Record<string, FaceBounds[]>;
  thumbnails: SpeakerFaceThumbnail[];
  primarySpeakerId: string | null;
  maxFaces: number;
  exportedAt: string;
};
type LayoutSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [timelineDuration, setTimelineDuration] = useState(0);
  const [timelinePosition, setTimelinePosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineSegments, setTimelineSegments] = useState<TimeRange[]>([]);
  const [isScrubbingTimeline, setIsScrubbingTimeline] = useState(false);
  const [targetAspectRatioId, setTargetAspectRatioId] = useState(
    DEFAULT_ASPECT_RATIO_ID
  );
  const [sourceVideoSize, setSourceVideoSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [analysisEstimate, setAnalysisEstimate] =
    useState<AnalysisEstimate | null>(null);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [analysisStartAt, setAnalysisStartAt] = useState<number | null>(null);
  const [speakerSnippets, setSpeakerSnippets] = useState<SpeakerSnippet[]>([]);
  const [speakerTemplateId, setSpeakerTemplateId] =
    useState<SpeakerTemplateId>("none");
  const [speakerThumbnails, setSpeakerThumbnails] = useState<
    SpeakerFaceThumbnail[]
  >([]);
  const [speakerAssignedThumbnails, setSpeakerAssignedThumbnails] = useState<
    Record<string, SpeakerFaceThumbnail>
  >({});
  const [speakerFaceSlots, setSpeakerFaceSlots] = useState<
    Record<string, FaceBounds[]>
  >({});
  const [primaryFaceSlots, setPrimaryFaceSlots] = useState<FaceBounds[]>([]);
  const [faceOptions, setFaceOptions] = useState<SpeakerFaceThumbnail[]>([]);
  const [speakerAssignments, setSpeakerAssignments] = useState<
    Record<string, number>
  >({});
  const [availableFaceSlots, setAvailableFaceSlots] = useState<number[]>([]);
  const [speakerQueue, setSpeakerQueue] = useState<string[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [hasPlayedSpeakerAudio, setHasPlayedSpeakerAudio] = useState(false);
  const [isSpeakerAudioPlaying, setIsSpeakerAudioPlaying] = useState(false);
  const [isSpeakerIdentificationActive, setIsSpeakerIdentificationActive] =
    useState(false);
  const [hidePreloadThumbnails, setHidePreloadThumbnails] = useState(false);
  const [isFaceCropPending, setIsFaceCropPending] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [textHookEnabled, setTextHookEnabled] = useState(true);
  const [transcriptDebug, setTranscriptDebug] = useState<
    ElevenLabsTranscriptResponse | OpenAITranscriptResponse | null
  >(null);
  const [geminiDebug, setGeminiDebug] = useState<string | null>(null);
  const [geminiFaceDebug, setGeminiFaceDebug] = useState<string | null>(null);
  const [geminiFaceThumbnail, setGeminiFaceThumbnail] = useState<string | null>(
    null
  );
  const [preloadScript, setPreloadScript] = useState<string | null>(null);
  const [isPreloadScriptExporting, setIsPreloadScriptExporting] =
    useState(false);
  const [isImportScriptOpen, setIsImportScriptOpen] = useState(false);
  const [importScriptText, setImportScriptText] = useState("");
  const [importScriptError, setImportScriptError] = useState<string | null>(null);
  const [isImportingScript, setIsImportingScript] = useState(false);
  const [captionDebug, setCaptionDebug] = useState<
    Record<string, CaptionSegment[]> | null
  >(null);
  const [speechProvider] = useState<SpeechToTextProvider>("elevenlabs");
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [currentTranscriptWords, setCurrentTranscriptWords] = useState<
    TranscriptWord[]
  >([]);
  const [sourceVideoDuration, setSourceVideoDuration] = useState(0);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isFaceDebugLoading, setIsFaceDebugLoading] = useState(false);
  const [debugExportMetrics, setDebugExportMetrics] = useState<string | null>(
    null
  );
  const captionsTrackRef = useRef<number | null>(null);
  const textHookBlockRef = useRef<number | null>(null);
  const textHookTextRef = useRef<string | null>(null);
  const textHookDurationRef = useRef<number>(HOOK_DURATION_SECONDS);
  const videoBlockRef = useRef<number | null>(null);
  const audioBlockRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoTrackRef = useRef<number | null>(null);
  const videoTemplateRef = useRef<number | null>(null);
  const captionStyleAppliedRef = useRef(false);
  const captionPresetAppliedRef = useRef(false);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const faceModelsReadyRef = useRef<Promise<boolean> | null>(null);
  const faceCenterCacheRef = useRef<Map<number, FaceBounds[]>>(new Map());
  const faceCropRunIdRef = useRef(0);
  const preloadRunIdRef = useRef(0);
  const clipSpeakerMapRef = useRef<Map<number, string | null>>(new Map());
  const speakerPlaybackTimeoutRef = useRef<number | null>(null);
  const speakerAssignmentsRef = useRef<Record<string, number>>({});
  const speakerTemplateIdRef = useRef<SpeakerTemplateId>("none");
  const speakerSnippetsRef = useRef<SpeakerSnippet[]>([]);
  const baseClipIdsRef = useRef<number[]>([]);
  const clipRangesRef = useRef<TimeRange[]>([]);
  const templateGroupIdsRef = useRef<number[]>([]);
  const templateClipIdsRef = useRef<number[]>([]);
  const faceOverlayIdsRef = useRef<number[]>([]);
  const faceOverlayTrackIdsRef = useRef<number[]>([]);
  const debugThumbnailRef = useRef<string | null>(null);
  const lastRefinementRef = useRef<GeminiRefinement | null>(null);
  const lastDesiredVariantsRef = useRef<number>(1);
  const lastRefinementModeRef = useRef<RefinementMode>("disfluency");
  const preloadSnapshotRef = useRef<PreloadScript | null>(null);
  const pendingWorkflowRef = useRef<{
    words: TranscriptWord[];
    refinement: GeminiRefinement;
    desiredVariants: number;
  } | null>(null);

  const handleEngineBeforeDispose = useCallback(
    (engine: CreativeEngineInstance) => {
      if (
        videoTemplateRef.current &&
        engine.block.isValid(videoTemplateRef.current)
      ) {
        engine.block.destroy(videoTemplateRef.current);
      }
      if (
        captionsTrackRef.current &&
        engine.block.isValid(captionsTrackRef.current)
      ) {
        engine.block.destroy(captionsTrackRef.current);
      }
      if (
        textHookBlockRef.current &&
        engine.block.isValid(textHookBlockRef.current)
      ) {
        engine.block.destroy(textHookBlockRef.current);
      }
      if (
        faceOverlayTrackIdsRef.current.length
      ) {
        faceOverlayTrackIdsRef.current.forEach((trackId) => {
          if (engine.block.isValid(trackId)) {
            engine.block.destroy(trackId);
          }
        });
      }
    },
    []
  );

  const handleEngineAfterDispose = useCallback(() => {
    videoBlockRef.current = null;
    audioBlockRef.current = null;
    captionsTrackRef.current = null;
    captionStyleAppliedRef.current = false;
    captionPresetAppliedRef.current = false;
    textHookBlockRef.current = null;
    textHookTextRef.current = null;
    textHookDurationRef.current = HOOK_DURATION_SECONDS;
    setTimelineDuration(0);
    setTimelinePosition(0);
    setIsPlaying(false);
    setTimelineSegments([]);
    setIsScrubbingTimeline(false);
    setSourceVideoSize(null);
    setAnalysisEstimate(null);
    setAnalysisStage(null);
    setAnalysisStartAt(null);
    setIsFaceCropPending(false);
    setCaptionsEnabled(true);
    setTextHookEnabled(true);
    setTranscriptDebug(null);
    setGeminiDebug(null);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setPreloadScript(null);
    setIsPreloadScriptExporting(false);
    setIsImportScriptOpen(false);
    setImportScriptText("");
    setImportScriptError(null);
    setIsImportingScript(false);
    setDebugExportMetrics(null);
    setCaptionDebug(null);
    setIsDebugOpen(false);
    setIsFaceDebugLoading(false);
    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;
    lastRefinementRef.current = null;
    lastDesiredVariantsRef.current = 1;
    preloadSnapshotRef.current = null;
    videoTrackRef.current = null;
    videoTemplateRef.current = null;
    baseClipIdsRef.current = [];
    clipRangesRef.current = [];
    templateGroupIdsRef.current = [];
    templateClipIdsRef.current = [];
    faceOverlayIdsRef.current = [];
    faceOverlayTrackIdsRef.current = [];
  }, []);

  const clearVideoBlocks = useCallback((engine: CreativeEngineInstance) => {
    if (audioBlockRef.current && engine.block.isValid(audioBlockRef.current)) {
      engine.block.destroy(audioBlockRef.current);
    }
    audioBlockRef.current = null;

    if (videoBlockRef.current && engine.block.isValid(videoBlockRef.current)) {
      engine.block.destroy(videoBlockRef.current);
    }
    videoBlockRef.current = null;

    if (
      videoTemplateRef.current &&
      engine.block.isValid(videoTemplateRef.current)
    ) {
      engine.block.destroy(videoTemplateRef.current);
    }
    videoTemplateRef.current = null;

    if (
      captionsTrackRef.current &&
      engine.block.isValid(captionsTrackRef.current)
    ) {
      engine.block.destroy(captionsTrackRef.current);
    }
    captionsTrackRef.current = null;
    if (
      textHookBlockRef.current &&
      engine.block.isValid(textHookBlockRef.current)
    ) {
      engine.block.destroy(textHookBlockRef.current);
    }
    textHookBlockRef.current = null;

    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
      const existingChildren = engine.block.getChildren(videoTrackRef.current) ?? [];
      existingChildren.forEach((child) => {
        if (engine.block.isValid(child)) {
          engine.block.destroy(child);
        }
      });
    }
    videoTrackRef.current = null;
    captionStyleAppliedRef.current = false;
    captionPresetAppliedRef.current = false;
  }, []);

  const disableBlockHighlight = useCallback(
    (engine: CreativeEngineInstance, blockId: number) => {
      if (!engine.editor) return;
      const editor = engine.editor as typeof engine.editor & {
        setHighlightingEnabled?: (id: number, enabled: boolean) => void;
      };
      if (typeof editor.setHighlightingEnabled !== "function") return;
      try {
        editor.setHighlightingEnabled(blockId, false);
      } catch (error) {
        console.warn("Failed to disable block highlighting", error);
      }
    },
    []
  );


  const {
    engineRef,
    pageRef,
    engineCanvasContainerRef,
    isEngineReady,
    engineInitError,
  } = useCesdkEngine({
    onBeforeDispose: handleEngineBeforeDispose,
    onAfterDispose: handleEngineAfterDispose,
  });

  const { editorContainerRef, isEditorLoading, editorError } = useCesdkEditor({
    isOpen: isEditorOpen,
    engineRef,
  });

  const {
    refinementMode,
    setRefinementMode,
    autoProcessing,
    setAutoProcessing,
    autoProcessStatuses,
    autoProcessingError,
    setAutoProcessingError,
    conceptChoices,
    setConceptChoices,
    selectedConceptId,
    setSelectedConceptId,
    isApplyingConcept,
    setIsApplyingConcept,
    applyingConceptId,
    setApplyingConceptId,
    hasStartedWorkflow,
    updateProcessingStatus,
    resetWorkflowState,
    beginWorkflow,
  } = useShortenerWorkflow();

  const revokeSpeakerThumbnailUrls = (thumbnails: SpeakerFaceThumbnail[]) => {
    if (
      !thumbnails?.length ||
      typeof URL === "undefined" ||
      typeof URL.revokeObjectURL !== "function"
    ) {
      return;
    }
    const urls = new Set(
      thumbnails
        .map((thumb) => thumb.src)
        .filter((src) => typeof src === "string" && src.startsWith("blob:"))
    );
    urls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
  };

  const resetPreloadState = () => {
    revokeSpeakerThumbnailUrls(speakerThumbnails);
    revokeSpeakerThumbnailUrls(Object.values(speakerAssignedThumbnails));
    setSpeakerSnippets([]);
    setSpeakerThumbnails([]);
    setSpeakerAssignedThumbnails({});
    setSpeakerFaceSlots({});
    setPrimaryFaceSlots([]);
    setFaceOptions([]);
    setSpeakerAssignments({});
    setAvailableFaceSlots([]);
    setSpeakerQueue([]);
    setActiveSpeakerId(null);
    setHasPlayedSpeakerAudio(false);
    setIsSpeakerAudioPlaying(false);
    setIsSpeakerIdentificationActive(false);
    setHidePreloadThumbnails(false);
    setPreloadScript(null);
    setIsPreloadScriptExporting(false);
    setIsImportScriptOpen(false);
    setImportScriptText("");
    setImportScriptError(null);
    setIsImportingScript(false);
    preloadRunIdRef.current += 1;
    pendingWorkflowRef.current = null;
    lastRefinementRef.current = null;
    lastDesiredVariantsRef.current = 1;
    preloadSnapshotRef.current = null;
    if (speakerPlaybackTimeoutRef.current) {
      window.clearTimeout(speakerPlaybackTimeoutRef.current);
      speakerPlaybackTimeoutRef.current = null;
    }
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (engine && pageId && engine.block.isValid(pageId)) {
      try {
        engine.block.setPlaying(pageId, false);
      } catch (error) {
        console.warn("Failed to stop speaker audio during reset", error);
      }
    }
    clipSpeakerMapRef.current = new Map();
    speakerAssignmentsRef.current = {};
    clearTemplateLayout();
    baseClipIdsRef.current = [];
    clipRangesRef.current = [];
  };

  useEffect(() => {
    const previous = debugThumbnailRef.current;
    if (
      previous &&
      previous !== geminiFaceThumbnail &&
      previous.startsWith("blob:") &&
      typeof URL !== "undefined" &&
      typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(previous);
    }
    debugThumbnailRef.current = geminiFaceThumbnail;
  }, [geminiFaceThumbnail]);

  useEffect(() => {
    speakerTemplateIdRef.current = speakerTemplateId;
  }, [speakerTemplateId]);

  useEffect(() => {
    speakerSnippetsRef.current = speakerSnippets;
  }, [speakerSnippets]);

  useEffect(() => {
    lastRefinementModeRef.current = refinementMode;
  }, [refinementMode]);

  const updateTimelineDuration = (engineInstance?: CreativeEngineInstance) => {
    const engine = engineInstance ?? engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId) return;
    try {
      const duration = engine.block.getDuration(pageId);
      if (Number.isFinite(duration) && duration >= 0) {
        setTimelineDuration(duration);
        setTimelinePosition((prev) => Math.min(prev, duration));
      }
    } catch (error) {
      console.warn("Failed to read timeline duration", error);
    }
  };

  const syncVideoLayoutToScene = (
    engine: CreativeEngineInstance,
    sceneWidth: number,
    sceneHeight: number,
    sourceWidth: number,
    sourceHeight: number
  ) => {
    const positionX = (sceneWidth - sourceWidth) / 2;
    const positionY = (sceneHeight - sourceHeight) / 2;
    const applyLayout = (blockId: number) => {
      if (!engine.block.isValid(blockId)) return;
      engine.block.setSize(blockId, sourceWidth, sourceHeight);
      engine.block.setPosition(blockId, positionX, positionY);
    };

    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
      const children = engine.block.getChildren(videoTrackRef.current) ?? [];
      children.forEach((child) => applyLayout(child));
    } else if (videoBlockRef.current) {
      applyLayout(videoBlockRef.current);
    }

    if (
      videoTemplateRef.current &&
      engine.block.isValid(videoTemplateRef.current)
    ) {
      applyLayout(videoTemplateRef.current);
    }
  };

  const applySceneAspectRatio = (
    ratioId: string,
    sizeOverride?: { width: number; height: number }
  ) => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    const sourceSize = sizeOverride ?? sourceVideoSize;
    if (!engine || !pageId || !sourceSize) return;
    const ratio = resolveAspectRatio(ratioId);
    const safeSourceWidth =
      Number.isFinite(sourceSize.width) && sourceSize.width > 0
        ? sourceSize.width
        : 1920;
    const safeSourceHeight =
      Number.isFinite(sourceSize.height) && sourceSize.height > 0
        ? sourceSize.height
        : 1080;
    const { width: sceneWidth, height: sceneHeight } =
      calculateSceneDimensions(safeSourceWidth, safeSourceHeight, ratio);

    try {
      engine.block.setWidth(pageId, sceneWidth);
      engine.block.setHeight(pageId, sceneHeight);
    } catch (error) {
      console.warn("Failed to update scene dimensions", error);
    }

    syncVideoLayoutToScene(
      engine,
      sceneWidth,
      sceneHeight,
      safeSourceWidth,
      safeSourceHeight
    );

    try {
      engine.scene.zoomToBlock(pageId, { padding: 0 });
    } catch (error) {
      console.warn("Failed to zoom after resizing scene", error);
    }
  };

  const imageDataToCanvas = (img: ImageData) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas context unavailable.");
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  };

  const grabFrame = (
    engine: CreativeEngineInstance,
    blockId: number,
    atSeconds: number,
    thumbH = FACE_THUMBNAIL_HEIGHT
  ) =>
    new Promise<ImageData>((resolve, reject) => {
      const safeTime = Number.isFinite(atSeconds) ? Math.max(0, atSeconds) : 0;
      if (!engine.block.isValid(blockId)) {
        reject(new Error("Block is not valid"));
        return;
      }
      let settled = false;
      let cancel: (() => void) | undefined;
      const finalize = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        fn();
      };
      const timeoutId = window.setTimeout(() => {
        cancel?.();
        finalize(() =>
          reject(new Error("Timed out while sampling video frame."))
        );
      }, FACE_THUMBNAIL_TIMEOUT_MS);
      try {
        cancel = engine.block.generateVideoThumbnailSequence(
          blockId,
          thumbH,
          safeTime,
          safeTime,
          1,
          (_index, result) => {
            cancel?.();
            if (result instanceof Error) {
              finalize(() => reject(result));
            } else {
              finalize(() => resolve(result));
            }
          }
        );
      } catch (error) {
        finalize(() =>
          reject(
            error instanceof Error
              ? error
              : new Error("Failed to sample video frame.")
          )
        );
      }
    });

  const detectFacesInFrame = async (
    faceapi: FaceApiModule,
    img: ImageData
  ): Promise<FaceBounds[]> => {
    const canvas = imageDataToCanvas(img);
    let detections: FaceDetectionResult[] = [];
    let scopeStarted = false;
    try {
      if (faceapi.tf?.engine) {
        faceapi.tf.engine().startScope();
        scopeStarted = true;
      }
      detections = (await faceapi.detectAllFaces(
        canvas,
        new faceapi.TinyFaceDetectorOptions()
      )) as FaceDetectionResult[];
    } catch (error) {
      console.warn("[FaceCrop] detection failed", error);
      return [];
    } finally {
      if (scopeStarted) {
        try {
          faceapi.tf.engine().endScope();
        } catch (scopeError) {
          console.warn("[FaceCrop] Failed to end TensorFlow scope", scopeError);
        }
      }
    }
    if (!detections?.length) return [];
    return detections.map((detection) => {
      const box = "detection" in detection ? detection.detection.box : detection.box;
      const { x, y, width, height } = box;
      const x0 = x / canvas.width;
      const x1 = (x + width) / canvas.width;
      const y0 = y / canvas.height;
      const y1 = (y + height) / canvas.height;
      return {
        cx: (x + width / 2) / canvas.width,
        cy: (y + height / 2) / canvas.height,
        x0,
        x1,
        y0,
        y1,
      };
    });
  };

  const clampValue = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const normalizeCropRect = (
    crop: FaceCropRect,
    sourceWidth: number,
    sourceHeight: number
  ): NormalizedCropRect | null => {
    const safeWidth = Math.max(1, sourceWidth);
    const safeHeight = Math.max(1, sourceHeight);
    let x = crop.x / safeWidth;
    let y = crop.y / safeHeight;
    let width = crop.width / safeWidth;
    let height = crop.height / safeHeight;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return null;
    }
    x = clampValue(x, 0, 1);
    y = clampValue(y, 0, 1);
    width = clampValue(width, 0, 1);
    height = clampValue(height, 0, 1);
    width = Math.max(0.01, Math.min(width, 1 - x));
    height = Math.max(0.01, Math.min(height, 1 - y));
    return { x, y, width, height };
  };

  const buildFacePixelCropRect = (
    face: FaceBounds,
    sourceWidth: number,
    sourceHeight: number
  ): FaceCropRect => {
    const safeWidth = Math.max(1, sourceWidth);
    const safeHeight = Math.max(1, sourceHeight);
    const x0 = clampValue(face.x0, 0, 1) * safeWidth;
    const x1 = clampValue(face.x1, 0, 1) * safeWidth;
    const y0 = clampValue(face.y0, 0, 1) * safeHeight;
    const y1 = clampValue(face.y1, 0, 1) * safeHeight;
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    const maxX = Math.max(0, safeWidth - width);
    const maxY = Math.max(0, safeHeight - height);
    return {
      x: clampValue(x0, 0, maxX),
      y: clampValue(y0, 0, maxY),
      width,
      height,
    };
  };

  const scaleCropRect = (
    rect: FaceCropRect,
    scale: number,
    maxWidth: number,
    maxHeight: number,
    extraWidth = 0,
    extraHeight = 0,
    topBias = 0.5
  ): FaceCropRect => {
    const safeScale =
      Number.isFinite(scale) && scale > 0 ? scale : 1;
    const safeExtraWidth =
      Number.isFinite(extraWidth) ? extraWidth : 0;
    const safeExtra =
      Number.isFinite(extraHeight) ? extraHeight : 0;
    const safeBias =
      Number.isFinite(topBias) ? clampValue(topBias, 0, 1) : 0.5;
    if (safeScale === 1 && safeExtra === 0 && safeExtraWidth === 0) {
      return rect;
    }
    const width = Math.max(1, rect.width * safeScale);
    const height = Math.max(
      1,
      rect.height * safeScale + safeExtra
    );
    const expandedWidth = Math.max(1, width + safeExtraWidth);
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const biasShift = (safeBias - 0.5) * safeExtra;
    const safeMaxWidth = Math.max(1, maxWidth);
    const safeMaxHeight = Math.max(1, maxHeight);
    const maxX = Math.max(0, safeMaxWidth - expandedWidth);
    const maxY = Math.max(0, safeMaxHeight - height);
    return {
      width: expandedWidth,
      height,
      x: clampValue(centerX - expandedWidth / 2, 0, maxX),
      y: clampValue(centerY - biasShift - height / 2, 0, maxY),
    };
  };

  const applyRoundedCorners = (
    engine: CreativeEngineInstance,
    shapeId: number,
    clipId: number,
    radius: number
  ) => {
    const safeRadius =
      Number.isFinite(radius) && radius > 0 ? radius : 0;
    if (!safeRadius) return;
    const applyToTarget = (targetId: number) => {
      let props: string[] = [];
      try {
        props = engine.block.findAllProperties(targetId) ?? [];
      } catch (error) {
        return false;
      }
      const cornerProps = props.filter((prop) =>
        prop.includes("cornerRadius")
      );
      if (cornerProps.length) {
        cornerProps.forEach((prop) => {
          try {
            engine.block.setFloat(targetId, prop, safeRadius);
          } catch (error) {
            // ignore invalid radius fields
          }
        });
        return true;
      }
      const shapeRadiusProps = props.filter(
        (prop) => prop.includes("shape") && prop.includes("radius")
      );
      if (!shapeRadiusProps.length) return false;
      shapeRadiusProps.forEach((prop) => {
        try {
          engine.block.setFloat(targetId, prop, safeRadius);
        } catch (error) {
          // ignore invalid radius fields
        }
      });
      return true;
    };
    if (engine.block.isValid(shapeId)) {
      const applied = applyToTarget(shapeId);
      if (applied) return;
    }
    if (engine.block.isValid(clipId)) {
      applyToTarget(clipId);
    }
  };

  const applyNormalizedCrop = (
    engine: CreativeEngineInstance,
    clipId: number,
    crop: NormalizedCropRect
  ) => {
    const blockApi = engine.block as unknown as {
      setCrop?: (id: number, value: NormalizedCropRect) => void;
      resetCrop?: (id: number) => void;
    };
    if (typeof blockApi.setCrop !== "function") return false;
    const applyToTarget = (targetId: number) => {
      try {
        blockApi.resetCrop?.(targetId);
      } catch (error) {
        console.warn("Failed to reset crop before applying", error);
      }
      try {
        blockApi.setCrop?.(targetId, crop);
        return true;
      } catch (error) {
        console.warn("Failed to apply normalized crop", error);
        return false;
      }
    };
    const targetIds: number[] = [];
    try {
      const fillId = engine.block.getFill(clipId);
      if (fillId && engine.block.isValid(fillId)) {
        targetIds.push(fillId);
      }
    } catch (error) {
      console.warn("Failed to apply crop on fill", error);
    }
    targetIds.push(clipId);
    for (const targetId of targetIds) {
      if (applyToTarget(targetId)) {
        return true;
      }
    }
    return false;
  };

  const applyRectCropScaleTranslation = (
    engine: CreativeEngineInstance,
    clipId: number,
    crop: FaceCropRect,
    options?: { resizeToCrop?: boolean }
  ) => {
    if (!engine.block.isValid(clipId)) return false;
    let blockWidth = 0;
    let blockHeight = 0;
    let blockX = 0;
    let blockY = 0;
    try {
      blockWidth = engine.block.getWidth(clipId);
      blockHeight = engine.block.getHeight(clipId);
      blockX = engine.block.getPositionX(clipId);
      blockY = engine.block.getPositionY(clipId);
    } catch (error) {
      console.warn("Failed to read clip layout for crop", error);
      return false;
    }
    if (
      !Number.isFinite(blockWidth) ||
      !Number.isFinite(blockHeight) ||
      blockWidth <= 0 ||
      blockHeight <= 0
    ) {
      return false;
    }
    const cropWidth = Math.max(1, crop.width);
    const cropHeight = Math.max(1, crop.height);
    const scaleX = blockWidth / cropWidth;
    const scaleY = blockHeight / cropHeight;
    const translateX = -crop.x / cropWidth;
    const translateY = -crop.y / cropHeight;
    if (
      !Number.isFinite(scaleX) ||
      !Number.isFinite(scaleY) ||
      !Number.isFinite(translateX) ||
      !Number.isFinite(translateY)
    ) {
      return false;
    }
    const applyToTarget = (targetId: number) => {
      try {
        engine.block.resetCrop(targetId);
        engine.block.setCropScaleX(targetId, scaleX);
        engine.block.setCropScaleY(targetId, scaleY);
        engine.block.setCropTranslationX(targetId, translateX);
        engine.block.setCropTranslationY(targetId, translateY);
        return true;
      } catch (error) {
        console.warn("Failed to apply rectangular crop", error);
        return false;
      }
    };
    const appliedClip = applyToTarget(clipId);
    let appliedFill = false;
    try {
      const fillId = engine.block.getFill(clipId);
      if (fillId && engine.block.isValid(fillId)) {
        appliedFill = applyToTarget(fillId);
      }
    } catch (error) {
      console.warn("Failed to resolve crop fill", error);
    }
    const applied = appliedClip || appliedFill;
    if (applied && options?.resizeToCrop) {
      try {
        engine.block.setWidth(clipId, cropWidth);
        engine.block.setHeight(clipId, cropHeight);
        engine.block.setPosition(clipId, blockX + crop.x, blockY + crop.y);
      } catch (error) {
        console.warn("Failed to resize clip for crop", error);
      }
    }
    return applied;
  };


  const applyFaceCropScaleTranslation = (
    engine: CreativeEngineInstance,
    clipId: number,
    face: FaceBounds,
    sceneWidth: number,
    sceneHeight: number,
    normalizedFaceSize?: number | null
  ) => {
    const targetAspect =
      sceneWidth > 0 && sceneHeight > 0 ? sceneWidth / sceneHeight : 1;
    const crop = buildFaceCropRect(
      face,
      sourceVideoSize?.width ?? 1920,
      sourceVideoSize?.height ?? 1080,
      targetAspect,
      normalizedFaceSize
    );
    const baseScale = Math.max(
      sceneWidth / (sourceVideoSize?.width ?? 1920),
      sceneHeight / (sourceVideoSize?.height ?? 1080)
    );
    const desiredScale =
      crop.width > 0 ? sceneWidth / crop.width : baseScale;
    const scaleRatio = baseScale > 0 ? desiredScale / baseScale : 1;
    const safeScale = Math.max(1, scaleRatio);
    const contentWidth =
      (sourceVideoSize?.width ?? 1920) * baseScale * safeScale;
    const contentHeight =
      (sourceVideoSize?.height ?? 1080) * baseScale * safeScale;
    const faceCx = face.cx * (sourceVideoSize?.width ?? 1920);
    const faceCy = face.cy * (sourceVideoSize?.height ?? 1080);
    const translateX =
      (baseScale * safeScale * ((sourceVideoSize?.width ?? 1920) / 2 - faceCx)) /
      sceneWidth;
    const translateY =
      (baseScale *
        safeScale *
        ((sourceVideoSize?.height ?? 1080) / 2 - faceCy)) /
      sceneHeight;
    const maxShiftX = Math.max(0, (contentWidth - sceneWidth) / (2 * sceneWidth));
    const maxShiftY = Math.max(
      0,
      (contentHeight - sceneHeight) / (2 * sceneHeight)
    );
    try {
      engine.block.resetCrop(clipId);
      engine.block.setCropScaleRatio(clipId, safeScale);
      engine.block.setCropTranslationX(
        clipId,
        clampValue(translateX, -maxShiftX, maxShiftX)
      );
      engine.block.setCropTranslationY(
        clipId,
        clampValue(translateY, -maxShiftY, maxShiftY)
      );
      return true;
    } catch (error) {
      console.warn("Failed to apply crop scale/translation", error);
      return false;
    }
  };

  const applySquareCropScaleTranslation = useCallback(
    (
      engine: CreativeEngineInstance,
      clipId: number,
      face: FaceBounds,
      sceneWidth: number,
      sceneHeight: number,
      sourceWidth: number,
      sourceHeight: number
    ) => {
      const resolveCropTarget = () => {
        if (engine.block.supportsCrop(clipId)) return clipId;
        try {
          const fillId = engine.block.getFill(clipId);
          if (fillId && engine.block.isValid(fillId)) {
            if (engine.block.supportsCrop(fillId)) return fillId;
          }
        } catch (error) {
          console.warn("Failed to resolve crop target for solo clip", error);
        }
        return null;
      };
      const cropTarget = resolveCropTarget();
      if (!cropTarget) return false;
      if (
        !Number.isFinite(sceneWidth) ||
        !Number.isFinite(sceneHeight) ||
        sceneWidth <= 0 ||
        sceneHeight <= 0 ||
        !Number.isFinite(sourceWidth) ||
        !Number.isFinite(sourceHeight) ||
        sourceWidth <= 0 ||
        sourceHeight <= 0
      ) {
        return false;
      }
      const region = buildFaceCropRegion(
        face,
        sourceWidth,
        sourceHeight,
        FACE_CROP_MAX_SIZE
      );
      const baseScale = Math.max(
        sceneWidth / sourceWidth,
        sceneHeight / sourceHeight
      );
      const desiredScale = Math.max(sceneWidth, sceneHeight) / region.size;
      const scaleRatio = baseScale > 0 ? desiredScale / baseScale : 1;
      const safeScale = Math.max(1, scaleRatio);
      const contentWidth = sourceWidth * baseScale * safeScale;
      const contentHeight = sourceHeight * baseScale * safeScale;
      const centerX = region.x + region.size / 2;
      const centerY = region.y + region.size / 2;
      const translateX =
        (baseScale * safeScale * (sourceWidth / 2 - centerX)) / sceneWidth;
      const translateY =
        (baseScale * safeScale * (sourceHeight / 2 - centerY)) / sceneHeight;
      const maxShiftX = Math.max(0, (contentWidth - sceneWidth) / (2 * sceneWidth));
      const maxShiftY = Math.max(
        0,
        (contentHeight - sceneHeight) / (2 * sceneHeight)
      );
      try {
        engine.block.resetCrop(cropTarget);
        engine.block.setCropScaleRatio(cropTarget, safeScale);
        engine.block.setCropTranslationX(
          cropTarget,
          clampValue(translateX, -maxShiftX, maxShiftX)
        );
        engine.block.setCropTranslationY(
          cropTarget,
          clampValue(translateY, -maxShiftY, maxShiftY)
        );
        return true;
      } catch (error) {
        console.warn("Failed to apply square crop translation", error);
        return false;
      }
    },
    []
  );

  const applyFaceCropByResizing = (
    engine: CreativeEngineInstance,
    clipId: number,
    face: FaceBounds,
    sceneWidth: number,
    sceneHeight: number,
    sourceWidth: number,
    sourceHeight: number,
    normalizedFaceSize?: number | null
  ) => {
    if (!engine.block.isValid(clipId)) return false;
    if (
      !Number.isFinite(sceneWidth) ||
      !Number.isFinite(sceneHeight) ||
      sceneWidth <= 0 ||
      sceneHeight <= 0
    ) {
      return false;
    }
    const targetAspect =
      sceneWidth > 0 && sceneHeight > 0 ? sceneWidth / sceneHeight : 1;
    const crop = buildFaceCropRect(
      face,
      sourceWidth,
      sourceHeight,
      targetAspect,
      normalizedFaceSize
    );
    if (
      !Number.isFinite(crop.width) ||
      !Number.isFinite(crop.height) ||
      crop.width <= 0 ||
      crop.height <= 0
    ) {
      return false;
    }
    const scale = Math.max(
      1,
      Math.max(sceneWidth / crop.width, sceneHeight / crop.height)
    );
    if (!Number.isFinite(scale) || scale <= 0) return false;
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const faceX = face.cx * sourceWidth * scale;
    const faceY = face.cy * sourceHeight * scale;
    const rawX = sceneWidth / 2 - faceX;
    const rawY = sceneHeight / 2 - faceY;
    const minX = sceneWidth - scaledWidth;
    const minY = sceneHeight - scaledHeight;
    const posX = clampValue(rawX, minX, 0);
    const posY = clampValue(rawY, minY, 0);
    try {
      engine.block.setSize(clipId, scaledWidth, scaledHeight);
      engine.block.setPosition(clipId, posX, posY);
      return true;
    } catch (error) {
      console.warn("Failed to resize clip for face crop", error);
      return false;
    }
  };

  const resetClipLayoutForScene = (
    engine: CreativeEngineInstance,
    clipId: number,
    sceneWidth: number,
    sceneHeight: number
  ) => {
    if (!engine.block.isValid(clipId)) return;
    const safeWidth =
      Number.isFinite(sceneWidth) && sceneWidth > 0 ? sceneWidth : 1;
    const safeHeight =
      Number.isFinite(sceneHeight) && sceneHeight > 0 ? sceneHeight : 1;
    try {
      engine.block.setSize(clipId, safeWidth, safeHeight);
      engine.block.setPosition(clipId, 0, 0);
    } catch (error) {
      console.warn("Failed to reset clip layout", error);
    }
    try {
      engine.block.resetCrop(clipId);
      engine.block.setCropScaleRatio(clipId, 1);
      engine.block.setCropTranslationX(clipId, 0);
      engine.block.setCropTranslationY(clipId, 0);
    } catch (error) {
      console.warn("Failed to reset clip crop", error);
    }
    try {
      const fillId = engine.block.getFill(clipId);
      if (fillId && engine.block.isValid(fillId)) {
        engine.block.resetCrop(fillId);
      }
    } catch (error) {
      console.warn("Failed to reset fill crop", error);
    }
  };

  const scaleClipToSceneCover = useCallback(
    (
      engine: CreativeEngineInstance,
      clipId: number,
      sceneWidth: number,
      sceneHeight: number,
      sourceWidth: number,
      sourceHeight: number
    ) => {
      if (!engine.block.isValid(clipId)) return false;
      if (
        !Number.isFinite(sceneWidth) ||
        !Number.isFinite(sceneHeight) ||
        sceneWidth <= 0 ||
        sceneHeight <= 0
      ) {
        return false;
      }
      const safeSourceWidth = sourceWidth > 0 ? sourceWidth : 1;
      const safeSourceHeight = sourceHeight > 0 ? sourceHeight : 1;
      const scale = Math.max(
        sceneWidth / safeSourceWidth,
        sceneHeight / safeSourceHeight
      );
      if (!Number.isFinite(scale) || scale <= 0) return false;
      const scaledWidth = safeSourceWidth * scale;
      const scaledHeight = safeSourceHeight * scale;
      const posX = (sceneWidth - scaledWidth) / 2;
      const posY = (sceneHeight - scaledHeight) / 2;
      try {
        engine.block.setSize(clipId, scaledWidth, scaledHeight);
        engine.block.setPosition(clipId, posX, posY);
        return true;
      } catch (error) {
        console.warn("Failed to scale clip to cover scene", error);
        return false;
      }
    },
    []
  );

  const buildFaceCropRegion = (
    face: FaceBounds,
    sourceWidth: number,
    sourceHeight: number,
    maxSize?: number
  ): FaceCropRegion => {
    const faceWidth = Math.max(1, (face.x1 - face.x0) * sourceWidth);
    const faceHeight = Math.max(1, (face.y1 - face.y0) * sourceHeight);
    const minDimension = Math.min(sourceWidth, sourceHeight);
    const baseSize = Math.max(faceWidth, faceHeight) * FACE_CROP_SCALE;
    const minSize = minDimension * FACE_CROP_MIN_RATIO;
    const cropSize = Math.min(minDimension, Math.max(baseSize, minSize));
    const resolvedMaxSize =
      typeof maxSize === "number" && Number.isFinite(maxSize) && maxSize > 0
        ? maxSize
        : Number.POSITIVE_INFINITY;
    const clampedSize = Math.min(cropSize, resolvedMaxSize);
    const safeSize = Number.isFinite(clampedSize) && clampedSize > 0 ? clampedSize : 1;
    const centerX = face.cx * sourceWidth;
    const centerY = face.cy * sourceHeight;
    const maxX = Math.max(0, sourceWidth - safeSize);
    const maxY = Math.max(0, sourceHeight - safeSize);
    return {
      size: safeSize,
      x: clampValue(centerX - safeSize / 2, 0, maxX),
      y: clampValue(centerY - safeSize / 2, 0, maxY),
    };
  };

  const applySquareCropByResizing = useCallback(
    (
      engine: CreativeEngineInstance,
      clipId: number,
      face: FaceBounds,
      sceneWidth: number,
      sceneHeight: number,
      sourceWidth: number,
      sourceHeight: number
    ) => {
      if (!engine.block.isValid(clipId)) return false;
      if (
        !Number.isFinite(sceneWidth) ||
        !Number.isFinite(sceneHeight) ||
        sceneWidth <= 0 ||
        sceneHeight <= 0
      ) {
        return false;
      }
      const region = buildFaceCropRegion(
        face,
        sourceWidth,
        sourceHeight,
        FACE_CROP_MAX_SIZE
      );
      if (!Number.isFinite(region.size) || region.size <= 0) {
        return false;
      }
      const minScale = Math.max(
        sceneWidth / sourceWidth,
        sceneHeight / sourceHeight
      );
      const squareScale = Math.max(
        sceneWidth / region.size,
        sceneHeight / region.size
      );
      const scale = Math.max(minScale, squareScale);
      if (!Number.isFinite(scale) || scale <= 0) return false;
      const scaledWidth = sourceWidth * scale;
      const scaledHeight = sourceHeight * scale;
      const centerX = (region.x + region.size / 2) * scale;
      const centerY = (region.y + region.size / 2) * scale;
      const rawX = sceneWidth / 2 - centerX;
      const rawY = sceneHeight / 2 - centerY;
      const minX = sceneWidth - scaledWidth;
      const minY = sceneHeight - scaledHeight;
      const posX = clampValue(rawX, minX, 0);
      const posY = clampValue(rawY, minY, 0);
      try {
        engine.block.setSize(clipId, scaledWidth, scaledHeight);
        engine.block.setPosition(clipId, posX, posY);
        return true;
      } catch (error) {
        console.warn("Failed to resize clip for square crop", error);
        return false;
      }
    },
    []
  );

  const computeNormalizedFaceSize = (
    faces: FaceBounds[],
    sourceWidth: number,
    sourceHeight: number
  ) => {
    if (!faces.length) return null;
    const sizes = faces
      .map((face) => {
        const faceWidth = Math.max(1, (face.x1 - face.x0) * sourceWidth);
        const faceHeight = Math.max(1, (face.y1 - face.y0) * sourceHeight);
        return Math.max(faceWidth, faceHeight);
      })
      .filter((size) => Number.isFinite(size) && size > 0)
      .sort((a, b) => a - b);
    if (!sizes.length) return null;
    const median = sizes[Math.floor(sizes.length / 2)];
    return Number.isFinite(median) && median > 0 ? median : null;
  };

  const buildFaceCropRect = (
    face: FaceBounds,
    sourceWidth: number,
    sourceHeight: number,
    targetAspect: number,
    normalizedFaceSize?: number | null
  ): FaceCropRect => {
    const faceWidth = Math.max(1, (face.x1 - face.x0) * sourceWidth);
    const faceHeight = Math.max(1, (face.y1 - face.y0) * sourceHeight);
    const faceSize = Math.max(faceWidth, faceHeight);
    const minDimension = Math.min(sourceWidth, sourceHeight);
    const minSize = minDimension * FACE_CROP_MIN_RATIO;
    const targetSize =
      typeof normalizedFaceSize === "number" && normalizedFaceSize > 0
        ? normalizedFaceSize
        : faceSize;
    const scaleFactor = clampValue(targetSize / faceSize, 0.75, 1.25);
    const baseSize = Math.max(faceSize * FACE_CROP_SCALE * scaleFactor, minSize);
    let cropWidth = baseSize;
    let cropHeight = baseSize;
    if (Number.isFinite(targetAspect) && targetAspect > 0) {
      if (targetAspect >= 1) {
        cropWidth = baseSize * targetAspect;
        cropHeight = baseSize;
      } else {
        cropWidth = baseSize;
        cropHeight = baseSize / targetAspect;
      }
    }
    if (cropWidth > sourceWidth) {
      const scale = sourceWidth / cropWidth;
      cropWidth *= scale;
      cropHeight *= scale;
    }
    if (cropHeight > sourceHeight) {
      const scale = sourceHeight / cropHeight;
      cropWidth *= scale;
      cropHeight *= scale;
    }
    const centerX = face.cx * sourceWidth;
    const centerY = face.cy * sourceHeight;
    const maxX = Math.max(0, sourceWidth - cropWidth);
    const maxY = Math.max(0, sourceHeight - cropHeight);
    return {
      width: cropWidth,
      height: cropHeight,
      x: clampValue(centerX - cropWidth / 2, 0, maxX),
      y: clampValue(centerY - cropHeight / 2, 0, maxY),
    };
  };

  const buildGridSlots = (
    area: LayoutSlot,
    count: number,
    columns: number,
    gap: number
  ) => {
    if (!count) return [];
    const safeColumns = Math.max(1, Math.min(columns, count));
    const rows = Math.max(1, Math.ceil(count / safeColumns));
    const totalGapX = gap * Math.max(0, safeColumns - 1);
    const totalGapY = gap * Math.max(0, rows - 1);
    const slotWidth = (area.width - totalGapX) / safeColumns;
    const slotHeight = (area.height - totalGapY) / rows;
    return Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / safeColumns);
      const col = index % safeColumns;
      return {
        x: area.x + col * (slotWidth + gap),
        y: area.y + row * (slotHeight + gap),
        width: slotWidth,
        height: slotHeight,
      };
    });
  };

  const buildTemplateLayout = (
    templateId: SpeakerTemplateId,
    sceneWidth: number,
    sceneHeight: number,
    speakerCount: number
  ) => {
    const thumbCount = Math.max(0, speakerCount - 1);
    const margin = Math.max(16, Math.min(sceneWidth, sceneHeight) * 0.04);
    const gap = Math.max(10, Math.min(sceneWidth, sceneHeight) * 0.03);

    if (templateId === "solo") {
      return {
        active: {
          x: 0,
          y: 0,
          width: sceneWidth,
          height: sceneHeight,
        },
        thumbs: [],
      };
    }

    if (templateId === "multi") {
      const thumbsHeight = sceneHeight * 0.26;
      const active: LayoutSlot = {
        x: margin,
        y: margin,
        width: Math.max(0, sceneWidth - margin * 2),
        height: Math.max(
          0,
          sceneHeight - margin * 2 - gap - thumbsHeight
        ),
      };
      const thumbsArea: LayoutSlot = {
        x: margin,
        y: active.y + active.height + gap,
        width: Math.max(0, sceneWidth - margin * 2),
        height: thumbsHeight,
      };
      const columns = Math.min(thumbCount, 3);
      return {
        active,
        thumbs: buildGridSlots(thumbsArea, thumbCount, columns || 1, gap * 0.6),
      };
    }

    if (templateId === "sidecar") {
      const thumbAreaWidth = sceneWidth * 0.22;
      const activeWidth = Math.max(
        sceneWidth - margin * 2 - gap - thumbAreaWidth,
        sceneWidth * 0.5
      );
      const active: LayoutSlot = {
        x: margin,
        y: margin,
        width: activeWidth,
        height: Math.max(0, sceneHeight - margin * 2),
      };
      const thumbsArea: LayoutSlot = {
        x: active.x + active.width + gap,
        y: margin,
        width: Math.max(0, sceneWidth - margin - (active.x + active.width + gap)),
        height: Math.max(0, sceneHeight - margin * 2),
      };
      const columns = thumbCount > 4 ? 2 : 1;
      return {
        active,
        thumbs: buildGridSlots(thumbsArea, thumbCount, columns, gap * 0.6),
      };
    }

    if (templateId === "overlay") {
      const thumbsHeight = sceneHeight * 0.22;
      const active: LayoutSlot = {
        x: margin,
        y: margin,
        width: Math.max(0, sceneWidth - margin * 2),
        height: Math.max(0, sceneHeight - margin * 2),
      };
      const thumbsArea: LayoutSlot = {
        x: margin,
        y: Math.max(
          margin,
          sceneHeight - margin - thumbsHeight
        ),
        width: Math.max(0, sceneWidth - margin * 2),
        height: thumbsHeight,
      };
      const columns = Math.min(thumbCount, 3);
      return {
        active,
        thumbs: buildGridSlots(thumbsArea, thumbCount, columns || 1, gap * 0.6),
      };
    }

    const thumbsHeight = sceneHeight * 0.22;
    const active: LayoutSlot = {
      x: margin,
      y: margin,
      width: Math.max(0, sceneWidth - margin * 2),
      height: Math.max(
        0,
        sceneHeight - margin * 2 - gap - thumbsHeight
      ),
    };
    const thumbsArea: LayoutSlot = {
      x: margin,
      y: active.y + active.height + gap,
      width: Math.max(0, sceneWidth - margin * 2),
      height: thumbsHeight,
    };
    const columns = Math.min(thumbCount, 3);
    return {
      active,
      thumbs: buildGridSlots(thumbsArea, thumbCount, columns || 1, gap * 0.6),
    };
  };

  const ensureFaceApiBackend = async (faceapi: FaceApiModule) => {
    try {
      await import("@tensorflow/tfjs-core/dist/kernels/backend_webgl");
      await import("@tensorflow/tfjs-core/dist/kernels/backend_cpu");
    } catch (error) {
      console.warn("[FaceCrop] Failed to load TensorFlow.js backends", error);
      return false;
    }
    const trySetBackend = async (name: "webgl" | "cpu") => {
      try {
        await faceapi.tf.setBackend(name);
        if (typeof faceapi.tf.ready === "function") {
          await faceapi.tf.ready();
        }
        if (typeof faceapi.tf.getBackend === "function") {
          return faceapi.tf.getBackend() === name;
        }
        return true;
      } catch (error) {
        console.warn(`[FaceCrop] Failed to set ${name} backend`, error);
        return false;
      }
    };
    const existingBackend =
      typeof faceapi.tf.getBackend === "function"
        ? faceapi.tf.getBackend()
        : null;
    if (existingBackend) {
      if (typeof faceapi.tf.ready === "function") {
        await faceapi.tf.ready();
      }
      return true;
    }
    let backendReady = await trySetBackend("webgl");
    if (!backendReady) {
      backendReady = await trySetBackend("cpu");
    }
    if (!backendReady) {
      console.warn(
        "[FaceCrop] No TensorFlow backend available; skipping smart crop."
      );
      return false;
    }
    return true;
  };

  const loadFaceModels = useCallback(async () => {
    if (faceModelsReadyRef.current) {
      return faceModelsReadyRef.current;
    }
    faceModelsReadyRef.current = (async () => {
      try {
        const faceapi = await import("face-api.js");
        faceApiRef.current = faceapi;
        const backendReady = await ensureFaceApiBackend(faceapi);
        if (!backendReady) {
          return false;
        }
        if (!faceapi.nets.tinyFaceDetector.isLoaded) {
          await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URI);
        }
        return true;
      } catch (error) {
        console.warn("Face detection unavailable; skipping smart crop.", error);
        return false;
      }
    })();
    return faceModelsReadyRef.current;
  }, []);

  const getClipSampleTime = (
    engine: CreativeEngineInstance,
    clipId: number
  ) => {
    let duration = 0;
    try {
      duration = engine.block.getDuration(clipId);
    } catch (error) {
      console.warn("Failed to read clip duration for face sampling", error);
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return 0;
    }
    return Math.min(0.1, duration * 0.25);
  };

  const positionClipForFace = useCallback(
    (
      engine: CreativeEngineInstance,
      clipId: number,
      faceCx: number,
      sceneWidth: number,
      sceneHeight: number
    ) => {
      if (!engine.block.isValid(clipId)) return;
      let blockWidth = 0;
      let blockHeight = 0;
      try {
        blockWidth = engine.block.getWidth(clipId);
        blockHeight = engine.block.getHeight(clipId);
      } catch (error) {
        console.warn("Failed to read clip size for face crop", error);
        return;
      }
      if (
        !Number.isFinite(blockWidth) ||
        !Number.isFinite(blockHeight) ||
        blockWidth <= sceneWidth
      ) {
        return;
      }
      const targetX = sceneWidth * 0.5 - faceCx * blockWidth;
      const minX = sceneWidth - blockWidth;
      const maxX = 0;
      const clampedX = Math.min(maxX, Math.max(minX, targetX));
      const posY = (sceneHeight - blockHeight) / 2;
      try {
        engine.block.setPosition(clipId, clampedX, posY);
      } catch (error) {
        console.warn("Failed to reposition clip for face crop", error);
      }
    },
    []
  );

  const positionClipCentered = useCallback(
    (
      engine: CreativeEngineInstance,
      clipId: number,
      sceneWidth: number,
      sceneHeight: number
    ) => {
      if (!engine.block.isValid(clipId)) return;
      let blockWidth = 0;
      let blockHeight = 0;
      try {
        blockWidth = engine.block.getWidth(clipId);
        blockHeight = engine.block.getHeight(clipId);
      } catch (error) {
        console.warn("Failed to read clip size for centering", error);
        return;
      }
      if (!Number.isFinite(blockWidth) || !Number.isFinite(blockHeight)) {
        return;
      }
      const posX = (sceneWidth - blockWidth) / 2;
      const posY = (sceneHeight - blockHeight) / 2;
      try {
        engine.block.setPosition(clipId, posX, posY);
      } catch (error) {
        console.warn("Failed to center clip position", error);
      }
    },
    []
  );

  const getPrimaryVideoBlock = (engine: CreativeEngineInstance) => {
    if (videoBlockRef.current && engine.block.isValid(videoBlockRef.current)) {
      return videoBlockRef.current;
    }
    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
      const children = engine.block.getChildren(videoTrackRef.current) ?? [];
      const candidate = children.find((child) => engine.block.isValid(child));
      if (candidate) return candidate;
    }
    return null;
  };

  const exportFaceThumbnail = async (
    engine: CreativeEngineInstance,
    pageId: number,
    clipId: number,
    atSeconds: number,
    face: FaceBounds
  ) => {
    if (!engine.block.isValid(pageId) || !engine.block.isValid(clipId)) {
      return null;
    }
    const playbackSupported = engine.block.supportsPlaybackTime(pageId);
    const previousPageWidth = engine.block.getWidth(pageId);
    const previousPageHeight = engine.block.getHeight(pageId);
    const previousClipWidth = engine.block.getWidth(clipId);
    const previousClipHeight = engine.block.getHeight(clipId);
    const previousClipX = engine.block.getPositionX(clipId);
    const previousClipY = engine.block.getPositionY(clipId);
    const previousPlaybackTime = playbackSupported
      ? engine.block.getPlaybackTime(pageId)
      : 0;
    const wasPlaying = playbackSupported ? engine.block.isPlaying(pageId) : false;
    try {
      if (playbackSupported) {
        engine.block.setPlaying(pageId, false);
        engine.block.setPlaybackTime(pageId, Math.max(0, atSeconds));
      }
      const crop = buildFaceCropRegion(
        face,
        previousClipWidth,
        previousClipHeight,
        FACE_CROP_MAX_SIZE
      );
      engine.block.setWidth(pageId, crop.size);
      engine.block.setHeight(pageId, crop.size);
      engine.block.setPosition(clipId, -crop.x, -crop.y);
      const exportSizes = [
        FACE_THUMBNAIL_EXPORT_SIZE,
        ...FACE_THUMBNAIL_EXPORT_FALLBACKS,
      ];
      let blob: Blob | null = null;
      let lastError: unknown = null;
      for (const size of exportSizes) {
        try {
          blob = await engine.block.generateThumbnailAtTimeOffset(
            size,
            Math.max(0, atSeconds)
          );
          if (blob?.size) break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!blob) {
        throw lastError instanceof Error
          ? lastError
          : new Error("Failed to export face thumbnail.");
      }
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        return URL.createObjectURL(blob);
      }
      return await blobToDataUrl(blob);
    } catch (error) {
      console.warn("Failed to export face thumbnail", error);
      return null;
    } finally {
      engine.block.setWidth(pageId, previousPageWidth);
      engine.block.setHeight(pageId, previousPageHeight);
      engine.block.setSize(clipId, previousClipWidth, previousClipHeight);
      engine.block.setPosition(clipId, previousClipX, previousClipY);
      if (playbackSupported) {
        engine.block.setPlaybackTime(pageId, previousPlaybackTime);
        engine.block.setPlaying(pageId, wasPlaying);
      }
    }
  };

  const detectFacesForClip = useCallback(
    async (
      engine: CreativeEngineInstance,
      clipId: number
    ): Promise<FaceBounds[]> => {
      if (!engine.block.isValid(clipId)) return [];
      const cached = faceCenterCacheRef.current.get(clipId);
      if (cached) return cached;
      const faceapi = faceApiRef.current;
      if (!faceapi) return [];
      try {
        try {
          const fillId = engine.block.getFill(clipId);
          if (fillId && engine.block.isValid(fillId)) {
            await engine.block.forceLoadAVResource(fillId);
          }
        } catch (error) {
          console.warn("Failed to load clip resource for face detection", error);
        }
        const duration = engine.block.getDuration(clipId);
        const samples = new Set<number>();
        const baseSample = getClipSampleTime(engine, clipId);
        samples.add(Math.max(0, baseSample));
        if (Number.isFinite(duration) && duration > 0.2) {
          samples.add(Math.min(duration * 0.5, Math.max(0, duration - 0.05)));
          samples.add(Math.min(duration * 0.8, Math.max(0, duration - 0.05)));
        }
        let faces: FaceBounds[] = [];
        for (const sampleTime of samples) {
          const frame = await grabFrame(engine, clipId, sampleTime);
          faces = await detectFacesInFrame(faceapi, frame);
          if (faces.length) break;
        }
        faceCenterCacheRef.current.set(clipId, faces);
        return faces;
      } catch (error) {
        console.warn("Failed to detect faces for clip", error);
        return [];
      }
    },
    []
  );

  const detectFaceForClip = useCallback(
    async (
      engine: CreativeEngineInstance,
      clipId: number,
      slotIndex?: number | null,
      fallbackFace?: FaceBounds | null
    ) => {
      if (!engine.block.isValid(clipId)) {
        return fallbackFace ?? null;
      }
      const selectClosestFace = (faces: FaceBounds[], targetCx: number) =>
        faces.reduce((best, face) => {
          const bestDistance = Math.abs(best.cx - targetCx);
          const nextDistance = Math.abs(face.cx - targetCx);
          return nextDistance < bestDistance ? face : best;
        }, faces[0]);
      const selectFace = (
        faces: FaceBounds[],
        desiredSlot?: number | null,
        fallback?: FaceBounds | null
      ) => {
        if (!faces.length) return fallback ?? null;
        const safeSlot =
          typeof desiredSlot === "number" && Number.isFinite(desiredSlot)
            ? Math.trunc(desiredSlot)
            : null;
        if (safeSlot !== null) {
          const orderedFaces = faces.slice().sort((a, b) => a.cx - b.cx);
          if (safeSlot >= 0 && safeSlot < orderedFaces.length) {
            return orderedFaces[safeSlot];
          }
          if (fallback) {
            return selectClosestFace(orderedFaces, fallback.cx);
          }
          const clamped = Math.min(
            Math.max(safeSlot, 0),
            orderedFaces.length - 1
          );
          return orderedFaces[clamped];
        }
        if (fallback) {
          return selectClosestFace(faces, fallback.cx);
        }
        return faces[0];
      };
      try {
        const faces = await detectFacesForClip(engine, clipId);
        if (!faces.length) return fallbackFace ?? null;
        return selectFace(faces, slotIndex, fallbackFace);
      } catch (error) {
        console.warn("Failed to detect face for clip", error);
        return fallbackFace ?? null;
      }
    },
    [detectFacesForClip]
  );

  const applyFaceAwareCropping = useCallback(
    async (
      clipIds?: number[],
      ratioOverrideId?: string,
      clipSpeakerMap?: Map<number, string | null>,
      speakerAssignments?: Record<string, number>,
      speakerFallbackFaces?: Map<string, FaceBounds>
    ) => {
      const engine = engineRef.current;
      const pageId = pageRef.current;
      const runId = (faceCropRunIdRef.current += 1);
      if (!engine || !pageId || !sourceVideoSize) {
        setIsFaceCropPending(false);
        return;
      }
      const sourceRatio = sourceVideoSize.width / sourceVideoSize.height;
      const ratioId = ratioOverrideId ?? targetAspectRatioId;
      const targetRatio = resolveAspectRatio(ratioId);
      if (!Number.isFinite(sourceRatio) || sourceRatio <= targetRatio) {
        setIsFaceCropPending(false);
        return;
      }
      setIsFaceCropPending(true);
      try {
        const modelsReady = await loadFaceModels();
        if (!modelsReady || runId !== faceCropRunIdRef.current) return;
        const sceneWidth = engine.block.getWidth(pageId);
        const sceneHeight = engine.block.getHeight(pageId);
        if (!Number.isFinite(sceneWidth) || !Number.isFinite(sceneHeight)) return;
        syncVideoLayoutToScene(
          engine,
          sceneWidth,
          sceneHeight,
          sourceVideoSize.width,
          sourceVideoSize.height
        );
        const ids =
          clipIds ??
          (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)
            ? engine.block.getChildren(videoTrackRef.current) ?? []
            : videoBlockRef.current && engine.block.isValid(videoBlockRef.current)
              ? [videoBlockRef.current]
              : []);
        for (const clipId of ids) {
          if (runId !== faceCropRunIdRef.current) return;
          if (!engine.block.isValid(clipId)) continue;
          const assignedSpeaker = clipSpeakerMap?.get(clipId) ?? null;
          const assignedSlot =
            assignedSpeaker && speakerAssignments
              ? speakerAssignments[assignedSpeaker]
              : null;
          const slotIndex =
            typeof assignedSlot === "number" && Number.isFinite(assignedSlot)
              ? assignedSlot
              : null;
          const fallbackFace = assignedSpeaker
            ? speakerFallbackFaces?.get(assignedSpeaker) ?? null
            : null;
          const face =
            fallbackFace ??
            (await detectFaceForClip(engine, clipId, slotIndex));
          if (runId !== faceCropRunIdRef.current) return;
          if (!engine.block.isValid(clipId)) continue;
          if (face) {
            positionClipForFace(
              engine,
              clipId,
              face.cx,
              sceneWidth,
              sceneHeight
            );
          } else {
            positionClipCentered(engine, clipId, sceneWidth, sceneHeight);
          }
        }
      } finally {
        if (runId === faceCropRunIdRef.current) {
          setIsFaceCropPending(false);
        }
      }
    },
    [detectFaceForClip, loadFaceModels, sourceVideoSize, targetAspectRatioId]
  );

  const ensureFaceOverlayTrack = useCallback(
    (engine: CreativeEngineInstance, index: number) => {
      const pageId = pageRef.current;
      if (!pageId || !engine.block.isValid(pageId)) return null;
      const existing = faceOverlayTrackIdsRef.current[index];
      if (existing && engine.block.isValid(existing)) {
        return existing;
      }
      try {
        const track = engine.block.create("track");
        engine.block.appendChild(pageId, track);
        try {
          engine.block.setBool(
            track,
            "track/automaticallyManageBlockOffsets",
            false
          );
        } catch (error) {
          console.warn("Failed to configure face overlay track", error);
        }
        faceOverlayTrackIdsRef.current[index] = track;
        return track;
      } catch (error) {
        console.warn("Failed to create face overlay track", error);
        faceOverlayTrackIdsRef.current[index] = 0;
        return null;
      }
    },
    []
  );

  const clearFaceOverlays = useCallback(
    (engineInstance?: CreativeEngineInstance | null) => {
      const engine = engineInstance ?? engineRef.current;
      if (!engine) return;
      faceOverlayIdsRef.current.forEach((blockId) => {
        if (engine.block.isValid(blockId)) {
          engine.block.destroy(blockId);
        }
      });
      faceOverlayIdsRef.current = [];
      if (faceOverlayTrackIdsRef.current.length) {
        faceOverlayTrackIdsRef.current.forEach((trackId) => {
          if (engine.block.isValid(trackId)) {
            engine.block.destroy(trackId);
          }
        });
      }
      faceOverlayTrackIdsRef.current = [];
    },
    []
  );

  const renderFaceOverlaysForClips = useCallback(
    async (clipIds: number[], runId: number) => {
      const engine = engineRef.current;
      const pageId = pageRef.current;
      if (!engine || !pageId || !sourceVideoSize) return;
      clearFaceOverlays(engine);
      const modelsReady = await loadFaceModels();
      if (!modelsReady || runId !== faceCropRunIdRef.current) return;
      let timeOffset = 0;
      for (const clipId of clipIds) {
        if (runId !== faceCropRunIdRef.current) return;
        if (!engine.block.isValid(clipId)) continue;
        let duration = 0;
        try {
          duration = engine.block.getDuration(clipId);
        } catch (error) {
          console.warn("Failed to read clip duration for overlays", error);
        }
        if (!Number.isFinite(duration) || duration <= 0) {
          continue;
        }
        const assignments = speakerAssignmentsRef.current;
        const speakerId = clipSpeakerMapRef.current.get(clipId) ?? null;
        const assignedSlot =
          speakerId && assignments ? assignments[speakerId] : null;
        const slotIndex =
          typeof assignedSlot === "number" && Number.isFinite(assignedSlot)
            ? assignedSlot
            : null;
        const fallbackFace = speakerId
          ? speakerAssignedThumbnails[speakerId]?.bounds ??
            (slotIndex !== null ? speakerFaceSlots[speakerId]?.[slotIndex] : null) ??
            null
          : null;
        const face = await detectFaceForClip(
          engine,
          clipId,
          slotIndex,
          fallbackFace
        );
        if (runId !== faceCropRunIdRef.current) return;
        if (!face) {
          timeOffset += duration;
          continue;
        }
        const trackId = ensureFaceOverlayTrack(engine, 0);
        if (!trackId) {
          timeOffset += duration;
          continue;
        }
        const color = FACE_OVERLAY_COLORS[0];
        let blockWidth = 0;
        let blockHeight = 0;
        let blockX = 0;
        let blockY = 0;
        try {
          blockWidth = engine.block.getWidth(clipId);
          blockHeight = engine.block.getHeight(clipId);
          blockX = engine.block.getPositionX(clipId);
          blockY = engine.block.getPositionY(clipId);
        } catch (error) {
          console.warn("Failed to read clip layout for overlays", error);
        }
        if (
          !Number.isFinite(blockWidth) ||
          !Number.isFinite(blockHeight) ||
          blockWidth <= 0 ||
          blockHeight <= 0
        ) {
          timeOffset += duration;
          continue;
        }
        const minDimension = Math.min(blockWidth, blockHeight);
        const fallbackSize = Math.max(1, minDimension * FACE_CROP_MIN_RATIO);
        const rawWidth = (face.x1 - face.x0) * blockWidth;
        const rawHeight = (face.y1 - face.y0) * blockHeight;
        const hasBounds =
          Number.isFinite(rawWidth) &&
          Number.isFinite(rawHeight) &&
          rawWidth > 1 &&
          rawHeight > 1;
        const baseWidth = hasBounds ? rawWidth : fallbackSize;
        const baseHeight = hasBounds ? rawHeight : fallbackSize;
        const width = Math.max(
          1,
          baseWidth * FACE_CROP_RECT_SCALE + FACE_CROP_RECT_EXTRA_WIDTH
        );
        const height = Math.max(
          1,
          baseHeight * FACE_CROP_RECT_SCALE + FACE_CROP_RECT_EXTRA_HEIGHT
        );
        const centerX = clampValue(face.cx, 0, 1) * blockWidth;
        const centerY = clampValue(face.cy, 0, 1) * blockHeight;
        const biasShift =
          (FACE_CROP_RECT_TOP_BIAS - 0.5) * FACE_CROP_RECT_EXTRA_HEIGHT;
        const rawX = centerX - width / 2;
        const rawY = centerY - height / 2 - biasShift;
        const maxX = Math.max(0, blockWidth - width);
        const maxY = Math.max(0, blockHeight - height);
        const posX = blockX + clampValue(rawX, 0, maxX);
        const posY = blockY + clampValue(rawY, 0, maxY);

        let overlayId = 0;
        try {
          overlayId = engine.block.create("graphic");
          engine.block.setShape(overlayId, engine.block.createShape("rect"));
          const fillId = engine.block.createFill("color");
          engine.block.setFill(overlayId, fillId);
          engine.block.setColor(fillId, "fill/color/value", color);
          engine.block.setSize(overlayId, width, height);
          engine.block.setPosition(overlayId, posX, posY);
          engine.block.setDuration(overlayId, duration);
          if (engine.block.supportsTimeOffset(overlayId)) {
            engine.block.setTimeOffset(overlayId, timeOffset);
          }
          engine.block.appendChild(trackId, overlayId);
          engine.block.setBool(overlayId, "includedInExport", false);
          engine.block.setBool(overlayId, "selectionEnabled", false);
          engine.block.setBool(overlayId, "transformLocked", true);
          try {
            if (engine.block.supportsStroke(overlayId)) {
              engine.block.setStrokeEnabled(overlayId, true);
              engine.block.setStrokeWidth(overlayId, 2);
              engine.block.setStrokeColor(overlayId, {
                r: color.r,
                g: color.g,
                b: color.b,
                a: 0.7,
              });
            }
          } catch (error) {
            console.warn("Failed to style overlay stroke", error);
          }
          try {
            engine.block.setAlwaysOnTop(overlayId, true);
          } catch (error) {
            console.warn("Failed to pin overlay on top", error);
          }
          disableBlockHighlight(engine, overlayId);
          faceOverlayIdsRef.current.push(overlayId);
        } catch (error) {
          console.warn("Failed to create face overlay", error);
          if (overlayId && engine.block.isValid(overlayId)) {
            engine.block.destroy(overlayId);
          }
        }
        timeOffset += duration;
      }
    },
    [
      clearFaceOverlays,
      detectFacesForClip,
      disableBlockHighlight,
      ensureFaceOverlayTrack,
      loadFaceModels,
      speakerAssignedThumbnails,
      primaryFaceSlots,
      speakerFaceSlots,
      sourceVideoSize,
    ]
  );

  const applySoloFaceCropping = useCallback(
    async (clipIds?: number[]) => {
      const engine = engineRef.current;
      const pageId = pageRef.current;
      const runId = (faceCropRunIdRef.current += 1);
      if (!engine || !pageId || !sourceVideoSize) {
        setIsFaceCropPending(false);
        return;
      }
      setIsFaceCropPending(true);
      try {
        const modelsReady = await loadFaceModels();
        if (!modelsReady || runId !== faceCropRunIdRef.current) return;
        const ids =
          clipIds ??
          (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)
            ? engine.block.getChildren(videoTrackRef.current) ?? []
            : baseClipIdsRef.current);
        const assignments = speakerAssignmentsRef.current;
        const fallbackSlotFaces = new Map<number, FaceBounds>();
        Object.values(speakerAssignedThumbnails).forEach((thumb) => {
          if (Number.isFinite(thumb.slotIndex)) {
            fallbackSlotFaces.set(thumb.slotIndex, thumb.bounds);
          }
        });
        primaryFaceSlots.forEach((face, index) => {
          if (!fallbackSlotFaces.has(index)) {
            fallbackSlotFaces.set(index, face);
          }
        });
        const fallbackFaces = new Map<string, FaceBounds>();
        Object.entries(assignments).forEach(([speakerId, slotIndex]) => {
          if (typeof slotIndex !== "number" || !Number.isFinite(slotIndex)) {
            return;
          }
          const face =
            fallbackSlotFaces.get(slotIndex) ??
            speakerFaceSlots[speakerId]?.[slotIndex] ??
            null;
          if (face) {
            fallbackFaces.set(speakerId, face);
          }
        });
        await renderFaceOverlaysForClips(ids, runId);
        for (const clipId of ids) {
          if (runId !== faceCropRunIdRef.current) return;
          if (!engine.block.isValid(clipId)) continue;
          let shapeId: number | null = null;
          try {
            engine.block.setClipped(clipId, true);
          } catch (error) {
            console.warn("Failed to enable clipping on solo clip", error);
          }
          try {
            if (engine.block.supportsShape(clipId)) {
              shapeId = engine.block.createShape("rect");
              engine.block.setShape(clipId, shapeId);
            }
          } catch (error) {
            console.warn("Failed to ensure solo clip shape", error);
          }
          if (runId !== faceCropRunIdRef.current) return;
          if (!engine.block.isValid(clipId)) continue;
          try {
            if (engine.block.supportsContentFillMode(clipId)) {
              engine.block.setContentFillMode(clipId, "Crop");
            }
          } catch (error) {
            console.warn("Failed to set solo clip fill mode", error);
          }
          try {
            const fillId = engine.block.getFill(clipId);
            if (
              fillId &&
              engine.block.isValid(fillId) &&
              engine.block.supportsContentFillMode(fillId)
            ) {
              engine.block.setContentFillMode(fillId, "Crop");
            }
          } catch (error) {
            console.warn("Failed to set solo fill mode", error);
          }
          try {
            engine.block.resetCrop(clipId);
            const fillId = engine.block.getFill(clipId);
            if (fillId && engine.block.isValid(fillId)) {
              engine.block.resetCrop(fillId);
            }
          } catch (error) {
            console.warn("Failed to reset solo crop before detection", error);
          }
          const speakerId = clipSpeakerMapRef.current.get(clipId) ?? null;
          const assignedSlot =
            speakerId && assignments ? assignments[speakerId] : null;
          const slotIndex =
            typeof assignedSlot === "number" && Number.isFinite(assignedSlot)
              ? assignedSlot
              : null;
          const fallbackFace = speakerId
            ? fallbackFaces.get(speakerId) ?? null
            : null;
          const face = await detectFaceForClip(
            engine,
            clipId,
            slotIndex,
            fallbackFace
          );
          if (runId !== faceCropRunIdRef.current) return;
          if (!engine.block.isValid(clipId)) continue;
          if (face) {
            let blockWidth = 0;
            let blockHeight = 0;
            try {
              blockWidth = engine.block.getWidth(clipId);
              blockHeight = engine.block.getHeight(clipId);
            } catch (error) {
              console.warn("Failed to read clip size for solo crop", error);
            }
            if (
              Number.isFinite(blockWidth) &&
              Number.isFinite(blockHeight) &&
              blockWidth > 0 &&
              blockHeight > 0
            ) {
              const cropRect = scaleCropRect(
                buildFacePixelCropRect(face, blockWidth, blockHeight),
                FACE_CROP_RECT_SCALE,
                blockWidth,
                blockHeight,
                FACE_CROP_RECT_EXTRA_WIDTH,
                FACE_CROP_RECT_EXTRA_HEIGHT,
                FACE_CROP_RECT_TOP_BIAS
              );
              const radius = clampValue(
                Math.min(cropRect.width, cropRect.height) *
                  FACE_CROP_CORNER_RADIUS_RATIO,
                FACE_CROP_CORNER_RADIUS_MIN,
                FACE_CROP_CORNER_RADIUS_MAX
              );
              const applied = applyRectCropScaleTranslation(
                engine,
                clipId,
                cropRect,
                { resizeToCrop: true }
              );
              if (shapeId || radius) {
                applyRoundedCorners(engine, shapeId ?? 0, clipId, radius);
              }
              if (!applied) {
                try {
                  engine.block.resetCrop(clipId);
                } catch (error) {
                  console.warn("Failed to reset solo crop state", error);
                }
              }
            }
          } else {
            try {
              engine.block.resetCrop(clipId);
              const fillId = engine.block.getFill(clipId);
              if (fillId && engine.block.isValid(fillId)) {
                engine.block.resetCrop(fillId);
              }
            } catch (error) {
              console.warn("Failed to reset solo crop state", error);
            }
          }
        }
      } finally {
        if (runId === faceCropRunIdRef.current) {
          setIsFaceCropPending(false);
        }
      }
    },
    [
      detectFaceForClip,
      loadFaceModels,
      primaryFaceSlots,
      renderFaceOverlaysForClips,
      speakerAssignedThumbnails,
      speakerFaceSlots,
      sourceVideoSize,
    ]
  );

  const setBaseClipVisibility = (
    engine: CreativeEngineInstance,
    visible: boolean
  ) => {
    baseClipIdsRef.current.forEach((clipId) => {
      if (!engine.block.isValid(clipId)) return;
      try {
        engine.block.setVisible(clipId, visible);
      } catch (error) {
        console.warn("Failed to toggle clip visibility", error);
      }
    });
  };

  const clearTemplateLayout = useCallback(
    (
      engineInstance?: CreativeEngineInstance | null,
      options?: { showBase?: boolean; restoreTrack?: boolean }
    ) => {
      const engine = engineInstance ?? engineRef.current;
      if (!engine) return;
      clearFaceOverlays(engine);
      templateClipIdsRef.current.forEach((clipId) => {
        if (engine.block.isValid(clipId)) {
          engine.block.destroy(clipId);
        }
      });
      templateClipIdsRef.current = [];
      templateGroupIdsRef.current.forEach((groupId) => {
        if (engine.block.isValid(groupId)) {
          engine.block.destroy(groupId);
        }
      });
      templateGroupIdsRef.current = [];
      if (options?.showBase ?? true) {
        setBaseClipVisibility(engine, true);
      }
      const shouldRestoreTrack = options?.restoreTrack ?? true;
      const pageId = pageRef.current;
      const trackId = videoTrackRef.current;
      if (
        shouldRestoreTrack &&
        trackId &&
        engine.block.isValid(trackId)
      ) {
        setVideoTrackAutoManage(engine, trackId, true);
        if (pageId && engine.block.isValid(pageId)) {
          try {
            engine.block.setDuration(trackId, engine.block.getDuration(pageId));
          } catch (error) {
            console.warn("Failed to reset track duration", error);
          }
        }
      }
    },
    [clearFaceOverlays]
  );

  const resolveSpeakerFaces = (
    speakerIds: string[],
    assignments: Record<string, number>
  ) => {
    const fallback = primaryFaceSlots;
    const assignmentMap = buildSpeakerAssignments(
      assignments,
      speakerFaceSlots,
      fallback
    );
    const resolved = new Map<string, FaceBounds>();
    speakerIds.forEach((speakerId) => {
      const assignment = assignmentMap.get(speakerId);
      if (assignment) {
        resolved.set(speakerId, assignment);
        return;
      }
      const candidate = speakerFaceSlots[speakerId]?.[0] ?? fallback[0];
      if (candidate) {
        resolved.set(speakerId, candidate);
      }
    });
    return resolved;
  };

  const resolveTemplateFaces = (
    speakerIds: string[],
    assignments: Record<string, number>
  ) => {
    const resolved = new Map<string, FaceBounds>();
    const slotFaces = new Map<number, FaceBounds>();
    Object.values(speakerAssignedThumbnails).forEach((thumb) => {
      if (Number.isFinite(thumb.slotIndex)) {
        slotFaces.set(thumb.slotIndex, thumb.bounds);
      }
    });
    primaryFaceSlots.forEach((face, index) => {
      if (!slotFaces.has(index)) {
        slotFaces.set(index, face);
      }
    });
    speakerIds.forEach((speakerId) => {
      const slotIndex = assignments[speakerId];
      if (typeof slotIndex !== "number" || !Number.isFinite(slotIndex)) return;
      const resolvedSlot =
        slotFaces.get(slotIndex) ??
        speakerFaceSlots[speakerId]?.[slotIndex] ??
        null;
      if (resolvedSlot) {
        resolved.set(speakerId, resolvedSlot);
      }
    });
    return resolved;
  };

  const getTemplateSpeakerIds = (assignments: Record<string, number>) => {
    const ordered = speakerSnippetsRef.current.map((snippet) => snippet.id);
    const assignedIds = Object.keys(assignments);
    if (!assignedIds.length) return ordered;
    const extras = assignedIds.filter((id) => !ordered.includes(id));
    return ordered.concat(extras);
  };

  const canApplySpeakerTemplate = () => {
    const speakers = speakerSnippetsRef.current;
    if (speakers.length < 2) return false;
    const uniqueSlots = new Set(
      Object.values(speakerAssignmentsRef.current).filter(
        (slot) => typeof slot === "number" && Number.isFinite(slot)
      )
    );
    return uniqueSlots.size > 1;
  };

  const applySpeakerTemplate = useCallback(
    async (templateId: SpeakerTemplateId) => {
      const engine = engineRef.current;
      const pageId = pageRef.current;
      if (!engine || !pageId || !sourceVideoSize) return;
      if (templateId === "none") return;
      const assignments = speakerAssignmentsRef.current;
      const speakerIds = getTemplateSpeakerIds(assignments);
      if (speakerIds.length < 2) return;
      const uniqueSlots = new Set(
        Object.values(assignments).filter(
          (slot) => typeof slot === "number" && Number.isFinite(slot)
        )
      );
      if (uniqueSlots.size < 2) return;
      const clipRanges = clipRangesRef.current;
      const baseClipIds = baseClipIdsRef.current;
      if (!clipRanges.length || !baseClipIds.length) return;

      const templateSource =
        (videoTemplateRef.current &&
          engine.block.isValid(videoTemplateRef.current) &&
          videoTemplateRef.current) ||
        (baseClipIds[0] && engine.block.isValid(baseClipIds[0])
          ? baseClipIds[0]
          : null);
      if (!templateSource) return;

      clearTemplateLayout(engine, { showBase: true });

      const sceneWidth = engine.block.getWidth(pageId);
      const sceneHeight = engine.block.getHeight(pageId);
      if (!Number.isFinite(sceneWidth) || !Number.isFinite(sceneHeight)) return;
      const layout = buildTemplateLayout(
        templateId,
        sceneWidth,
        sceneHeight,
        speakerIds.length
      );
      const faceMap = resolveTemplateFaces(speakerIds, assignments);
      const normalizedFaceSize = computeNormalizedFaceSize(
        Array.from(faceMap.values()),
        sourceVideoSize.width,
        sourceVideoSize.height
      );
      const totalDuration = clipRanges.reduce(
        (sum, range) => sum + (range.end - range.start),
        0
      );
      const createTemplateTrack = () => {
        let trackId: number;
        try {
          trackId = engine.block.create("track");
        } catch (error) {
          console.warn("Failed to create template track", error);
          return null;
        }
        engine.block.appendChild(pageId, trackId);
        setVideoTrackAutoManage(engine, trackId, true);
        if (Number.isFinite(totalDuration) && totalDuration > 0) {
          try {
            engine.block.setDuration(trackId, totalDuration);
          } catch (error) {
            console.warn("Failed to set template track duration", error);
          }
        }
        templateGroupIdsRef.current.push(trackId);
        return trackId;
      };
      const activeTrack = createTemplateTrack();
      if (!activeTrack) return;
      const thumbTracks = layout.thumbs
        .map(() => createTemplateTrack())
        .filter((trackId): trackId is number => typeof trackId === "number");
      if (thumbTracks.length !== layout.thumbs.length) {
        clearTemplateLayout(engine);
        return;
      }
      const slotTracks = [activeTrack, ...thumbTracks];
      const slotLayouts = [layout.active, ...layout.thumbs];

      if (templateId === "multi") {
        const trackBySpeaker = new Map<string, number>();
        speakerIds.forEach((speakerId, index) => {
          const trackId = index === 0 ? activeTrack : thumbTracks[index - 1];
          if (trackId) {
            trackBySpeaker.set(speakerId, trackId);
          }
        });
        if (trackBySpeaker.size !== speakerIds.length) {
          clearTemplateLayout(engine);
          return;
        }
        let createdClips = 0;
        for (let index = 0; index < clipRanges.length; index += 1) {
          const range = clipRanges[index];
          const duration = range.end - range.start;
          if (!Number.isFinite(duration) || duration <= 0.01) continue;
          const baseClipId = baseClipIds[index];
          const activeSpeakerId =
            (baseClipId &&
              clipSpeakerMapRef.current.get(baseClipId)) ||
            speakerIds[0] ||
            null;
          const resolvedActiveSpeakerId =
            activeSpeakerId && speakerIds.includes(activeSpeakerId)
              ? activeSpeakerId
              : speakerIds[0] ?? null;
          if (!resolvedActiveSpeakerId) continue;
          const orderedThumbs = speakerIds.filter(
            (speakerId) => speakerId !== resolvedActiveSpeakerId
          );
          const slotSpeakerIds = [resolvedActiveSpeakerId, ...orderedThumbs];

          for (const speakerId of speakerIds) {
            const trackId = trackBySpeaker.get(speakerId);
            if (!trackId) continue;
            const slotIndex = slotSpeakerIds.indexOf(speakerId);
            const slot = slotLayouts[slotIndex];
            if (!slot) continue;

            let clip: number;
            try {
              clip = engine.block.duplicate(templateSource, false);
            } catch (error) {
              console.warn("Failed to duplicate template clip", error);
              continue;
            }
            disableBlockHighlight(engine, clip);
            const parent = engine.block.getParent(clip);
            if (parent && engine.block.isValid(parent)) {
              try {
                engine.block.removeChild(parent, clip);
              } catch (detachError) {
                console.warn("Failed to detach duplicated clip", detachError);
              }
            }
            const clipFill = engine.block.getFill(clip);
            if (clipFill) {
              engine.block.setTrimOffset(clipFill, range.start);
              engine.block.setTrimLength(clipFill, duration);
            }
            engine.block.setDuration(clip, duration);

            try {
              engine.block.setClipped(clip, true);
            } catch (error) {
              console.warn("Failed to enable clip cropping", error);
            }
            let shapeId: number | null = null;
            try {
              if (engine.block.supportsShape(clip)) {
                shapeId = engine.block.createShape("rect");
                engine.block.setShape(clip, shapeId);
              }
            } catch (error) {
              console.warn("Failed to set template clip shape", error);
            }
            try {
              if (engine.block.supportsContentFillMode(clip)) {
                engine.block.setContentFillMode(clip, "Crop");
              }
              if (clipFill && engine.block.supportsContentFillMode(clipFill)) {
                engine.block.setContentFillMode(clipFill, "Crop");
              }
            } catch (error) {
              console.warn("Failed to set content fill mode", error);
            }

            const face = faceMap.get(speakerId);
            const assignedSlotIndex = assignments[speakerId];
            const slotIndexHint =
              typeof assignedSlotIndex === "number" &&
              Number.isFinite(assignedSlotIndex)
                ? assignedSlotIndex
                : null;
            let resolvedFace = face ?? null;
            if (
              baseClipId &&
              engine.block.isValid(baseClipId) &&
              slotIndexHint !== null
            ) {
              resolvedFace = await detectFaceForClip(
                engine,
                baseClipId,
                slotIndexHint,
                resolvedFace
              );
            }
            if (resolvedFace) {
              let sourceWidth = 0;
              let sourceHeight = 0;
              try {
                sourceWidth = engine.block.getWidth(clip);
                sourceHeight = engine.block.getHeight(clip);
              } catch (error) {
                console.warn("Failed to read template clip size", error);
              }
              const cropRect = scaleCropRect(
                buildFacePixelCropRect(
                  resolvedFace,
                  sourceWidth,
                  sourceHeight
                ),
                FACE_CROP_RECT_SCALE,
                sourceWidth,
                sourceHeight,
                FACE_CROP_RECT_EXTRA_WIDTH,
                FACE_CROP_RECT_EXTRA_HEIGHT,
                FACE_CROP_RECT_TOP_BIAS
              );
              const applied = applyRectCropScaleTranslation(
                engine,
                clip,
                cropRect,
                { resizeToCrop: true }
              );
              const radius = clampValue(
                Math.min(slot.width, slot.height) *
                  FACE_CROP_CORNER_RADIUS_RATIO,
                FACE_CROP_CORNER_RADIUS_MIN,
                FACE_CROP_CORNER_RADIUS_MAX
              );
              if (shapeId || radius) {
                applyRoundedCorners(engine, shapeId ?? 0, clip, radius);
              }
              if (!applied) {
                try {
                  engine.block.resetCrop(clip);
                } catch (error) {
                  console.warn("Failed to reset template crop", error);
                }
              }
            } else {
              try {
                engine.block.resetCrop(clip);
              } catch (error) {
                console.warn("Failed to reset template crop", error);
              }
            }

            let clipWidth = 0;
            let clipHeight = 0;
            try {
              clipWidth = engine.block.getWidth(clip);
              clipHeight = engine.block.getHeight(clip);
            } catch (error) {
              console.warn("Failed to read cropped clip size", error);
            }
            if (
              Number.isFinite(clipWidth) &&
              Number.isFinite(clipHeight) &&
              clipWidth > 0 &&
              clipHeight > 0 &&
              Number.isFinite(slot.width) &&
              Number.isFinite(slot.height) &&
              slot.width > 0 &&
              slot.height > 0
            ) {
              const scale = Math.min(
                slot.width / clipWidth,
                slot.height / clipHeight
              );
              const scaledWidth = clipWidth * scale;
              const scaledHeight = clipHeight * scale;
              const posX = slot.x + (slot.width - scaledWidth) / 2;
              const posY = slot.y + (slot.height - scaledHeight) / 2;
              try {
                engine.block.setSize(clip, scaledWidth, scaledHeight);
                engine.block.setPosition(clip, posX, posY);
              } catch (error) {
                console.warn("Failed to position template clip", error);
              }
            }

            engine.block.appendChild(trackId, clip);
            templateClipIdsRef.current.push(clip);
            if (createdClips === 0) {
              setBaseClipVisibility(engine, false);
            }
            createdClips += 1;
          }
        }

        if (createdClips === 0) {
          clearTemplateLayout(engine);
        }
        return;
      }

      let createdClips = 0;
      for (let index = 0; index < clipRanges.length; index += 1) {
        const range = clipRanges[index];
        const duration = range.end - range.start;
        if (!Number.isFinite(duration) || duration <= 0.01) continue;
        const baseClipId = baseClipIds[index];
        const activeSpeakerId =
          (baseClipId &&
            clipSpeakerMapRef.current.get(baseClipId)) ||
          speakerIds[0] ||
          null;
        const resolvedActiveSpeakerId =
          activeSpeakerId && speakerIds.includes(activeSpeakerId)
            ? activeSpeakerId
            : speakerIds[0] ?? null;
        if (!resolvedActiveSpeakerId) continue;
        const thumbSpeakerIds = speakerIds.filter(
          (speakerId) => speakerId !== resolvedActiveSpeakerId
        );
        const slotSpeakerIds = [resolvedActiveSpeakerId, ...thumbSpeakerIds];

        for (let slotIndex = 0; slotIndex < slotTracks.length; slotIndex += 1) {
          const trackId = slotTracks[slotIndex];
          const slot = slotLayouts[slotIndex];
          const speakerId = slotSpeakerIds[slotIndex] ?? null;
          if (!slot) continue;
          if (!speakerId) continue;

          let clip: number;
          try {
            clip = engine.block.duplicate(templateSource, false);
          } catch (error) {
            console.warn("Failed to duplicate template clip", error);
            continue;
          }
          disableBlockHighlight(engine, clip);
          const parent = engine.block.getParent(clip);
          if (parent && engine.block.isValid(parent)) {
            try {
              engine.block.removeChild(parent, clip);
            } catch (detachError) {
              console.warn("Failed to detach duplicated clip", detachError);
            }
          }
          const clipFill = engine.block.getFill(clip);
          if (clipFill) {
            engine.block.setTrimOffset(clipFill, range.start);
            engine.block.setTrimLength(clipFill, duration);
          }
          engine.block.setDuration(clip, duration);

          engine.block.setSize(clip, slot.width, slot.height);
          engine.block.setPosition(clip, slot.x, slot.y);
          try {
            engine.block.setClipped(clip, true);
          } catch (error) {
            console.warn("Failed to enable clip cropping", error);
          }
          try {
            if (engine.block.supportsContentFillMode(clip)) {
              engine.block.setContentFillMode(clip, "Cover");
            }
          } catch (error) {
            console.warn("Failed to set content fill mode", error);
          }

          const face = faceMap.get(speakerId);
          const assignedSlotIndex = assignments[speakerId];
          const slotIndexHint =
            typeof assignedSlotIndex === "number" && Number.isFinite(assignedSlotIndex)
              ? assignedSlotIndex
              : null;
          let resolvedFace = face ?? null;
          if (
            baseClipId &&
            engine.block.isValid(baseClipId) &&
            slotIndexHint !== null
          ) {
            resolvedFace = await detectFaceForClip(
              engine,
              baseClipId,
              slotIndexHint,
              resolvedFace
            );
          }
          if (resolvedFace) {
            const targetAspect =
              slot.width > 0 && slot.height > 0
                ? slot.width / slot.height
                : 1;
            const crop = buildFaceCropRect(
              resolvedFace,
              sourceVideoSize.width,
              sourceVideoSize.height,
              targetAspect,
              normalizedFaceSize
            );
            const normalizedCrop = normalizeCropRect(
              crop,
              sourceVideoSize.width,
              sourceVideoSize.height
            );
            if (
              !normalizedCrop ||
              !applyNormalizedCrop(engine, clip, normalizedCrop)
            ) {
              const baseScale = Math.max(
                slot.width / sourceVideoSize.width,
                slot.height / sourceVideoSize.height
              );
              const desiredScale =
                crop.width > 0 ? slot.width / crop.width : baseScale;
              const scaleRatio =
                baseScale > 0 ? desiredScale / baseScale : 1;
              const safeScale = Math.max(1, scaleRatio);
              const contentWidth =
                sourceVideoSize.width * baseScale * safeScale;
              const contentHeight =
                sourceVideoSize.height * baseScale * safeScale;
            const faceCx = resolvedFace.cx * sourceVideoSize.width;
            const faceCy = resolvedFace.cy * sourceVideoSize.height;
            const translateX =
              (baseScale * safeScale * (sourceVideoSize.width / 2 - faceCx)) /
              slot.width;
            const translateY =
              (baseScale * safeScale * (sourceVideoSize.height / 2 - faceCy)) /
              slot.height;
              const maxShiftX = Math.max(
                0,
                (contentWidth - slot.width) / (2 * slot.width)
              );
              const maxShiftY = Math.max(
                0,
                (contentHeight - slot.height) / (2 * slot.height)
              );
              if (engine.block.supportsCrop(clip)) {
                try {
                  engine.block.resetCrop(clip);
                  engine.block.setCropScaleRatio(clip, safeScale);
                  engine.block.setCropTranslationX(
                    clip,
                    clampValue(translateX, -maxShiftX, maxShiftX)
                  );
                  engine.block.setCropTranslationY(
                    clip,
                    clampValue(translateY, -maxShiftY, maxShiftY)
                  );
                } catch (cropError) {
                  console.warn("Failed to apply face crop to clip", cropError);
                }
              }
            }
          } else if (engine.block.supportsCrop(clip)) {
            try {
              const fullCrop = applyNormalizedCrop(engine, clip, {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
              });
              if (!fullCrop) {
                engine.block.resetCrop(clip);
              }
            } catch (cropError) {
              console.warn("Failed to reset crop", cropError);
            }
          }

          engine.block.appendChild(trackId, clip);
          templateClipIdsRef.current.push(clip);
          if (createdClips === 0) {
            setBaseClipVisibility(engine, false);
          }
          createdClips += 1;
        }
      }

      if (createdClips === 0) {
        clearTemplateLayout(engine);
      }
    },
    [
      clearTemplateLayout,
      disableBlockHighlight,
      primaryFaceSlots,
      speakerFaceSlots,
      sourceVideoSize,
    ]
  );

  const preloadSpeakerFaces = async (snippets: SpeakerSnippet[]) => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId || !snippets.length) return null;
    const clipId = getPrimaryVideoBlock(engine);
    if (!clipId) return null;

    const runId = preloadRunIdRef.current;
    const faceSlotsBySpeaker: Record<string, FaceBounds[]> = {};
    const thumbnails: SpeakerFaceThumbnail[] = [];
    const cleanupThumbnails = () => revokeSpeakerThumbnailUrls(thumbnails);
    let primarySpeakerId: string | null = null;
    let maxFaces = 0;
    console.info("[Speaker Debug] Preload faces start", {
      speakers: snippets.map((snippet) => snippet.id),
    });

    const modelsReady = await loadFaceModels();
    if (!modelsReady || runId !== preloadRunIdRef.current) {
      cleanupThumbnails();
      return null;
    }
    const faceapi = faceApiRef.current;
    if (!faceapi) {
      cleanupThumbnails();
      return null;
    }

    const clipFill = engine.block.getFill(clipId);
    if (clipFill) {
      try {
        await engine.block.forceLoadAVResource(clipFill);
      } catch (error) {
        console.warn("Failed to preload video resource for thumbnails", error);
      }
    }

    for (const snippet of snippets) {
      if (runId !== preloadRunIdRef.current) {
        cleanupThumbnails();
        return null;
      }
      let faces: FaceBounds[] = [];
      const sampleTimes: number[] = [];
      if (Number.isFinite(snippet.start)) {
        sampleTimes.push(snippet.start);
      }
      const midpoint =
        Number.isFinite(snippet.start) && Number.isFinite(snippet.end)
          ? (snippet.start + snippet.end) / 2
          : snippet.start + 0.5;
      if (
        Number.isFinite(midpoint) &&
        Math.abs(midpoint - snippet.start) > 0.05
      ) {
        sampleTimes.push(midpoint);
      }
      if (!sampleTimes.length) {
        sampleTimes.push(0);
      }
      for (let i = 0; i < sampleTimes.length; i += 1) {
        try {
          const frame = await grabFrame(engine, clipId, sampleTimes[i]);
          faces = await detectFacesInFrame(faceapi, frame);
          if (faces.length) break;
        } catch (error) {
          console.warn("Failed to sample speaker frame for faces", error);
        }
      }
      const orderedFaces = faces.slice().sort((a, b) => a.cx - b.cx);
      console.info("[Speaker Debug] Faces detected", {
        speakerId: snippet.id,
        label: snippet.label,
        start: snippet.start,
        end: snippet.end,
        faces: orderedFaces.length,
      });
      faceSlotsBySpeaker[snippet.id] = orderedFaces;
      if (orderedFaces.length > maxFaces) {
        maxFaces = orderedFaces.length;
        primarySpeakerId = snippet.id;
      }
      for (const [faceIndex, face] of orderedFaces.entries()) {
        if (runId !== preloadRunIdRef.current) {
          cleanupThumbnails();
          return null;
        }
        const src = await exportFaceThumbnail(
          engine,
          pageId,
          clipId,
          snippet.start,
          face
        );
        if (!src) continue;
        thumbnails.push({
          id: `${snippet.id}-${faceIndex}-${snippet.start}`,
          speakerId: snippet.id,
          speakerLabel: snippet.label,
          start: snippet.start,
          end: snippet.end,
          slotIndex: faceIndex,
          bounds: face,
          src,
        });
      }
    }

    const thumbnailCounts = thumbnails.reduce<Record<string, number>>(
      (acc, thumb) => {
        acc[thumb.speakerId] = (acc[thumb.speakerId] ?? 0) + 1;
        return acc;
      },
      {}
    );
    console.info("[Speaker Debug] Preload faces summary", {
      primarySpeakerId,
      thumbnailCounts,
    });
    return {
      faceSlotsBySpeaker,
      thumbnails,
      primarySpeakerId,
      maxFaces,
    };
  };

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const engine = engineRef.current;
      const pageId = pageRef.current;
      if (
        engine &&
        pageId &&
        !isScrubbingTimeline &&
        engine.block.supportsPlaybackTime(pageId)
      ) {
        try {
          const time = engine.block.getPlaybackTime(pageId);
          if (Number.isFinite(time)) {
            setTimelinePosition(time);
            const playing = engine.block.isPlaying(pageId);
            setIsPlaying(playing);
          }
        } catch (error) {
          console.warn("Failed to read playback time", error);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isScrubbingTimeline]);

  useEffect(() => {
    if (autoProcessStatuses.analysis !== "active") {
      setAnalysisStage(null);
      setAnalysisStartAt(null);
      return;
    }
    setAnalysisStartAt(Date.now());
    setAnalysisStage("Queued");
  }, [autoProcessStatuses.analysis]);

  useEffect(() => {
    if (autoProcessStatuses.analysis !== "active" || analysisStartAt === null) {
      return;
    }
    const totalMs =
      (analysisEstimate?.maxSeconds ?? DEFAULT_ANALYSIS_SECONDS) * 1000;
    const updateStage = () => {
      const elapsed = Date.now() - analysisStartAt;
      const ratio = totalMs > 0 ? elapsed / totalMs : 0;
      let stage = "AI Shortening Transcript";
      if (ratio < 0.1) {
        stage = "Queued";
      } else if (ratio < 0.25) {
        stage = "Sending transcript";
      } else if (ratio < 0.6) {
        stage = "AI Reading Transcript";
      }
      setAnalysisStage((prev) => (prev === stage ? prev : stage));
    };
    updateStage();
    const interval = window.setInterval(updateStage, 500);
    return () => window.clearInterval(interval);
  }, [autoProcessStatuses.analysis, analysisEstimate?.maxSeconds, analysisStartAt]);

  const targetAspectRatio = resolveAspectRatio(targetAspectRatioId);

  const loadVideoFile = async (file: File) => {
    if (!engineRef.current) return;

    setVideoFile(file);
    resetWorkflowState();
    resetPreloadState();
    setTimelinePosition(0);
    setIsPlaying(false);
    setTimelineSegments([]);
    setIsScrubbingTimeline(false);
    setCurrentTranscriptWords([]);
    setSourceVideoDuration(0);
    setSourceVideoSize(null);
    setAnalysisEstimate(null);
    setAnalysisStage(null);
    setAnalysisStartAt(null);
    setIsFaceCropPending(false);
    setCaptionsEnabled(true);
    setTextHookEnabled(true);
    setTranscriptDebug(null);
    setGeminiDebug(null);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setDebugExportMetrics(null);
    setCaptionDebug(null);
    setIsDebugOpen(false);
    setIsFaceDebugLoading(false);
    setProgress(0);
    setIsExporting(false);
    setExportError(null);
    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;
    textHookTextRef.current = null;
    textHookDurationRef.current = HOOK_DURATION_SECONDS;
    const existingEngine = engineRef.current;
    captionStyleAppliedRef.current = false;
    captionPresetAppliedRef.current = false;

    const engine = existingEngine;

    if (audioBlockRef.current) {
      engine.block.destroy(audioBlockRef.current);
      audioBlockRef.current = null;
    }
    if (videoBlockRef.current) {
      engine.block.destroy(videoBlockRef.current);
      videoBlockRef.current = null;
    }
    if (videoTemplateRef.current && engine.block.isValid(videoTemplateRef.current)) {
      engine.block.destroy(videoTemplateRef.current);
      videoTemplateRef.current = null;
    }
    if (captionsTrackRef.current && engine.block.isValid(captionsTrackRef.current)) {
      engine.block.destroy(captionsTrackRef.current);
      captionsTrackRef.current = null;
    }
    if (textHookBlockRef.current && engine.block.isValid(textHookBlockRef.current)) {
      engine.block.destroy(textHookBlockRef.current);
      textHookBlockRef.current = null;
    }
    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
      const existingChildren = engine.block.getChildren(videoTrackRef.current) ?? [];
      existingChildren.forEach((child) => {
        if (engine.block.isValid(child)) {
          engine.block.destroy(child);
        }
      });
      videoTrackRef.current = null;
    }

    const blobUrl = URL.createObjectURL(file);
    const opfs = await navigator.storage.estimate();
    const directory = await navigator.storage.getDirectory();
    const opfsFile = await directory.getFileHandle(file.name, { create: true });
    const stream = await opfsFile.createWritable();
    await stream.write(file);
    await stream.close();

    const videoURL = "opfs://" + file.name;


    const videoBlockId = await engine.block.addVideo(videoURL, 1920, 1080);

    disableBlockHighlight(engine, videoBlockId);
    if (pageRef.current && engine.block.isValid(pageRef.current)) {
      engine.block.appendChild(pageRef.current, videoBlockId);
      ensureTrackForVideoBlock(engine, videoBlockId);
      try {
        const videoFillId = engine.block.getFill(videoBlockId);
        if (videoFillId) {
          try {
            // await engine.block.forceLoadAVResource(videoFillId);
            // sleep 500ms
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (loadError) {
            console.warn("Failed to eagerly load video resource", loadError);
          }
        }
        const videoWidth = videoFillId
          ? engine.block.getVideoWidth(videoFillId)
          : engine.block.getVideoWidth(videoBlockId);
        const videoHeight = videoFillId
          ? engine.block.getVideoHeight(videoFillId)
          : engine.block.getVideoHeight(videoBlockId);
        let detectedDuration = 0;
        if (videoFillId) {
          try {
            detectedDuration = engine.block.getDouble(
              videoFillId,
              "fill/video/totalDuration"
            );
          } catch (durationError) {
            console.warn("Failed to read video duration", durationError);
          }
        }
        if (!Number.isFinite(detectedDuration) || detectedDuration <= 0) {
          detectedDuration = engine.block.getDuration(videoBlockId);
        }
        const sourceWidth =
          Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 1920;
        const sourceHeight =
          Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 1080;
        setSourceVideoSize({ width: sourceWidth, height: sourceHeight });
        engine.block.setWidth(pageRef.current, sourceWidth);
        engine.block.setHeight(pageRef.current, sourceHeight);
        if (Number.isFinite(detectedDuration) && detectedDuration > 0) {
          setSourceVideoDuration(detectedDuration);
          engine.block.setDuration(pageRef.current, detectedDuration);
          try {
            const blockFill = videoFillId ?? engine.block.getFill(videoBlockId);
            if (blockFill) {
              engine.block.setTrimOffset(blockFill, 0);
              engine.block.setTrimLength(blockFill, detectedDuration);
            }
          } catch (trimError) {
            console.warn("Failed to align video trim to duration", trimError);
          }
          try {
            engine.block.setDuration(videoBlockId, detectedDuration);
          } catch (clipDurationError) {
            console.warn("Failed to align video block duration", clipDurationError);
          }
        }
        engine.block.setPosition(videoBlockId, 0, 0);
        engine.block.setSize(videoBlockId, sourceWidth, sourceHeight);
      } catch (dimensionError) {
        console.warn("Failed to read video dimensions", dimensionError);
        const fallbackWidth = 1920;
        const fallbackHeight = 1080;
        setSourceVideoSize({ width: fallbackWidth, height: fallbackHeight });
        engine.block.setWidth(pageRef.current, fallbackWidth);
        engine.block.setHeight(pageRef.current, fallbackHeight);
        engine.block.setPosition(videoBlockId, 0, 0);
        engine.block.setSize(videoBlockId, fallbackWidth, fallbackHeight);
      }
      try {
        await engine.scene.zoomToBlock(pageRef.current, { padding: 0 });
      } catch (zoomError) {
        console.warn("Failed to zoom to page", zoomError);
      }
      updateTimelineDuration(engine);
    }
    videoBlockRef.current = videoBlockId;
    ensureCaptionsTrack(engine);
    clearCaptionsTrack(engine);

    try {
      const templateClone = engine.block.duplicate(videoBlockId, false);
      const templateParent = engine.block.getParent(templateClone);
      if (templateParent && engine.block.isValid(templateParent)) {
        try {
          engine.block.removeChild(templateParent, templateClone);
        } catch (detachError) {
          console.warn("Failed to detach template clone from parent", detachError);
        }
      }
      videoTemplateRef.current = templateClone;
    } catch (error) {
      console.warn("Failed to create video template", error);
      videoTemplateRef.current = null;
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadVideoFile(file);
    event.target.value = "";
  };

  const handleUploadDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
    if (isUploadDisabled) return;
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await loadVideoFile(file);
  };

  const handleUploadDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isUploadDisabled) return;
    setIsDropActive(true);
  };

  const handleUploadDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropActive(false);
  };

  const handleUploadClick = () => {
    if (isUploadDisabled) return;
    fileInputRef.current?.click();
  };

  const handleUploadKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    if (isUploadDisabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleGeminiFaceDebug = async () => {
    if (isFaceDebugLoading) return;
    console.log("[Gemini Face Debug] Starting thumbnail export");
    const engine = engineRef.current;
    if (!engine) {
      setGeminiFaceDebug(
        JSON.stringify({ error: "Creative engine is not ready." }, null, 2)
      );
      setGeminiFaceThumbnail(null);
      console.log("[Gemini Face Debug] Engine not ready");
      setIsDebugOpen(true);
      return;
    }
    const pageId = pageRef.current;
    if (!pageId || !engine.block.isValid(pageId)) {
      setGeminiFaceDebug(
        JSON.stringify({ error: "Video scene is not ready yet." }, null, 2)
      );
      setGeminiFaceThumbnail(null);
      console.log("[Gemini Face Debug] Page not ready", { pageId });
      setIsDebugOpen(true);
      return;
    }

    setIsFaceDebugLoading(true);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setDebugExportMetrics(null);

    try {
      const duration = sourceVideoDuration || timelineDuration || 0;
      const candidateTime = Number.isFinite(timelinePosition)
        ? Math.max(0, timelinePosition)
        : 0;
      const sampleTime =
        duration > 0 ? Math.min(candidateTime, duration) : candidateTime;
      console.log("[Gemini Face Debug] Sample time", {
        sampleTime,
        duration,
      });
      const playbackSupported = engine.block.supportsPlaybackTime(pageId);
      const pageWidth = engine.block.getWidth(pageId);
      const pageHeight = engine.block.getHeight(pageId);
      setDebugExportMetrics(
        JSON.stringify(
          {
            pageWidth,
            pageHeight,
            targetWidth: FACE_DEBUG_EXPORT_SIZE,
            targetHeight: FACE_DEBUG_EXPORT_SIZE,
          },
          null,
          2
        )
      );
      const previousPlaybackTime = playbackSupported
        ? engine.block.getPlaybackTime(pageId)
        : 0;
      const wasPlaying = playbackSupported ? engine.block.isPlaying(pageId) : false;
      if (playbackSupported) {
        try {
          engine.block.setPlaying(pageId, false);
          engine.block.setPlaybackTime(pageId, sampleTime);
        } catch (error) {
          console.warn("Failed to set playback time for debug export", error);
        }
      }
      let imageDataUrl = "";
      let displayUrl = "";
      const exportStart = performance.now();
      let timeoutId: number | null = null;
      try {
        console.log("[Gemini Face Debug] Exporting page snapshot", {
          target: FACE_DEBUG_EXPORT_SIZE,
          pageWidth,
          pageHeight,
        });
        const exportPromise = engine.block.export(pageId, {
          mimeType: "image/jpeg",
          jpegQuality: 0.9,
          targetWidth: FACE_DEBUG_EXPORT_SIZE,
          targetHeight: FACE_DEBUG_EXPORT_SIZE,
        });
        const timeoutPromise = new Promise<Blob>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(
              new Error(
                `Thumbnail export timed out after ${FACE_DEBUG_EXPORT_TIMEOUT_MS}ms`
              )
            );
          }, FACE_DEBUG_EXPORT_TIMEOUT_MS);
        });
        const blob = await Promise.race([exportPromise, timeoutPromise]);
        console.log("[Gemini Face Debug] Exported thumbnail", {
          size: blob.size,
          type: blob.type,
          target: FACE_DEBUG_EXPORT_SIZE,
          ms: Math.round(performance.now() - exportStart),
        });
        if (blob.size === 0) {
          throw new Error("Exported thumbnail blob is empty.");
        }
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
          displayUrl = URL.createObjectURL(blob);
          console.log("[Gemini Face Debug] Created display URL", displayUrl);
          setGeminiFaceThumbnail(displayUrl);
        }
        imageDataUrl = await blobToDataUrl(blob);
        console.log("[Gemini Face Debug] Data URL size", {
          length: imageDataUrl.length,
        });
        if (!imageDataUrl) {
          throw new Error("Failed to export debug thumbnail.");
        }
      } catch (error) {
        console.error("[Gemini Face Debug] Export failed", error);
        setGeminiFaceDebug(
          JSON.stringify(
            {
              error: "Failed to export debug thumbnail.",
              detail: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        );
        setIsDebugOpen(true);
        return;
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        if (playbackSupported) {
          try {
            engine.block.setPlaybackTime(pageId, previousPlaybackTime);
            engine.block.setPlaying(pageId, wasPlaying);
          } catch (error) {
            console.warn("Failed to restore playback after debug export", error);
          }
        }
      }
      if (!displayUrl) {
        setGeminiFaceThumbnail(imageDataUrl);
      }
      const geminiProvider =
        process.env.NEXT_PUBLIC_GEMINI_PROVIDER?.trim().toLowerCase() ||
        "openrouter";
      const visionModel =
        process.env.NEXT_PUBLIC_GEMINI_VISION_MODEL?.trim() || "";
      const proxyBase =
        process.env.NEXT_PUBLIC_GEMINI_PROXY_URL?.replace(/\/$/, "") ?? "";
      const payload: Record<string, unknown> = {
        imageDataUrl,
        provider: geminiProvider,
      };
      if (visionModel) payload.model = visionModel;

      const response = await fetch(
        `${proxyBase ? proxyBase : ""}/api/gemini-face-boxes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );
      const rawText = await response.text();
      if (!response.ok) {
        setGeminiFaceDebug(
          JSON.stringify(
            {
              error: "Gemini face box request failed.",
              status: response.status,
              detail: rawText,
            },
            null,
            2
          )
        );
        setIsDebugOpen(true);
        return;
      }

      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch (error) {
        parsed = null;
      }
      setGeminiFaceDebug(
        parsed ? JSON.stringify(parsed, null, 2) : rawText || "No response."
      );
      setIsDebugOpen(true);
    } catch (error) {
      setGeminiFaceDebug(
        JSON.stringify(
          {
            error: "Failed to request Gemini face boxes.",
            detail: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        )
      );
      setIsDebugOpen(true);
    } finally {
      setIsFaceDebugLoading(false);
    }
  };

  const handleTinyDebugExport = async () => {
    if (isFaceDebugLoading) return;
    console.log("[Gemini Face Debug] Starting tiny export");
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId || !engine.block.isValid(pageId)) {
      setGeminiFaceDebug(
        JSON.stringify({ error: "Video scene is not ready yet." }, null, 2)
      );
      console.log("[Gemini Face Debug] Tiny export page not ready", {
        pageId,
      });
      setIsDebugOpen(true);
      return;
    }
    setIsFaceDebugLoading(true);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setDebugExportMetrics(null);

    try {
      const pageWidth = engine.block.getWidth(pageId);
      const pageHeight = engine.block.getHeight(pageId);
      const tinySize = 240;
      console.log("[Gemini Face Debug] Tiny export metrics", {
        pageWidth,
        pageHeight,
        target: tinySize,
      });
      setDebugExportMetrics(
        JSON.stringify(
          {
            pageWidth,
            pageHeight,
            targetWidth: tinySize,
            targetHeight: tinySize,
            mode: "tiny-export",
          },
          null,
          2
        )
      );
      const blob = await engine.block.export(pageId, {
        mimeType: "image/jpeg",
        jpegQuality: 0.85,
        targetWidth: tinySize,
        targetHeight: tinySize,
      });
      console.log("[Gemini Face Debug] Tiny export result", {
        size: blob.size,
        type: blob.type,
      });
      if (blob.size === 0) {
        throw new Error("Tiny export returned empty blob.");
      }
      const displayUrl =
        typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(blob)
          : "";
      if (displayUrl) {
        setGeminiFaceThumbnail(displayUrl);
      } else {
        setGeminiFaceThumbnail(await blobToDataUrl(blob));
      }
      setIsDebugOpen(true);
    } catch (error) {
      console.error("[Gemini Face Debug] Tiny export failed", error);
      setGeminiFaceDebug(
        JSON.stringify(
          {
            error: "Tiny export failed.",
            detail: error instanceof Error ? error.message : String(error),
          },
          null,
          2
        )
      );
      setIsDebugOpen(true);
    } finally {
      setIsFaceDebugLoading(false);
    }
  };

  const buildAnalysisEstimate = (words: TranscriptWord[]): AnalysisEstimate | null => {
    const wordCount = words.length;
    if (!wordCount) return null;
    const minSeconds = Math.max(8, Math.round(wordCount * 0.015));
    const maxSeconds = Math.max(minSeconds + 5, Math.round(wordCount * 0.03));
    return { minSeconds, maxSeconds, wordCount };
  };

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () =>
        reject(reader.error ?? new Error("Failed to read thumbnail blob."));
      reader.readAsDataURL(blob);
    });

  const resolvePrimarySpeakerId = (
    faceSlotsBySpeaker: Record<string, FaceBounds[]>
  ) => {
    let primarySpeakerId: string | null = null;
    let maxFaces = 0;
    Object.entries(faceSlotsBySpeaker).forEach(([speakerId, faces]) => {
      if (faces.length > maxFaces) {
        maxFaces = faces.length;
        primarySpeakerId = speakerId;
      }
    });
    return { primarySpeakerId, maxFaces };
  };

  const normalizeThumbnailSource = async (src: string) => {
    if (!src) return src;
    if (src.startsWith("data:")) return src;
    if (!src.startsWith("blob:")) return src;
    const response = await fetch(src);
    const blob = await response.blob();
    return blobToDataUrl(blob);
  };

  const buildPreloadScriptPayload = async (): Promise<PreloadScript> => {
    if (preloadSnapshotRef.current?.thumbnails?.length) {
      return {
        ...preloadSnapshotRef.current,
        exportedAt: new Date().toISOString(),
      };
    }
    const pending = pendingWorkflowRef.current;
    const refinement = pending?.refinement ?? lastRefinementRef.current;
    const words = pending?.words ?? currentTranscriptWords;
    const desiredVariants =
      pending?.desiredVariants ?? lastDesiredVariantsRef.current;
    const refinementModeValue =
      pending?.refinement
        ? refinementMode
        : lastRefinementModeRef.current;
    if (!refinement) {
      throw new Error("Missing Gemini refinement. Run the workflow first.");
    }
    if (!words.length) {
      throw new Error("Missing transcript words. Run the workflow first.");
    }
    if (!speakerSnippets.length) {
      throw new Error("Missing speaker snippets. Run the workflow first.");
    }
    if (!speakerThumbnails.length) {
      throw new Error("Missing face thumbnails. Run the workflow first.");
    }
    if (!Object.keys(speakerFaceSlots).length) {
      throw new Error("Missing face bounds. Run the workflow first.");
    }
    const { primarySpeakerId, maxFaces } =
      resolvePrimarySpeakerId(speakerFaceSlots);
    const resolvedPrimarySpeakerId =
      primarySpeakerId ?? speakerThumbnails[0]?.speakerId ?? null;
    const normalizedThumbnails = await Promise.all(
      speakerThumbnails.map(async (thumb) => ({
        ...thumb,
        src: await normalizeThumbnailSource(thumb.src),
      }))
    );
    return {
      version: 1,
      refinementMode: refinementModeValue,
      desiredVariants,
      words,
      refinement,
      speakerSnippets,
      faceSlotsBySpeaker: speakerFaceSlots,
      thumbnails: normalizedThumbnails,
      primarySpeakerId: resolvedPrimarySpeakerId,
      maxFaces,
      exportedAt: new Date().toISOString(),
    };
  };

  const cachePreloadSnapshot = async (params: {
    words: TranscriptWord[];
    refinement: GeminiRefinement;
    refinementMode: RefinementMode;
    desiredVariants: number;
    snippets: SpeakerSnippet[];
    preload: {
      faceSlotsBySpeaker: Record<string, FaceBounds[]>;
      thumbnails: SpeakerFaceThumbnail[];
      primarySpeakerId: string | null;
      maxFaces: number;
    };
  }) => {
    try {
      const normalizedThumbnails = await Promise.all(
        params.preload.thumbnails.map(async (thumb) => ({
          ...thumb,
          src: await normalizeThumbnailSource(thumb.src),
        }))
      );
      preloadSnapshotRef.current = {
        version: 1,
        refinementMode: params.refinementMode,
        desiredVariants: params.desiredVariants,
        words: params.words,
        refinement: params.refinement,
        speakerSnippets: params.snippets,
        faceSlotsBySpeaker: params.preload.faceSlotsBySpeaker,
        thumbnails: normalizedThumbnails,
        primarySpeakerId: params.preload.primarySpeakerId,
        maxFaces: params.preload.maxFaces,
        exportedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn("Failed to cache preload script snapshot", error);
      preloadSnapshotRef.current = null;
    }
  };

  const buildSpeakerSnippets = (
    words: TranscriptWord[],
    totalDuration?: number | null
  ): SpeakerSnippet[] => {
    if (!words.length) return [];
    const orderedSpeakerIds: string[] = [];
    const speakerMap = new Map<string, TranscriptWord[]>();
    words.forEach((word) => {
      const speakerId = word.speaker_id ?? "unknown";
      if (!speakerMap.has(speakerId)) {
        speakerMap.set(speakerId, []);
        orderedSpeakerIds.push(speakerId);
      }
      speakerMap.get(speakerId)?.push(word);
    });

    return orderedSpeakerIds.map((speakerId, index) => {
      const speakerWords = (speakerMap.get(speakerId) ?? []).slice();
      speakerWords.sort((a, b) => a.start - b.start);
      const segments: TimeRange[] = [];
      let segmentStart = speakerWords[0]?.start ?? 0;
      let segmentEnd = speakerWords[0]?.end ?? segmentStart;
      speakerWords.slice(1).forEach((word) => {
        const gap = word.start - segmentEnd;
        if (gap > SPEAKER_SEGMENT_GAP_SECONDS) {
          segments.push({ start: segmentStart, end: segmentEnd });
          segmentStart = word.start;
          segmentEnd = word.end;
          return;
        }
        segmentEnd = Math.max(segmentEnd, word.end);
      });
      segments.push({ start: segmentStart, end: segmentEnd });

      const candidate =
        segments.find(
          (segment) => segment.end - segment.start >= SPEAKER_SNIPPET_MIN_SECONDS
        ) ??
        segments.reduce((best, segment) => {
          const bestDuration = best.end - best.start;
          const nextDuration = segment.end - segment.start;
          return nextDuration > bestDuration ? segment : best;
        }, segments[0] ?? { start: 0, end: 0 });

      const minEnd = candidate.start + SPEAKER_SNIPPET_MIN_SECONDS;
      let end = Math.max(candidate.end, minEnd);
      if (Number.isFinite(totalDuration) && (totalDuration ?? 0) > 0) {
        end = Math.min(end, totalDuration as number);
      }

      return {
        id: speakerId,
        label: `Speaker ${index + 1}`,
        start: candidate.start,
        end,
      };
    });
  };

  const countSpeakersFromWords = (words: TranscriptWord[]) => {
    const speakers = new Set<string>();
    words.forEach((word) => {
      speakers.add(word.speaker_id ?? "unknown");
    });
    return speakers.size;
  };

  const mapTrimmedWordsToSourceOrFallback = (
    sourceWords: TranscriptWord[],
    trimmedWords: TranscriptWord[]
  ) => {
    const mapped = mapTrimmedWordsToSource(sourceWords, trimmedWords);
    return mapped.length ? mapped : trimmedWords;
  };

  const mergeTranscriptWords = (wordSets: TranscriptWord[][]) => {
    const unique = new Map<string, TranscriptWord>();
    wordSets.forEach((set) => {
      set.forEach((word) => {
        const key = `${word.start}-${word.end}-${word.text ?? ""}-${
          word.speaker_id ?? "unknown"
        }`;
        if (!unique.has(key)) {
          unique.set(key, word);
        }
      });
    });
    return Array.from(unique.values()).sort((a, b) => a.start - b.start);
  };

  const buildSpeakerAssignments = (
    assignments: Record<string, number>,
    slotsBySpeaker: Record<string, FaceBounds[]>,
    fallbackSlots: FaceBounds[]
  ) => {
    const map = new Map<string, FaceBounds>();
    Object.entries(assignments).forEach(([speakerId, slotIndex]) => {
      const resolved =
        slotsBySpeaker[speakerId]?.[slotIndex] ?? fallbackSlots[slotIndex];
      if (resolved) {
        map.set(speakerId, resolved);
      }
    });
    return map;
  };

  const buildSpeakerThumbnailAssignments = (
    assignments: Record<string, number>,
    thumbnails: SpeakerFaceThumbnail[]
  ) => {
    const map: Record<string, SpeakerFaceThumbnail> = {};
    Object.entries(assignments).forEach(([speakerId, slotIndex]) => {
      const match = thumbnails.find(
        (thumb) => thumb.speakerId === speakerId && thumb.slotIndex === slotIndex
      );
      if (match) {
        map[speakerId] = match;
      }
    });
    return map;
  };

  const resolveSpeakerForRange = (
    range: TimeRange,
    words: TranscriptWord[]
  ): string | null => {
    const counts = new Map<string, number>();
    words.forEach((word) => {
      if (word.start >= range.end || word.end <= range.start) return;
      const speakerId = word.speaker_id ?? "unknown";
      counts.set(speakerId, (counts.get(speakerId) ?? 0) + 1);
    });
    if (!counts.size) return null;
    const filteredCounts =
      counts.size > 1 && counts.has("unknown")
        ? new Map(
            Array.from(counts.entries()).filter(([id]) => id !== "unknown")
          )
        : counts;
    const resolvedCounts = filteredCounts.size ? filteredCounts : counts;
    let best: { id: string; count: number } | null = null;
    resolvedCounts.forEach((count, id) => {
      if (!best || count > best.count) {
        best = { id, count };
      }
    });
    return best?.id ?? null;
  };

  const splitRangesBySpeaker = (
    ranges: TimeRange[],
    words: TranscriptWord[]
  ) => {
    if (!ranges.length || !words.length) return ranges;
    const sortedWords = words
      .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
      .slice()
      .sort((a, b) => a.start - b.start);
    if (!sortedWords.length) return ranges;
    const minDuration = 0.01;

    return ranges.flatMap((range) => {
      const overlapping = sortedWords.filter(
        (word) => word.start < range.end && word.end > range.start
      );
      if (!overlapping.length) return [range];
      const uniqueSpeakers = new Set(
        overlapping.map((word) => word.speaker_id ?? "unknown")
      );
      if (uniqueSpeakers.size <= 1) return [range];

      const segments: TimeRange[] = [];
      let currentSpeaker = overlapping[0]?.speaker_id ?? "unknown";
      let segmentStart = range.start;

      overlapping.forEach((word) => {
        const speakerId = word.speaker_id ?? "unknown";
        if (speakerId !== currentSpeaker) {
          const segmentEnd = Math.min(range.end, word.start);
          if (segmentEnd - segmentStart >= minDuration) {
            segments.push({ start: segmentStart, end: segmentEnd });
          }
          currentSpeaker = speakerId;
          segmentStart = Math.max(range.start, word.start);
        }
      });

      if (range.end - segmentStart >= minDuration) {
        segments.push({ start: segmentStart, end: range.end });
      }

      return segments.length ? segments : [range];
    });
  };

  const transcribeExtractedAudio = async (
    audioBlob: Blob
  ): Promise<TranscriptWord[]> => {
    try {
      setIsTranscribing(true);
      if (speechProvider === "openai-whisper") {
        const transcriptionResult = await transcribeWithOpenAI(audioBlob, {
          enableWordTimestamps: true,
        });
        setTranscriptDebug(transcriptionResult.rawResponse);
        const words = extractOpenAITranscriptWords(
          transcriptionResult.rawResponse
        );
        if (!words.length) {
          throw new Error(
            "OpenAI Whisper did not return word timestamps. Ensure whisper-1 with word timestamps is enabled."
          );
        }
        setCurrentTranscriptWords(words);
        setAnalysisEstimate(buildAnalysisEstimate(words));
        return words;
      }
      if (speechProvider === "openai-gpt4o") {
        const transcriptionResult = await transcribeWithOpenAI(audioBlob, {
          model: "gpt-4o-transcribe",
          enableWordTimestamps: true,
        });
        setTranscriptDebug(transcriptionResult.rawResponse);
        let words = extractOpenAITranscriptWords(
          transcriptionResult.rawResponse
        );
        if (!words.length) {
          const durationHint = sourceVideoDuration || timelineDuration;
          console.warn(
            "OpenAI GPT-4o did not return word timestamps; using approximations."
          );
          words = buildTranscriptWordsFromText(
            transcriptionResult.transcript,
            durationHint
          );
        }
        if (!words.length) {
          throw new Error(
            "OpenAI GPT-4o transcription did not return usable text."
          );
        }
        setCurrentTranscriptWords(words);
        setAnalysisEstimate(buildAnalysisEstimate(words));
        return words;
      }
      const transcriptionResult = await transcribeWithElevenLabs(audioBlob);
      setTranscriptDebug(transcriptionResult.rawResponse);
      const words = extractTranscriptWords(transcriptionResult.rawResponse);
      setCurrentTranscriptWords(words);
      setAnalysisEstimate(buildAnalysisEstimate(words));
      return words;
    } catch (error) {
      console.error("Failed to transcribe audio", error);
      const message =
        error instanceof Error ? error.message : "Failed to transcribe audio";
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const applyRefinementToTimeline = async (
    words: TranscriptWord[],
    refinement: GeminiRefinement,
    desiredVariants: number
  ) => {
    if (refinement.concepts.length && desiredVariants > 1) {
      setConceptChoices(refinement.concepts);
      const defaultConcept = refinement.concepts[0];
      setSelectedConceptId(defaultConcept?.id ?? null);
      setApplyingConceptId(null);
      if (defaultConcept) {
        await applyTranscriptCuts(
          words,
          defaultConcept.trimmed_words,
          defaultConcept.hook
        );
      }
    } else {
      setConceptChoices([]);
      setSelectedConceptId(null);
      setApplyingConceptId(null);
      await applyTranscriptCuts(words, refinement.trimmed_words, refinement.hook);
    }
  };

  const handleExportPreloadScript = async () => {
    if (isPreloadScriptExporting) return;
    setIsPreloadScriptExporting(true);
    setPreloadScript(null);
    try {
      const payload = await buildPreloadScriptPayload();
      setPreloadScript(JSON.stringify(payload, null, 2));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to export preload script.";
      setPreloadScript(JSON.stringify({ error: message }, null, 2));
    } finally {
      setIsPreloadScriptExporting(false);
    }
  };

  const handleImportPreloadScript = async () => {
    if (isImportingScript) return;
    setImportScriptError(null);
    const raw = importScriptText.trim();
    if (!raw) {
      setImportScriptError("Paste a preload script first.");
      return;
    }
    if (!videoFile) {
      setImportScriptError("Upload a video before importing a script.");
      return;
    }
    let parsed: PreloadScript;
    try {
      parsed = JSON.parse(raw) as PreloadScript;
    } catch (error) {
      setImportScriptError("Script is not valid JSON.");
      return;
    }
    if (!parsed || parsed.version !== 1) {
      setImportScriptError("Unsupported script version.");
      return;
    }
    if (!parsed.words?.length) {
      setImportScriptError("Script is missing transcript words.");
      return;
    }
    if (!parsed.refinement) {
      setImportScriptError("Script is missing Gemini refinement.");
      return;
    }
    if (!parsed.speakerSnippets?.length) {
      setImportScriptError("Script is missing speaker snippets.");
      return;
    }
    if (!parsed.thumbnails?.length) {
      setImportScriptError("Script is missing face thumbnails.");
      return;
    }
    setIsImportingScript(true);
    try {
      beginWorkflow();
      resetPreloadState();
      preloadSnapshotRef.current = parsed;
      setTranscriptDebug(null);
      setGeminiDebug(null);
      setGeminiFaceDebug(null);
      setGeminiFaceThumbnail(null);
      setDebugExportMetrics(null);
      setCaptionDebug(buildCaptionDebugMap(parsed.words, parsed.refinement));
      setIsDebugOpen(false);
      setIsFaceDebugLoading(false);
      setTimelineSegments([]);
      setIsScrubbingTimeline(false);
      clearCaptionsTrack();
      setIsExtracting(false);
      setIsTranscribing(false);
      setProgress(0);
      setAutoProcessingError(null);
      updateProcessingStatus("audio", "complete");
      updateProcessingStatus("transcript", "complete");
      updateProcessingStatus("analysis", "complete");
      updateProcessingStatus("preload", "active");

      setCurrentTranscriptWords(parsed.words);
      setAnalysisEstimate(buildAnalysisEstimate(parsed.words));
      if (parsed.refinementMode) {
        setRefinementMode(parsed.refinementMode);
        lastRefinementModeRef.current = parsed.refinementMode;
      }
      lastRefinementRef.current = parsed.refinement;
      const desiredVariants =
        Number.isFinite(parsed.desiredVariants) && parsed.desiredVariants > 0
          ? Math.floor(parsed.desiredVariants)
          : 1;
      lastDesiredVariantsRef.current = desiredVariants;

      const resolvedSlots = parsed.faceSlotsBySpeaker ?? {};
      const resolvedThumbnails = parsed.thumbnails ?? [];
      const primaryFallback = resolvePrimarySpeakerId(resolvedSlots);
      const resolvedPrimarySpeakerId =
        parsed.primarySpeakerId ?? primaryFallback.primarySpeakerId ?? null;
      const resolvedMaxFaces =
        Number.isFinite(parsed.maxFaces) && parsed.maxFaces > 0
          ? parsed.maxFaces
          : primaryFallback.maxFaces;
      const preloadResult = {
        faceSlotsBySpeaker: resolvedSlots,
        thumbnails: resolvedThumbnails,
        primarySpeakerId: resolvedPrimarySpeakerId,
        maxFaces: resolvedMaxFaces,
      };

      setSpeakerSnippets(parsed.speakerSnippets);
      setSpeakerThumbnails(resolvedThumbnails);
      setSpeakerFaceSlots(resolvedSlots);
      const primarySlots =
        (resolvedPrimarySpeakerId && resolvedSlots[resolvedPrimarySpeakerId]) ??
        [];
      setPrimaryFaceSlots(primarySlots);
      const optionFaces = resolvedPrimarySpeakerId
        ? resolvedThumbnails
            .filter((thumb) => thumb.speakerId === resolvedPrimarySpeakerId)
            .sort((a, b) => a.slotIndex - b.slotIndex)
        : [];
      const optionSlots = Array.from(
        new Set(optionFaces.map((face) => face.slotIndex))
      ).sort((a, b) => a - b);
      setFaceOptions(optionFaces);

      const needsIdentification =
        optionSlots.length > 1 && parsed.speakerSnippets.length > 1;
      if (needsIdentification) {
        pendingWorkflowRef.current = {
          words: parsed.words,
          refinement: parsed.refinement,
          desiredVariants,
        };
        const started = beginSpeakerIdentification(
          parsed.speakerSnippets,
          preloadResult
        );
        if (started) {
          setIsImportScriptOpen(false);
          setImportScriptText("");
          return;
        }
        setHidePreloadThumbnails(false);
        pendingWorkflowRef.current = null;
      } else {
        setHidePreloadThumbnails(false);
      }

      if (!needsIdentification && optionSlots.length === 1) {
        const slotIndex = optionSlots[0];
        if (parsed.speakerSnippets.length > 1 && slotIndex !== undefined) {
          const singleAssignments: Record<string, number> = {};
          parsed.speakerSnippets.forEach((snippet) => {
            singleAssignments[snippet.id] = slotIndex;
          });
          speakerAssignmentsRef.current = singleAssignments;
          setSpeakerAssignments(singleAssignments);
          const assignedThumbnails = buildSpeakerThumbnailAssignments(
            singleAssignments,
            resolvedThumbnails
          );
          setSpeakerAssignedThumbnails(assignedThumbnails);
          const assignedList = Object.values(assignedThumbnails);
          if (assignedList.length) {
            const toRevoke = resolvedThumbnails.filter(
              (thumb) => !assignedList.includes(thumb)
            );
            if (toRevoke.length) {
              window.setTimeout(() => {
                revokeSpeakerThumbnailUrls(toRevoke);
              }, 0);
            }
            setSpeakerThumbnails(assignedList);
          }
        }
      }

      updateProcessingStatus("preload", "complete");
      await applyRefinementToTimeline(
        parsed.words,
        parsed.refinement,
        desiredVariants
      );
      setAutoProcessing(false);
      setIsImportScriptOpen(false);
      setImportScriptText("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to import preload script.";
      setImportScriptError(message);
    } finally {
      setIsImportingScript(false);
    }
  };

  const stopSpeakerPlayback = () => {
    if (speakerPlaybackTimeoutRef.current) {
      window.clearTimeout(speakerPlaybackTimeoutRef.current);
      speakerPlaybackTimeoutRef.current = null;
    }
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId || !engine.block.isValid(pageId)) return;
    try {
      engine.block.setPlaying(pageId, false);
    } catch (error) {
      console.warn("Failed to stop speaker playback", error);
    }
    setIsSpeakerAudioPlaying(false);
  };

  const playSpeakerSnippet = (snippet: SpeakerSnippet) => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId || !engine.block.isValid(pageId)) return;
    stopSpeakerPlayback();
    setAudioPlaybackMuted(false);
    const safeStart = Math.max(0, snippet.start);
    const safeEnd = Math.max(safeStart, snippet.end);
    const durationMs = Math.max(0.1, safeEnd - safeStart) * 1000;
    try {
      engine.block.setPlaybackTime(pageId, safeStart);
      engine.block.setPlaying(pageId, true);
      setIsSpeakerAudioPlaying(true);
      setHasPlayedSpeakerAudio(true);
    } catch (error) {
      console.warn("Failed to play speaker snippet", error);
      return;
    }
    speakerPlaybackTimeoutRef.current = window.setTimeout(() => {
      stopSpeakerPlayback();
    }, durationMs);
  };

  const beginSpeakerIdentification = (
    snippets: SpeakerSnippet[],
    preloadResult: {
      faceSlotsBySpeaker: Record<string, FaceBounds[]>;
      thumbnails: SpeakerFaceThumbnail[];
      primarySpeakerId: string | null;
      maxFaces: number;
    }
  ) => {
    const { faceSlotsBySpeaker, thumbnails, primarySpeakerId } = preloadResult;
    console.info("[Speaker Debug] Begin identification", {
      speakers: snippets.map((snippet) => snippet.id),
      primarySpeakerId,
      faceCounts: Object.fromEntries(
        Object.entries(faceSlotsBySpeaker).map(([id, faces]) => [
          id,
          faces.length,
        ])
      ),
      thumbnailCounts: thumbnails.reduce<Record<string, number>>(
        (acc, thumb) => {
          acc[thumb.speakerId] = (acc[thumb.speakerId] ?? 0) + 1;
          return acc;
        },
        {}
      ),
    });
    setSpeakerFaceSlots(faceSlotsBySpeaker);
    setSpeakerThumbnails(thumbnails);
    setSpeakerAssignedThumbnails({});
    const primarySlots =
      (primarySpeakerId && faceSlotsBySpeaker[primarySpeakerId]) ?? [];
    setPrimaryFaceSlots(primarySlots);
    const optionFaces = primarySpeakerId
      ? thumbnails
          .filter((thumb) => thumb.speakerId === primarySpeakerId)
          .sort((a, b) => a.slotIndex - b.slotIndex)
      : [];
    const optionSlots = Array.from(
      new Set(optionFaces.map((face) => face.slotIndex))
    ).sort((a, b) => a - b);
    setFaceOptions(optionFaces);
    speakerAssignmentsRef.current = {};
    setSpeakerAssignments({});
    setAvailableFaceSlots(optionSlots);
    const queuedSpeakers = snippets.map((snippet) => snippet.id);
    setSpeakerQueue(queuedSpeakers);
    setActiveSpeakerId(queuedSpeakers[0] ?? null);
    setHasPlayedSpeakerAudio(false);
    setIsSpeakerAudioPlaying(false);
    setHidePreloadThumbnails(true);
    const shouldStart = queuedSpeakers.length > 0 && optionSlots.length > 1;
    setIsSpeakerIdentificationActive(shouldStart);
    return shouldStart;
  };

  const finalizePendingWorkflow = async (assignments: Record<string, number>) => {
    const pending = pendingWorkflowRef.current;
    if (!pending) return;
    try {
      stopSpeakerPlayback();
      speakerAssignmentsRef.current = assignments;
      setSpeakerAssignments(assignments);
      await applyRefinementToTimeline(
        pending.words,
        pending.refinement,
        pending.desiredVariants
      );
      updateProcessingStatus("preload", "complete");
      pendingWorkflowRef.current = null;
      setIsSpeakerIdentificationActive(false);
      setActiveSpeakerId(null);
      setSpeakerQueue([]);
      setAvailableFaceSlots([]);
      setHasPlayedSpeakerAudio(false);
      setIsSpeakerAudioPlaying(false);
    } catch (error) {
      console.error("Failed to finalize speaker identification", error);
      updateProcessingStatus("preload", "error");
      setAutoProcessingError(
        error instanceof Error
          ? error.message
          : "Failed to apply speaker identification."
      );
    } finally {
      setAutoProcessing(false);
    }
  };

  const handleFaceSelection = async (selectedFace: SpeakerFaceThumbnail) => {
    if (!activeSpeakerId) return;
    stopSpeakerPlayback();
    const slotIndex = selectedFace.slotIndex;
    const selectedThumbnails = speakerThumbnails.filter(
      (thumb) => thumb.slotIndex === slotIndex
    );
    const remainingThumbnails = speakerThumbnails.filter(
      (thumb) => thumb.slotIndex !== slotIndex
    );
    setFaceOptions((prev) =>
      prev.filter((thumb) => thumb.slotIndex !== slotIndex)
    );
    const assignedThumbnail = selectedFace;
    console.info("[Speaker Debug] Face selection", {
      activeSpeakerId,
      slotIndex,
      selectedCount: selectedThumbnails.length,
      assignedFound: Boolean(assignedThumbnail),
      remainingCount: remainingThumbnails.length,
    });
    if (assignedThumbnail) {
      setSpeakerAssignedThumbnails((prev) => ({
        ...prev,
        [activeSpeakerId]: assignedThumbnail,
      }));
    }
    const thumbnailsToRevoke = selectedThumbnails.filter(
      (thumb) => thumb !== assignedThumbnail
    );
    if (thumbnailsToRevoke.length) {
      window.setTimeout(() => {
        revokeSpeakerThumbnailUrls(thumbnailsToRevoke);
      }, 0);
    }
    const nextAssignments = {
      ...speakerAssignments,
      [activeSpeakerId]: slotIndex,
    };
    speakerAssignmentsRef.current = nextAssignments;
    const remainingSlots = availableFaceSlots.filter(
      (slot) => slot !== slotIndex
    );
    const remainingQueue = speakerQueue.filter(
      (speakerId) => speakerId !== activeSpeakerId
    );
    if (remainingQueue.length === 1 && remainingSlots.length === 1) {
      const remainingSpeakerId = remainingQueue[0];
      const remainingSlot = remainingSlots[0];
      nextAssignments[remainingSpeakerId] = remainingSlot;
      speakerAssignmentsRef.current = nextAssignments;
      const remainingSlotThumbnails = remainingThumbnails.filter(
        (thumb) => thumb.slotIndex === remainingSlot
      );
      const remainingAssignedThumbnail =
        faceOptions.find((thumb) => thumb.slotIndex === remainingSlot) ??
        remainingSlotThumbnails.find(
          (thumb) => thumb.speakerId === remainingSpeakerId
        ) ??
        remainingSlotThumbnails[0] ??
        null;
      if (remainingAssignedThumbnail) {
        setSpeakerAssignedThumbnails((prev) => ({
          ...prev,
          [remainingSpeakerId]: remainingAssignedThumbnail,
        }));
      }
      const remainingToRevoke = remainingSlotThumbnails.filter(
        (thumb) => thumb !== remainingAssignedThumbnail
      );
      if (remainingToRevoke.length) {
        window.setTimeout(() => {
          revokeSpeakerThumbnailUrls(remainingToRevoke);
        }, 0);
      }
      setSpeakerThumbnails(
        remainingAssignedThumbnail ? [remainingAssignedThumbnail] : []
      );
      await finalizePendingWorkflow(nextAssignments);
      return;
    }
    if (remainingQueue.length === 0) {
      setSpeakerThumbnails(remainingThumbnails);
      await finalizePendingWorkflow(nextAssignments);
      return;
    }
    if (remainingSlots.length === 0) {
      setSpeakerThumbnails(remainingThumbnails);
      await finalizePendingWorkflow(nextAssignments);
      return;
    }
    setSpeakerThumbnails(remainingThumbnails);
    setSpeakerAssignments(nextAssignments);
    setAvailableFaceSlots(remainingSlots);
    setSpeakerQueue(remainingQueue);
    setActiveSpeakerId(remainingQueue[0] ?? null);
    setHasPlayedSpeakerAudio(false);
  };

  const runAutomaticWorkflow = async () => {
    if (!videoFile) {
      setAutoProcessingError("Upload a video first.");
      return;
    }
    if (!engineRef.current) {
      setAutoProcessingError(
        "Video is still preparing. Please try again in a moment."
      );
      return;
    }

    let activeStep: ProcessingStepId | null = null;
    let shouldFinalize = true;
    beginWorkflow();
    resetPreloadState();
    setTranscriptDebug(null);
    setGeminiDebug(null);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setDebugExportMetrics(null);
    setCaptionDebug(null);
    setIsDebugOpen(false);
    setIsFaceDebugLoading(false);
    setTimelineSegments([]);
    setIsScrubbingTimeline(false);
    clearCaptionsTrack();

    try {
      activeStep = "audio";
      updateProcessingStatus("audio", "active");
      setProgress(0);
      setIsExtracting(true);
      const audioBlob = await extractAudioWithEngine();
      updateProcessingStatus("audio", "complete");
      setIsExtracting(false);

      activeStep = "transcript";
      updateProcessingStatus("transcript", "active");
      const words = await transcribeExtractedAudio(audioBlob);
      if (!words.length) {
        throw new Error("Transcript did not contain any timestamped words.");
      }
      updateProcessingStatus("transcript", "complete");

      activeStep = "analysis";
      updateProcessingStatus("analysis", "active");
      const desiredVariants =
        refinementMode === "sixty_seconds" ||
        refinementMode === "thirty_seconds"
          ? 3
          : 1;
      const { refinement, rawText } = await requestGeminiRefinement(
        words,
        refinementMode,
        { variantCount: desiredVariants }
      );
      lastRefinementRef.current = refinement;
      lastDesiredVariantsRef.current = desiredVariants;
      lastRefinementModeRef.current = refinementMode;
      setGeminiDebug(rawText);
      setCaptionDebug(buildCaptionDebugMap(words, refinement));
      updateProcessingStatus("analysis", "complete");

      activeStep = "preload";
      updateProcessingStatus("preload", "active");
      setHidePreloadThumbnails(true);
      const snippetSourceWords =
        refinement.trimmed_words.length > 0 ? refinement.trimmed_words : words;
      const resolvedSnippetWords =
        refinement.trimmed_words.length > 0
          ? mapTrimmedWordsToSourceOrFallback(words, snippetSourceWords)
          : snippetSourceWords;
      const variantWordSets =
        refinement.concepts.length > 0
          ? refinement.concepts
              .map((concept) =>
                mapTrimmedWordsToSourceOrFallback(
                  words,
                  concept.trimmed_words
                )
              )
              .filter((set) => set.length)
          : [];
      const speakerWordSets = variantWordSets.length
        ? variantWordSets
        : [resolvedSnippetWords];
      const hasMultipleSpeakersInVariants = speakerWordSets.some(
        (set) => countSpeakersFromWords(set) > 1
      );
      const mergedSpeakerWords = hasMultipleSpeakersInVariants
        ? mergeTranscriptWords(speakerWordSets)
        : resolvedSnippetWords;
      const speakerSnippetWords = mergedSpeakerWords.length
        ? mergedSpeakerWords
        : resolvedSnippetWords;
      const totalDuration =
        sourceVideoDuration ||
        timelineDuration ||
        speakerSnippetWords[speakerSnippetWords.length - 1]?.end ||
        0;
      const snippets = buildSpeakerSnippets(
        speakerSnippetWords,
        totalDuration
      );
      setSpeakerSnippets(snippets);
      setSpeakerThumbnails([]);
      setSpeakerFaceSlots({});
      setPrimaryFaceSlots([]);
      setFaceOptions([]);
      let preloadResult: {
        faceSlotsBySpeaker: Record<string, FaceBounds[]>;
        thumbnails: SpeakerFaceThumbnail[];
        primarySpeakerId: string | null;
        maxFaces: number;
      } | null = null;
      try {
        preloadResult = await preloadSpeakerFaces(snippets);
      } catch (error) {
        console.warn("Failed to preload speaker faces", error);
      }

      if (preloadResult) {
        await cachePreloadSnapshot({
          words,
          refinement,
          refinementMode,
          desiredVariants,
          snippets,
          preload: preloadResult,
        });
        setSpeakerFaceSlots(preloadResult.faceSlotsBySpeaker);
        setSpeakerThumbnails(preloadResult.thumbnails);
        const primarySlots =
          (preloadResult.primarySpeakerId &&
            preloadResult.faceSlotsBySpeaker[preloadResult.primarySpeakerId]) ??
          [];
        setPrimaryFaceSlots(primarySlots);
        const optionFaces = preloadResult.primarySpeakerId
          ? preloadResult.thumbnails
              .filter(
                (thumb) => thumb.speakerId === preloadResult.primarySpeakerId
              )
              .sort((a, b) => a.slotIndex - b.slotIndex)
          : [];
        const optionSlots = Array.from(
          new Set(optionFaces.map((face) => face.slotIndex))
        ).sort((a, b) => a - b);
        setFaceOptions(optionFaces);

        const needsIdentification =
          optionSlots.length > 1 &&
          hasMultipleSpeakersInVariants &&
          snippets.length > 1;
        if (needsIdentification) {
          pendingWorkflowRef.current = {
            words,
            refinement,
            desiredVariants,
          };
          const started = beginSpeakerIdentification(snippets, preloadResult);
          if (started) {
            shouldFinalize = false;
            return;
          }
          setHidePreloadThumbnails(false);
          pendingWorkflowRef.current = null;
        } else {
          setHidePreloadThumbnails(false);
        }

        if (!needsIdentification && optionSlots.length === 1 && snippets.length > 1) {
          const singleAssignments: Record<string, number> = {};
          const slotIndex = optionSlots[0];
          snippets.forEach((snippet) => {
            singleAssignments[snippet.id] = slotIndex;
          });
          speakerAssignmentsRef.current = singleAssignments;
          setSpeakerAssignments(singleAssignments);
          const assignedThumbnails = buildSpeakerThumbnailAssignments(
            singleAssignments,
            preloadResult.thumbnails
          );
          setSpeakerAssignedThumbnails(assignedThumbnails);
          const assignedList = Object.values(assignedThumbnails);
          if (assignedList.length) {
            const toRevoke = preloadResult.thumbnails.filter(
              (thumb) => !assignedList.includes(thumb)
            );
            if (toRevoke.length) {
              window.setTimeout(() => {
                revokeSpeakerThumbnailUrls(toRevoke);
              }, 0);
            }
            setSpeakerThumbnails(assignedList);
          }
        }
      } else {
        setHidePreloadThumbnails(false);
      }

      updateProcessingStatus("preload", "complete");
      activeStep = null;
      await applyRefinementToTimeline(words, refinement, desiredVariants);
    } catch (error) {
      console.error("Automatic processing failed", error);
      const message =
        error instanceof Error
          ? error.message
          : "Automatic processing failed.";
      if (activeStep) {
        updateProcessingStatus(activeStep, "error");
      }
      setAutoProcessingError(message);
    } finally {
      setIsExtracting(false);
      if (shouldFinalize) {
        setAutoProcessing(false);
      }
    }
  };

  const handleConceptSelection = async (conceptId: string) => {
    const concept = conceptChoices.find((option) => option.id === conceptId);
    if (!concept) {
      return;
    }
    const words = getTranscriptWordsSnapshot();
    if (!words.length) {
      setAutoProcessingError(
        "Transcript context is missing. Please transcribe before applying a concept."
      );
      return;
    }
    setIsApplyingConcept(true);
    setApplyingConceptId(concept.id);
    setAutoProcessingError(null);
    try {
      await applyTranscriptCuts(words, concept.trimmed_words, concept.hook);
      setSelectedConceptId(concept.id);
    } catch (error) {
      console.error("Failed to apply concept", error);
      setAutoProcessingError(
        error instanceof Error ? error.message : "Failed to apply concept."
      );
    } finally {
      setIsApplyingConcept(false);
      setApplyingConceptId(null);
    }
  };

  const syncAudioBlockDuration = async (
    engine: CreativeEngineInstance,
    audioBlockId: number
  ) => {
    try {
      await engine.block.forceLoadAVResource(audioBlockId);
    } catch (error) {
      console.warn("Failed to preload audio resource", error);
    }

    const resourceDuration = engine.block.getAVResourceTotalDuration(audioBlockId);
    if (resourceDuration > 0) {
      engine.block.setDuration(audioBlockId, resourceDuration);
    }
  };

  const ensureAudioDuration = async (
    engine: CreativeEngineInstance,
    audioBlockId: number
  ) => {
    let resourceDuration = 0;
    try {
      resourceDuration = engine.block.getAVResourceTotalDuration(audioBlockId);
    } catch (error) {
      console.warn("Failed to read audio duration", error);
    }

    if (!resourceDuration || resourceDuration <= 0) {
      await syncAudioBlockDuration(engine, audioBlockId);
      resourceDuration = engine.block.getAVResourceTotalDuration(audioBlockId);
    }

    if (!resourceDuration || resourceDuration <= 0) {
      resourceDuration = engine.block.getDuration(audioBlockId);
    }

    return resourceDuration;
  };

  const scrubToTime = (time: number) => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId) return;
    if (!engine.block.supportsPlaybackTime(pageId)) return;
    const clamped = Math.min(
      Math.max(time, 0),
      timelineDuration > 0 ? timelineDuration : time
    );
    try {
      engine.block.setPlaybackTime(pageId, clamped);
    } catch (error) {
      console.warn("Failed to set playback time", error);
    }
  };

  const togglePlayback = () => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId) return;

    const shouldPlay = !isPlaying;
    try {
      engine.block.setPlaying(pageId, shouldPlay);
      setIsPlaying(shouldPlay);
      if (shouldPlay && timelineDuration > 0 && timelinePosition >= timelineDuration) {
        engine.block.setPlaybackTime(pageId, 0);
        setTimelinePosition(0);
      }
    } catch (error) {
      console.warn("Failed to toggle playback", error);
    }
  };

  const extractAudioWithEngine = async (): Promise<Blob> => {
    // Bypass engine.block.exportAudio due to a bug - extract audio directly using mediabunny
    if (!videoFile) {
      throw new Error("No video file available. Upload a video first.");
    }

    setProgress(10);

    const input = new Input({
      source: new BlobSource(videoFile),
      formats: ALL_FORMATS,
    });

    const target = new BufferTarget();
    const output = new Output({
      format: new WavOutputFormat(),
      target,
    });

    setProgress(30);

    const conversion = await Conversion.init({ input, output });

    setProgress(50);
    await conversion.execute();
    setProgress(100);

    const buffer = target.buffer;
    if (!buffer) {
      throw new Error("Failed to extract audio: no buffer produced");
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  const setVideoTrackAutoManage = (
    engine: CreativeEngineInstance,
    trackId: number,
    enabled: boolean
  ) => {
    if (!engine.block.isValid(trackId)) return;
    try {
      engine.block.setBool(
        trackId,
        "track/automaticallyManageBlockOffsets",
        enabled
      );
    } catch (error) {
      console.warn("Failed to configure video track offsets", error);
    }
  };

  const ensureTrackForVideoBlock = (
    engine: CreativeEngineInstance,
    videoBlockId: number
  ) => {
    const pageId = pageRef.current;
    if (!pageId) return null;
    let parent = engine.block.getParent(videoBlockId);
    const parentType = parent ? engine.block.getType(parent) : null;
    const isTrack = parentType === "track" || parentType === "//ly.img.ubq/track";
    if (!parent || !isTrack) {
      const track = engine.block.create("track");
      engine.block.appendChild(pageId, track);
      engine.block.appendChild(track, videoBlockId);
      parent = track;
    }
    videoTrackRef.current = parent;
    setVideoTrackAutoManage(engine, parent, true);
    return parent;
  };

  const ensureVideoTrack = (engine: CreativeEngineInstance) => {
    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
      setVideoTrackAutoManage(engine, videoTrackRef.current, true);
      return videoTrackRef.current;
    }
    if (videoBlockRef.current && engine.block.isValid(videoBlockRef.current)) {
      return ensureTrackForVideoBlock(engine, videoBlockRef.current);
    }
    return null;
  };

  const setAudioPlaybackMuted = (muted: boolean, blockId?: number | null) => {
    const engine = engineRef.current;
    const target =
      typeof blockId === "number"
        ? blockId
        : audioBlockRef.current && engine?.block.isValid(audioBlockRef.current)
          ? audioBlockRef.current
          : null;
    if (!engine || !target) return;
    try {
      engine.block.setMuted(target, muted);
    } catch (error) {
      console.warn("Failed to set audio mute state", error);
    }
    try {
      engine.block.setBool(target, "playback/muted", muted);
    } catch (error) {
      console.warn("Failed to sync playback mute state", error);
    }
  };

  const retimeWordsSequentially = (words: TranscriptWord[]) => {
    let cursor = 0;
    return words.map((word) => {
      const start = cursor;
      const duration = Math.max(0.05, (word.end ?? 0) - (word.start ?? 0));
      cursor += duration;
      return {
        ...word,
        start,
        end: start + duration,
      };
    });
  };

  const normalizeWordText = (text?: string | null) =>
    text?.toLowerCase().replace(/[^a-z0-9']+/g, "") ?? "";

  const mapTrimmedWordsToSource = (
    sourceWords: TranscriptWord[],
    trimmedWords: TranscriptWord[]
  ) => {
    if (!sourceWords.length || !trimmedWords.length) return trimmedWords;
    const normalizedSource = sourceWords.map((word) => ({
      start: Math.max(0, word.start),
      end: Math.max(word.start, word.end),
      normalized: normalizeWordText(word.text),
      speaker_id: word.speaker_id ?? null,
    }));
    let searchIndex = 0;
    const mapped: TranscriptWord[] = [];

    trimmedWords.forEach((word) => {
      const target = normalizeWordText(word.text);
      if (!target) return;
      let matchIndex = -1;
      for (let i = searchIndex; i < normalizedSource.length; i += 1) {
        if (normalizedSource[i].normalized === target) {
          matchIndex = i;
          break;
        }
      }
      if (matchIndex === -1) return;
      const source = normalizedSource[matchIndex];
      mapped.push({
        text: word.text,
        start: source.start,
        end: source.end,
        speaker_id: source.speaker_id ?? word.speaker_id ?? null,
      });
      searchIndex = matchIndex + 1;
    });

    return mapped;
  };

  const mapWordsToTimeline = (
    words: TranscriptWord[],
    mappings: RangeMapping[]
  ) => {
    if (!mappings.length) return words;
    const tolerance = 0.05;
    let mappingIndex = 0;
    const mapped: TranscriptWord[] = [];

    words.forEach((word) => {
      let mapping = mappings[mappingIndex];
      const wordStart = word.start ?? mapping?.start ?? 0;
      while (
        mappingIndex < mappings.length - 1 &&
        wordStart > (mapping?.end ?? 0) + tolerance
      ) {
        mappingIndex += 1;
        mapping = mappings[mappingIndex];
      }
      if (
        mapping &&
        wordStart >= (mapping.start ?? 0) - tolerance &&
        wordStart <= (mapping.end ?? 0) + tolerance
      ) {
        const offset = Math.max(0, wordStart - mapping.start);
        const start = mapping.timelineStart + offset;
        const duration = Math.max(0.05, (word.end ?? wordStart) - wordStart);
        mapped.push({
          ...word,
          start,
          end: start + duration,
        });
      }
    });

    return mapped;
  };

  const chunkWordsIntoCaptionSegments = (
    words: TranscriptWord[]
  ): CaptionSegment[] => {
    if (!words.length) return [];
    const getCaptionText = (entries: TranscriptWord[]) =>
      entries.map((entry) => entry.text).join(" ").trim();
    const getCharCount = (entries: TranscriptWord[]) =>
      entries.reduce(
        (total, entry, index) =>
          total + entry.text.length + (index > 0 ? 1 : 0),
        0
      );
    const getDuration = (entries: TranscriptWord[]) => {
      const start = entries[0]?.start ?? 0;
      const end = entries[entries.length - 1]?.end ?? start;
      return Math.max(0, end - start);
    };
    const fitsWithinLimits = (entries: TranscriptWord[]) =>
      entries.length <= CAPTION_MAX_WORDS &&
      getCharCount(entries) <= CAPTION_MAX_CHARACTERS &&
      getDuration(entries) <= CAPTION_MAX_DURATION;
    const isSentenceEnd = (word: TranscriptWord) =>
      SENTENCE_END_REGEX.test(word.text.trim());
    const isSoftBreakWord = (word: TranscriptWord) =>
      SOFT_BREAK_REGEX.test(word.text.trim().slice(-1));

    const splitIntoSentences = (entries: TranscriptWord[]) => {
      const sentences: TranscriptWord[][] = [];
      let currentSentence: TranscriptWord[] = [];
      let previous: TranscriptWord | null = null;

      entries.forEach((word) => {
        if (previous) {
          const prevEnd = previous.end ?? previous.start ?? 0;
          const gap = (word.start ?? 0) - prevEnd;
          if (gap >= CAPTION_SENTENCE_GAP && currentSentence.length) {
            sentences.push(currentSentence);
            currentSentence = [];
          }
        }
        currentSentence.push(word);
        if (isSentenceEnd(word)) {
          sentences.push(currentSentence);
          currentSentence = [];
        }
        previous = word;
      });

      if (currentSentence.length) {
        sentences.push(currentSentence);
      }
      return sentences;
    };

    const splitSentenceBySoftBreaks = (sentence: TranscriptWord[]) => {
      const parts: TranscriptWord[][] = [];
      let startIndex = 0;

      while (startIndex < sentence.length) {
        let charCount = 0;
        let lastSoftBreakIndex = -1;
        const startTime = sentence[startIndex]?.start ?? 0;
        let endIndex = startIndex;

        for (; endIndex < sentence.length; endIndex += 1) {
          const word = sentence[endIndex];
          charCount += word.text.length + (endIndex > startIndex ? 1 : 0);
          const wordCount = endIndex - startIndex + 1;
          const endTime = word.end ?? word.start ?? startTime;
          const duration = Math.max(0, endTime - startTime);
          const previousWord =
            endIndex > startIndex ? sentence[endIndex - 1] : null;

          if (isSoftBreakWord(word)) {
            lastSoftBreakIndex = endIndex;
          } else if (previousWord) {
            const prevEnd = previousWord.end ?? previousWord.start ?? 0;
            const gap = (word.start ?? 0) - prevEnd;
            if (gap >= CAPTION_SOFT_BREAK_GAP) {
              lastSoftBreakIndex = endIndex - 1;
            }
          }

          if (
            wordCount > CAPTION_MAX_WORDS ||
            charCount > CAPTION_MAX_CHARACTERS ||
            duration > CAPTION_MAX_DURATION
          ) {
            break;
          }
        }

        if (endIndex >= sentence.length) {
          parts.push(sentence.slice(startIndex));
          break;
        }

        let splitIndex =
          lastSoftBreakIndex >= startIndex ? lastSoftBreakIndex : endIndex - 1;
        if (splitIndex < startIndex) {
          splitIndex = startIndex;
        }
        parts.push(sentence.slice(startIndex, splitIndex + 1));
        startIndex = splitIndex + 1;
      }

      return parts;
    };

    const segments: CaptionSegment[] = [];
    let current: TranscriptWord[] = [];
    const flush = () => {
      if (!current.length) return;
      const text = getCaptionText(current);
      if (!text) {
        current = [];
        return;
      }
      const start = current[0]?.start ?? 0;
      const end = current[current.length - 1]?.end ?? start;
      const duration = Math.max(0.1, end - start);
      segments.push({ text, start, duration });
      current = [];
    };

    const sentences = splitIntoSentences(words);
    sentences.forEach((sentence) => {
      if (!sentence.length) return;
      if (!fitsWithinLimits(sentence)) {
        flush();
        splitSentenceBySoftBreaks(sentence).forEach((part) => {
          if (!part.length) return;
          const text = getCaptionText(part);
          if (!text) return;
          const start = part[0]?.start ?? 0;
          const end = part[part.length - 1]?.end ?? start;
          const duration = Math.max(0.1, end - start);
          segments.push({ text, start, duration });
        });
        return;
      }
      const combined = current.concat(sentence);
      if (current.length && !fitsWithinLimits(combined)) {
        flush();
        current = sentence.slice();
        return;
      }
      current = combined;
    });
    flush();
    return segments;
  };

  const buildCaptionDebugSegments = (
    sourceWords: TranscriptWord[],
    trimmedWords: TranscriptWord[],
    totalDuration: number
  ) => {
    if (!trimmedWords.length) return [];
    const keepRanges = buildKeepRangesFromWords(
      sourceWords,
      trimmedWords,
      totalDuration,
      MIN_CLIP_DURATION_SECONDS
    );
    let rangeMappings: RangeMapping[] = [];
    if (keepRanges.length) {
      let accumulated = 0;
      rangeMappings = keepRanges.map((range) => {
        const length = range.end - range.start;
        const mapping = {
          start: range.start,
          end: range.end,
          timelineStart: accumulated,
        };
        accumulated += length;
        return mapping;
      });
    }
    const mappedSourceWords = mapTrimmedWordsToSource(sourceWords, trimmedWords);
    const retimedWords = rangeMappings.length
      ? mapWordsToTimeline(mappedSourceWords, rangeMappings)
      : mappedSourceWords;
    return chunkWordsIntoCaptionSegments(retimedWords);
  };

  const buildCaptionDebugMap = (
    sourceWords: TranscriptWord[],
    refinement: GeminiRefinement
  ) => {
    if (!sourceWords.length) return null;
    const totalDuration =
      sourceVideoDuration ||
      timelineDuration ||
      sourceWords[sourceWords.length - 1]?.end ||
      0;
    const output: Record<string, CaptionSegment[]> = {};
    if (refinement.concepts.length) {
      refinement.concepts.forEach((concept, index) => {
        const title = concept.title?.trim() || "";
        const label = title ? `${index + 1}. ${title}` : `Option ${index + 1}`;
        const key = concept.id ? `${label} (${concept.id})` : label;
        output[key] = buildCaptionDebugSegments(
          sourceWords,
          concept.trimmed_words,
          totalDuration
        );
      });
    } else {
      output["Trimmed result"] = buildCaptionDebugSegments(
        sourceWords,
        refinement.trimmed_words,
        totalDuration
      );
    }
    return output;
  };

  const resetCaptionFormattingFlags = () => {
    captionStyleAppliedRef.current = false;
    captionPresetAppliedRef.current = false;
  };

  const ensureCaptionsTrack = (engine: CreativeEngineInstance) => {
    const pageId = pageRef.current;
    if (!pageId || !engine.block.isValid(pageId)) return null;
    if (captionsTrackRef.current && engine.block.isValid(captionsTrackRef.current)) {
      return captionsTrackRef.current;
    }
    try {
      const track = engine.block.create(CAPTIONS_TRACK_TYPE);
      engine.block.appendChild(pageId, track);
      try {
        engine.block.setBool(
          track,
          "captionTrack/automaticallyManageBlockOffsets",
          false
        );
      } catch (autoError) {
        console.warn("Failed to configure caption track", autoError);
      }
      captionsTrackRef.current = track;
      resetCaptionFormattingFlags();
      return track;
    } catch (error) {
      console.warn("Failed to create captions track", error);
      captionsTrackRef.current = null;
      return null;
    }
  };

  const clearCaptionsTrack = (engine?: CreativeEngineInstance | null) => {
    const runtimeEngine = engine ?? engineRef.current;
    if (!runtimeEngine) {
      resetCaptionFormattingFlags();
      return;
    }
    const trackId = captionsTrackRef.current;
    if (!trackId || !runtimeEngine.block.isValid(trackId)) {
      resetCaptionFormattingFlags();
      return;
    }
    const entries = runtimeEngine.block.getChildren(trackId) ?? [];
    entries.forEach((entry) => {
      if (runtimeEngine.block.isValid(entry)) {
        runtimeEngine.block.destroy(entry);
      }
    });
    resetCaptionFormattingFlags();
  };

  const applyCaptionVisibility = useCallback(
    (enabled: boolean, engineOverride?: CreativeEngineInstance | null) => {
      const engine = engineOverride ?? engineRef.current;
      const trackId = captionsTrackRef.current;
      if (!engine || !trackId || !engine.block.isValid(trackId)) return;
      const targets = [trackId, ...(engine.block.getChildren(trackId) ?? [])];
      targets.forEach((targetId) => {
        if (!engine.block.isValid(targetId)) return;
        try {
          engine.block.setVisible(targetId, enabled);
        } catch (error) {
          console.warn("Failed to update caption visibility", error);
        }
        try {
          engine.block.setIncludedInExport(targetId, enabled);
        } catch (error) {
          console.warn("Failed to update caption export state", error);
        }
      });
    },
    []
  );

  const clearTextHook = useCallback(
    (engineOverride?: CreativeEngineInstance | null) => {
      const engine = engineOverride ?? engineRef.current;
      if (
        engine &&
        textHookBlockRef.current &&
        engine.block.isValid(textHookBlockRef.current)
      ) {
        engine.block.destroy(textHookBlockRef.current);
      }
      textHookBlockRef.current = null;
    },
    []
  );

  const applyTextHookVisibility = useCallback(
    (enabled: boolean, engineOverride?: CreativeEngineInstance | null) => {
      const engine = engineOverride ?? engineRef.current;
      const textId = textHookBlockRef.current;
      if (!engine || !textId || !engine.block.isValid(textId)) return;
      try {
        engine.block.setVisible(textId, enabled);
      } catch (error) {
        console.warn("Failed to update text hook visibility", error);
      }
      try {
        engine.block.setIncludedInExport(textId, enabled);
      } catch (error) {
        console.warn("Failed to update text hook export state", error);
      }
    },
    []
  );

  const ensureTextHookBlock = (engine: CreativeEngineInstance) => {
    const pageId = pageRef.current;
    if (!pageId || !engine.block.isValid(pageId)) return null;
    if (textHookBlockRef.current && engine.block.isValid(textHookBlockRef.current)) {
      return textHookBlockRef.current;
    }
    try {
      const textId = engine.block.create("text");
      engine.block.appendChild(pageId, textId);
      textHookBlockRef.current = textId;
      return textId;
    } catch (error) {
      console.warn("Failed to create text hook block", error);
      textHookBlockRef.current = null;
      return null;
    }
  };

  const updateTextHookLayout = (
    engine: CreativeEngineInstance,
    textId: number,
    duration: number
  ) => {
    const pageId = pageRef.current;
    if (!pageId || !engine.block.isValid(pageId)) return;
    const sceneWidth = engine.block.getWidth(pageId);
    const sceneHeight = engine.block.getHeight(pageId);
    if (!Number.isFinite(sceneWidth) || !Number.isFinite(sceneHeight)) return;
    try {
      const sceneRatio = sceneWidth / sceneHeight;
      const hookWidth = sceneRatio >= 1 ? 0.6 : 0.8;
      const hookHeight = 0.25;
      engine.block.setWidthMode(textId, "Percent");
      engine.block.setWidth(textId, hookWidth);
      engine.block.setHeightMode(textId, "Percent");
      engine.block.setHeight(textId, hookHeight);
      engine.block.setPositionXMode(textId, "Percent");
      engine.block.setPositionX(textId, (1 - hookWidth) / 2);
      engine.block.setPositionYMode(textId, "Percent");
      engine.block.setPositionY(textId, (1 - hookHeight) / 2);
      const minSide = Math.min(sceneWidth, sceneHeight);
      const padding = Math.max(10, Math.round(minSide * 0.015));
      engine.block.setBool(textId, "backgroundColor/enabled", true);
      engine.block.setColor(textId, "backgroundColor/color", {
        r: 1,
        g: 1,
        b: 1,
        a: 1,
      });
      engine.block.setFloat(textId, "backgroundColor/paddingLeft", padding);
      engine.block.setFloat(textId, "backgroundColor/paddingRight", padding);
      engine.block.setFloat(textId, "backgroundColor/paddingTop", padding * 0.75);
      engine.block.setFloat(
        textId,
        "backgroundColor/paddingBottom",
        padding * 0.75
      );
      engine.block.setFloat(textId, "backgroundColor/cornerRadius", padding * 0.6);
      engine.block.setDuration(textId, Math.max(0.1, duration));
      engine.block.setTimeOffset(textId, 0);
    } catch (error) {
      console.warn("Failed to update text hook layout", error);
    }
  };

  const applyTextHook = useCallback(
    (text: string | null, duration: number) => {
      textHookTextRef.current = text;
      textHookDurationRef.current = duration;
      const engine = engineRef.current;
      if (!engine) return;
      if (!text) {
        clearTextHook(engine);
        return;
      }
      const textId = ensureTextHookBlock(engine);
      if (!textId) return;
      try {
        engine.block.replaceText(textId, text);
        engine.block.setEnum(textId, "text/horizontalAlignment", "Center");
        engine.block.setEnum(textId, "text/verticalAlignment", "Center");
        engine.block.setBool(textId, "text/automaticFontSizeEnabled", true);
        engine.block.setDouble(textId, "text/minAutomaticFontSize", 1);
        engine.block.setDouble(textId, "text/maxAutomaticFontSize", 50);
        engine.block.setFloat(textId, "text/lineHeight", 1.1);
        engine.block.setTextColor(textId, {
          r: 0,
          g: 0,
          b: 0,
          a: 1,
        });
        engine.block.setBool(textId, "alwaysOnTop", true);
        updateTextHookLayout(engine, textId, duration);
        applyTextHookVisibility(textHookEnabled, engine);
      } catch (error) {
        console.warn("Failed to apply text hook styling", error);
      }
    },
    [applyTextHookVisibility, clearTextHook, textHookEnabled]
  );

  const handleRemoveVideo = useCallback(() => {
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (engine && pageId && engine.block.isValid(pageId)) {
      try {
        engine.block.setPlaying(pageId, false);
      } catch (error) {
        console.warn("Failed to stop playback before reset", error);
      }
      try {
        engine.block.setPlaybackTime(pageId, 0);
      } catch (error) {
        console.warn("Failed to reset playback time", error);
      }
    }

    if (engine) {
      clearVideoBlocks(engine);
      clearCaptionsTrack(engine);
      clearFaceOverlays(engine);
    }

    setVideoFile(null);
    resetWorkflowState();
    resetPreloadState();
    setSpeakerTemplateId("none");
    setTimelineDuration(0);
    setTimelinePosition(0);
    setIsPlaying(false);
    setTimelineSegments([]);
    setIsScrubbingTimeline(false);
    setIsExtracting(false);
    setIsTranscribing(false);
    setCurrentTranscriptWords([]);
    setSourceVideoDuration(0);
    setSourceVideoSize(null);
    setAnalysisEstimate(null);
    setAnalysisStage(null);
    setAnalysisStartAt(null);
    setIsFaceCropPending(false);
    setCaptionsEnabled(true);
    setTextHookEnabled(true);
    setTranscriptDebug(null);
    setGeminiDebug(null);
    setGeminiFaceDebug(null);
    setGeminiFaceThumbnail(null);
    setDebugExportMetrics(null);
    setCaptionDebug(null);
    setIsDebugOpen(false);
    setIsFaceDebugLoading(false);
    setProgress(0);
    setIsDropActive(false);
    setIsExporting(false);
    setExportError(null);
    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;
    textHookTextRef.current = null;
    textHookDurationRef.current = HOOK_DURATION_SECONDS;
  }, [
    clearCaptionsTrack,
    clearFaceOverlays,
    clearVideoBlocks,
    resetPreloadState,
    resetWorkflowState,
  ]);

  const applyCaptionsForWords = async (
    words: TranscriptWord[],
    options?: {
      retime?: boolean;
      rangeMappings?: RangeMapping[];
      sourceWords?: TranscriptWord[];
    }
  ) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (!words.length) {
      clearCaptionsTrack(engine);
      return;
    }
    const trackId = ensureCaptionsTrack(engine);
    if (!trackId) return;
    const shouldRetime = options?.retime ?? false;
    const sourceWords = options?.sourceWords ?? [];
    const mappedSourceWords = sourceWords.length
      ? mapTrimmedWordsToSource(sourceWords, words)
      : words;
    const mappedWords = options?.rangeMappings?.length
      ? mapWordsToTimeline(mappedSourceWords, options.rangeMappings)
      : mappedSourceWords;
    const baseWords = shouldRetime
      ? retimeWordsSequentially(mappedWords)
      : mappedWords;
    const segments = chunkWordsIntoCaptionSegments(baseWords);
    clearCaptionsTrack(engine);
    if (!segments.length) return;
    const firstCaption = engine.block.create(CAPTION_ENTRY_TYPE);
    engine.block.appendChild(trackId, firstCaption);
    await applyCaptionPreset(firstCaption);
    styleCaptionEntry(firstCaption);
    segments.forEach((segment, index) => {
      const captionEntry =
        index === 0 ? firstCaption : engine.block.duplicate(firstCaption, false);
      engine.block.setString(captionEntry, "caption/text", segment.text);
      engine.block.setTimeOffset(captionEntry, Math.max(0, segment.start));
      engine.block.setDuration(captionEntry, Math.max(0.1, segment.duration));
      if (index !== 0) {
        engine.block.appendChild(trackId, captionEntry);
      }
    });
    applyCaptionVisibility(captionsEnabled, engine);
  };

  const styleCaptionEntry = (captionId: number) => {
    const engine = engineRef.current;
    if (
      !engine ||
      !engine.block.isValid(captionId) ||
      captionStyleAppliedRef.current
    ) {
      return;
    }
    const apply = (setter: () => void, label: string) => {
      try {
        setter();
      } catch (error) {
        console.warn(`Failed to set caption ${label}`, error);
      }
    };
    apply(() => engine.block.setPositionX(captionId, 0.10), "posX");
    apply(() => engine.block.setPositionXMode(captionId, "Percent"), "posX mode");
    apply(() => engine.block.setPositionY(captionId, 0.70), "posY");
    apply(() => engine.block.setPositionYMode(captionId, "Percent"), "posY mode");
    apply(() => engine.block.setWidth(captionId, 0.8), "width");
    apply(() => engine.block.setWidthMode(captionId, "Percent"), "width mode");
    apply(() => engine.block.setHeight(captionId, 0.25), "height");
    apply(() => engine.block.setHeightMode(captionId, "Percent"), "height mode");
    apply(
      () => engine.block.setBool(captionId, "caption/automaticFontSizeEnabled", true),
      "auto font size"
    );
    apply(() => engine.block.setDouble(captionId, "caption/maxAutomaticFontSize", 100), "min font size");
    apply(() => engine.block.setDouble(captionId, "caption/minAutomaticFontSize", 1), "max font size");
    captionStyleAppliedRef.current = true;
  };

  const applyCaptionPreset = async (captionId: number) => {
    if (captionPresetAppliedRef.current) return;
    const engine = engineRef.current;
    if (!engine || !engine.block.isValid(captionId)) return;
    try {
      const preset = await engine.asset.fetchAsset(
        "ly.img.captionPresets",
        "//ly.img.captionPresets/outline"
      );
      if (!preset) return;
      await engine.asset.applyToBlock(
        "ly.img.captionPresets",
        preset,
        captionId
      );
      captionPresetAppliedRef.current = true;
    } catch (error) {
      console.warn("Failed to apply caption preset", error);
    }
  };

  const applyTranscriptCuts = async (
    sourceWords: TranscriptWord[],
    refinedWords: TranscriptWord[],
    hookText?: string | null
  ) => {
    const engine = engineRef.current;
    if (!engine || !sourceWords.length || !refinedWords.length) return;
    if (audioBlockRef.current && engine.block.isValid(audioBlockRef.current)) {
      try {
        engine.block.destroy(audioBlockRef.current);
      } catch (error) {
        console.warn("Failed to remove audio block for results", error);
      }
    }
    audioBlockRef.current = null;

    applySceneAspectRatio(
      targetAspectRatioId,
      sourceVideoSize ?? { width: 1920, height: 1080 }
    );

    const trackId = ensureVideoTrack(engine);
    if (!trackId) return;
    setVideoTrackAutoManage(engine, trackId, true);

    const templateSource =
      (videoTemplateRef.current &&
        engine.block.isValid(videoTemplateRef.current) &&
        videoTemplateRef.current) ||
      (videoBlockRef.current && engine.block.isValid(videoBlockRef.current)
        ? videoBlockRef.current
        : null);

    if (!templateSource) return;

    const templateFill = engine.block.getFill(templateSource);
    if (!templateFill) return;

    try {
      await engine.block.forceLoadAVResource(templateFill);
    } catch (error) {
      console.warn("Failed to load video metadata", error);
    }

    let totalDuration = 0;
    try {
      totalDuration = engine.block.getDouble(
        templateFill,
        "fill/video/totalDuration"
      );
    } catch (error) {
      console.warn("Failed to read video duration", error);
    }
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
      totalDuration =
        timelineDuration ||
        (pageRef.current ? engine.block.getDuration(pageRef.current) : 0);
    }

    const keepRanges = buildKeepRangesFromWords(
      sourceWords,
      refinedWords,
      totalDuration,
      MIN_CLIP_DURATION_SECONDS
    );

    if (!keepRanges.length) {
      console.warn("Gemini refinement did not match any transcript ranges.");
      return;
    }

    const speakerResolvedWords = mapTrimmedWordsToSource(
      sourceWords,
      refinedWords
    );
    const speakerWords = speakerResolvedWords.length
      ? speakerResolvedWords
      : sourceWords;
    const splitRanges = splitRangesBySpeaker(keepRanges, speakerWords);
    const resolvedKeepRanges = splitRanges.length ? splitRanges : keepRanges;

    if (
      !videoTemplateRef.current ||
      !engine.block.isValid(videoTemplateRef.current)
    ) {
      try {
        videoTemplateRef.current = engine.block.duplicate(templateSource, false);
      } catch (error) {
        console.warn("Failed to create persistent video template", error);
      }
    }

    const duplicationTemplate =
      videoTemplateRef.current && engine.block.isValid(videoTemplateRef.current)
        ? videoTemplateRef.current
        : templateSource;

    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;

    const templateId = speakerTemplateIdRef.current;
    const shouldUseTemplate =
      templateId !== "none" &&
      templateId !== "solo" &&
      canApplySpeakerTemplate();
    clearTemplateLayout(engine, {
      showBase: !shouldUseTemplate,
    });

    const existingChildren = engine.block.getChildren(trackId) ?? [];
    existingChildren.forEach((child) => {
      if (engine.block.isValid(child)) {
        engine.block.destroy(child);
      }
    });

    const clipIds: number[] = [];
    const clipRanges: TimeRange[] = [];
    resolvedKeepRanges.forEach((range) => {
      const length = range.end - range.start;
      if (length <= 0.01) return;
      let clip: number;
      try {
        clip = engine.block.duplicate(duplicationTemplate, false);
      } catch (error) {
        console.warn("Failed to duplicate video clip", error);
        return;
      }
      disableBlockHighlight(engine, clip);
      const clipFill = engine.block.getFill(clip);
      if (!clipFill) return;
      engine.block.setTrimOffset(clipFill, range.start);
      engine.block.setTrimLength(clipFill, length);
      engine.block.setDuration(clip, length);
      engine.block.appendChild(trackId, clip);
      clipIds.push(clip);
      clipRanges.push(range);
    });

    baseClipIdsRef.current = clipIds.slice();
    clipRangesRef.current = clipRanges.slice();
    setBaseClipVisibility(engine, true);

    if (!clipIds.length) {
      console.warn("No clips generated after applying transcript cuts.");
      return;
    }

    if (pageRef.current) {
      const sceneWidth = engine.block.getWidth(pageRef.current);
      const sceneHeight = engine.block.getHeight(pageRef.current);
      const sourceSize =
        sourceVideoSize ?? { width: 1920, height: 1080 };
      if (
        Number.isFinite(sceneWidth) &&
        Number.isFinite(sceneHeight)
      ) {
        syncVideoLayoutToScene(
          engine,
          sceneWidth,
          sceneHeight,
          sourceSize.width,
          sourceSize.height
        );
      }
    }

    videoBlockRef.current = clipIds[0];
    const newDuration = resolvedKeepRanges.reduce(
      (sum, range) => sum + (range.end - range.start),
      0
    );

    if (pageRef.current) {
      engine.block.setDuration(pageRef.current, newDuration);
    }
    setTimelineDuration(newDuration);
    let accumulated = 0;
    const rangeMappings: RangeMapping[] = resolvedKeepRanges.map((range) => {
      const length = range.end - range.start;
      const mapping = {
        start: range.start,
        end: range.end,
        timelineStart: accumulated,
      };
      accumulated += length;
      return mapping;
    });
    const segments = rangeMappings.map((mapping) => ({
      start: mapping.timelineStart,
      end: mapping.timelineStart + (mapping.end - mapping.start),
    }));
    setTimelineSegments(segments);
    setTimelinePosition(0);
    setIsPlaying(false);
    if (pageRef.current && engine.block.supportsPlaybackTime(pageRef.current)) {
      try {
        engine.block.setPlaying(pageRef.current, false);
        engine.block.setPlaybackTime(pageRef.current, 0);
      } catch (error) {
        console.warn("Failed to reset playback time", error);
      }
    }
    setAudioPlaybackMuted(true);
    await applyCaptionsForWords(refinedWords, { rangeMappings, sourceWords });
    const hookDuration = Math.min(
      HOOK_DURATION_SECONDS,
      newDuration || HOOK_DURATION_SECONDS
    );
    const resolvedHookText =
      coerceHookText(hookText) ?? buildHookTextFromWords(refinedWords);
    applyTextHook(resolvedHookText, hookDuration);
    const clipSpeakerMap = new Map<number, string | null>();
    clipRanges.forEach((range, index) => {
      const speakerId = resolveSpeakerForRange(range, speakerWords);
      const clipId = clipIds[index];
      if (typeof clipId === "number") {
        clipSpeakerMap.set(clipId, speakerId);
      }
    });
    clipSpeakerMapRef.current = clipSpeakerMap;
    if (templateId === "solo") {
      void applySoloFaceCropping(clipIds);
    } else {
      const speakerFallbackFaces = buildSpeakerAssignments(
        speakerAssignmentsRef.current,
        speakerFaceSlots,
        primaryFaceSlots
      );
      void applyFaceAwareCropping(
        clipIds,
        undefined,
        clipSpeakerMap,
        speakerAssignmentsRef.current,
        speakerFallbackFaces
      );
      if (shouldUseTemplate) {
        void applySpeakerTemplate(templateId);
      }
    }
  };

  const getTranscriptWordsSnapshot = (): TranscriptWord[] => {
    if (currentTranscriptWords.length) {
      return currentTranscriptWords;
    }
    return [];
  };

  const openEditor = () => {
    if (!isEngineReady) return;
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
  };

  const handleExport = async () => {
    if (isExporting) return;
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId || !engine.block.isValid(pageId)) {
      setExportError("Video is not ready to export yet.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const blob = await engine.block.exportVideo(pageId, {
        mimeType: "video/mp4",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = videoFile?.name
        ? videoFile.name.replace(/\.[^/.]+$/, "")
        : "video-short";
      link.href = url;
      link.download = `${baseName}-short.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export video", error);
      setExportError(
        error instanceof Error ? error.message : "Failed to export video."
      );
    } finally {
      setIsExporting(false);
    }
  };

  const hasVideo = Boolean(videoFile);
  const isWorkflowProcessing =
    autoProcessing || isExtracting || isTranscribing || isSpeakerIdentificationActive;
  const showTrimStage = hasVideo && (!hasStartedWorkflow || autoProcessingError);
  const showProcessingStage =
    hasVideo && hasStartedWorkflow && isWorkflowProcessing;
  const showResultStage =
    hasVideo &&
    hasStartedWorkflow &&
    !isWorkflowProcessing &&
    !autoProcessingError;
  const showUploadStage = !hasVideo;
  const showSetupStage = !showProcessingStage && !showResultStage;
  const showInlinePreview = showSetupStage;
  const showFullPreview = showResultStage;
  const shouldShowOverlayControls = showResultStage;
  const isPortraitResult = showResultStage && targetAspectRatioId === "9:16";
  const sourceAspectRatio = sourceVideoSize
    ? sourceVideoSize.width / sourceVideoSize.height
    : DEFAULT_ASPECT_RATIO;
  const previewAspectRatio = showResultStage
    ? targetAspectRatio
    : sourceAspectRatio;
  const activeSpeakerSnippet =
    activeSpeakerId &&
    speakerSnippets.find((snippet) => snippet.id === activeSpeakerId);
  const availableOptions = faceOptions.filter((option) =>
    availableFaceSlots.includes(option.slotIndex)
  );
  const assignedFaceSlots = Object.values(speakerAssignments).filter(
    (slot) => typeof slot === "number" && Number.isFinite(slot)
  );
  const uniqueAssignedSlots = new Set(assignedFaceSlots);
  const canShowTemplate =
    showResultStage &&
    speakerSnippets.length > 1 &&
    uniqueAssignedSlots.size > 1;
  const speakerQuestion =
    isSpeakerIdentificationActive && activeSpeakerSnippet
      ? {
          speaker: activeSpeakerSnippet,
          index: (() => {
            const idx = speakerSnippets.findIndex(
              (snippet) => snippet.id === activeSpeakerId
            );
            return idx === -1 ? 1 : idx + 1;
          })(),
          total: speakerSnippets.length,
          isPlaying: isSpeakerAudioPlaying,
          hasPlayed: hasPlayedSpeakerAudio,
          canPlay: isEngineReady,
          faceOptions: availableOptions,
          onPlay: () => playSpeakerSnippet(activeSpeakerSnippet),
          onSelect: (face: SpeakerFaceThumbnail) =>
            void handleFaceSelection(face),
        }
      : null;
  const resolveSpeakerLabel = (
    speakerId: string,
    fallbackIndex?: number
  ) => {
    const match = speakerSnippets.find((snippet) => snippet.id === speakerId);
    if (match?.label) return match.label;
    if (speakerId && speakerId !== "unknown") {
      return `Speaker ${speakerId}`;
    }
    if (typeof fallbackIndex === "number") {
      return `Speaker ${fallbackIndex + 1}`;
    }
    return "Unknown speaker";
  };
  const resolveSpeakerThumbnail = (speakerId: string) => {
    const assigned = speakerAssignedThumbnails[speakerId];
    if (assigned) return assigned;
    const assignedSlot = speakerAssignments[speakerId];
    if (typeof assignedSlot === "number" && Number.isFinite(assignedSlot)) {
      const match = speakerThumbnails.find(
        (thumb) =>
          thumb.speakerId === speakerId && thumb.slotIndex === assignedSlot
      );
      if (match) return match;
      const slotMatch = Object.values(speakerAssignedThumbnails).find(
        (thumb) => thumb.slotIndex === assignedSlot
      );
      if (slotMatch) return slotMatch;
      const slotFallback = speakerThumbnails.find(
        (thumb) => thumb.slotIndex === assignedSlot
      );
      if (slotFallback) return slotFallback;
    }
    return (
      speakerThumbnails.find((thumb) => thumb.speakerId === speakerId) ?? null
    );
  };
  const getSpeakerPreviewThumbnails = (speakerId: string) => {
    const thumbnail = resolveSpeakerThumbnail(speakerId);
    return thumbnail ? [thumbnail] : [];
  };
  const buildSpeakerPreviews = (words: TranscriptWord[]): SpeakerPreview[] => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    words.forEach((word) => {
      const speakerId = word.speaker_id ?? "unknown";
      if (!seen.has(speakerId)) {
        seen.add(speakerId);
        ordered.push(speakerId);
      }
    });
    return ordered.map((speakerId, index) => ({
      id: speakerId,
      label: resolveSpeakerLabel(speakerId, index),
      thumbnails: getSpeakerPreviewThumbnails(speakerId),
    }));
  };
  const conceptSpeakerPreviews: Record<string, SpeakerPreview[]> = {};
  conceptChoices.forEach((concept) => {
    const trimmedWords = concept.trimmed_words ?? [];
    const resolvedWords = mapTrimmedWordsToSourceOrFallback(
      currentTranscriptWords,
      trimmedWords
    );
    conceptSpeakerPreviews[concept.id] = buildSpeakerPreviews(resolvedWords);
  });
  const activeSpeakerPreview = (() => {
    if (!showResultStage || !timelineSegments.length) return null;
    const clampedTime = Math.max(0, Math.min(timelinePosition, timelineDuration));
    let segmentIndex = timelineSegments.findIndex(
      (segment) => clampedTime >= segment.start && clampedTime < segment.end
    );
    if (segmentIndex === -1 && timelineSegments.length) {
      const lastIndex = timelineSegments.length - 1;
      if (clampedTime >= timelineSegments[lastIndex].end) {
        segmentIndex = lastIndex;
      }
    }
    if (segmentIndex === -1) return null;
    const clipId = baseClipIdsRef.current[segmentIndex];
    if (typeof clipId !== "number") return null;
    const speakerId = clipSpeakerMapRef.current.get(clipId) ?? null;
    if (!speakerId) return null;
    return {
      id: speakerId,
      label: resolveSpeakerLabel(speakerId),
      thumbnail: resolveSpeakerThumbnail(speakerId),
    };
  })();

  const handleAspectRatioChange = (ratioId: string) => {
    setTargetAspectRatioId(ratioId);
    if (showResultStage) {
      applySceneAspectRatio(ratioId);
      const engine = engineRef.current;
      if (
        engine &&
        textHookBlockRef.current &&
        engine.block.isValid(textHookBlockRef.current)
      ) {
        updateTextHookLayout(
          engine,
          textHookBlockRef.current,
          textHookDurationRef.current
        );
      }
      if (
        speakerTemplateIdRef.current === "solo"
      ) {
        clearTemplateLayout();
        void applySoloFaceCropping();
      } else if (
        speakerTemplateIdRef.current !== "none" &&
        canApplySpeakerTemplate()
      ) {
        void applySpeakerTemplate(speakerTemplateIdRef.current);
      } else {
        const speakerFallbackFaces = buildSpeakerAssignments(
          speakerAssignmentsRef.current,
          speakerFaceSlots,
          primaryFaceSlots
        );
        void applyFaceAwareCropping(
          undefined,
          ratioId,
          clipSpeakerMapRef.current,
          speakerAssignmentsRef.current,
          speakerFallbackFaces
        );
      }
    }
  };

  useEffect(() => {
    applyCaptionVisibility(captionsEnabled);
  }, [applyCaptionVisibility, captionsEnabled]);

  useEffect(() => {
    if (textHookEnabled) {
      if (textHookTextRef.current) {
        applyTextHook(textHookTextRef.current, textHookDurationRef.current);
      }
    } else {
      applyTextHookVisibility(false);
    }
  }, [applyTextHook, applyTextHookVisibility, textHookEnabled]);

  useEffect(() => {
    if (!showResultStage) {
      clearTemplateLayout();
      return;
    }
    if (speakerTemplateId === "solo") {
      clearTemplateLayout();
      void applySoloFaceCropping();
    } else if (speakerTemplateId !== "none" && canApplySpeakerTemplate()) {
      void applySpeakerTemplate(speakerTemplateId);
    } else {
      clearTemplateLayout();
      const speakerFallbackFaces = buildSpeakerAssignments(
        speakerAssignmentsRef.current,
        speakerFaceSlots,
        primaryFaceSlots
      );
      void applyFaceAwareCropping(
        undefined,
        targetAspectRatioId,
        clipSpeakerMapRef.current,
        speakerAssignmentsRef.current,
        speakerFallbackFaces
      );
    }
  }, [
    applySpeakerTemplate,
    applyFaceAwareCropping,
    applySoloFaceCropping,
    clearTemplateLayout,
    showResultStage,
    speakerAssignments,
    speakerSnippets,
    speakerTemplateId,
    targetAspectRatioId,
  ]);

  useEffect(() => {
    if (!showResultStage || !isEngineReady) return;
    const engine = engineRef.current;
    const pageId = pageRef.current;
    if (!engine || !pageId) return;

    const zoomToPage = () => {
      engine.scene.zoomToBlock(pageId, { padding: 0 }).catch((error) => {
        console.warn("Failed to zoom after result layout", error);
      });
    };

    let raf1: number | null = null;
    let raf2: number | null = null;
    let timeoutId: number | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(zoomToPage);
    });
    timeoutId = window.setTimeout(zoomToPage, 550);

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [showResultStage, isEngineReady, targetAspectRatioId]);

  const isUploadDisabled =
    !isEngineReady || isExtracting || isTranscribing || autoProcessing;
  const isStartDisabled =
    autoProcessing ||
    !videoFile ||
    !isEngineReady ||
    isTranscribing ||
    isExtracting;

  const previewCanvasProps = {
    videoFile,
    isEngineReady,
    engineInitError,
    isUploadDisabled,
    isDropActive,
    onUploadClick: handleUploadClick,
    onUploadKeyDown: handleUploadKeyDown,
    onDragEnter: handleUploadDragOver,
    onDragOver: handleUploadDragOver,
    onDragLeave: handleUploadDragLeave,
    onDrop: handleUploadDrop,
    onFileChange: handleFileChange,
    onOpenEditor: openEditor,
    onExport: handleExport,
    isExporting,
    aspectRatio: previewAspectRatio,
    isPlaying,
    timelineDuration,
    onTogglePlayback: togglePlayback,
    fileInputRef,
    isFaceCropPending: showResultStage && isFaceCropPending,
  };

  const panelMotionClass = `relative w-full transition-all duration-500 ease-out ${
    showResultStage ? "max-w-none" : "max-w-2xl"
  }`;

  const previewMotionClass = `w-full overflow-hidden transition-all duration-500 ease-out ${
    showFullPreview
      ? "max-h-[1000px] opacity-100 scale-100"
      : "max-h-0 opacity-0 scale-95 pointer-events-none"
  } ${
    showResultStage
      ? "lg:opacity-100 lg:translate-y-0 delay-150 max-w-none"
      : "mx-auto max-w-2xl"
  }`;

  const panelOrderClass = "order-1";
  const previewOrderClass = "order-2";
  const transcriptDebugText = transcriptDebug
    ? JSON.stringify(transcriptDebug, null, 2)
    : null;
  const captionDebugText = captionDebug
    ? JSON.stringify(captionDebug, null, 2)
    : null;
  const geminiFaceDebugText = geminiFaceDebug ?? null;
  const geminiFaceThumbnailUrl = geminiFaceThumbnail ?? null;
  const debugExportMetricsText = debugExportMetrics ?? null;
  const heroCopy = showProcessingStage
    ? {
        title: "Hang on, we're processing your video.",
        subtitle: "Please don't close your browser.",
      }
    : showResultStage
      ? {
          title: "Your clips are ready.",
          subtitle: "Review, save or edit.",
        }
      : {
          title: "Turn long videos into viral shorts with a click.",
          subtitle:
            "The fastest AI video clipping tool with infinite styling options.",
        };

  return (
    <ThemeProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <AppHeader onLogoClick={handleRemoveVideo} />

        <main className="flex-1">
          <div className="container py-10">
            <div className="mb-10 text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {heroCopy.title}
              </h1>
              <h2 className="mt-2 text-sm text-muted-foreground sm:text-base">
                {heroCopy.subtitle}
              </h2>
            </div>
            <div
              className={
                showResultStage
                  ? `mx-auto grid w-full max-w-6xl gap-8 ${
                      isPortraitResult
                        ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]"
                        : "lg:grid-cols-2"
                    }`
                  : "flex flex-col items-center"
              }
            >
              <div className={`${panelMotionClass} ${panelOrderClass}`}>
                <div className="relative">
                  <div
                    className={`transition-opacity duration-300 ${
                      showSetupStage
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none absolute inset-0"
                    }`}
                  >
                    <TrimFocusCard
                      refinementMode={refinementMode}
                      onRefinementModeChange={setRefinementMode}
                      autoProcessing={autoProcessing}
                      isStartDisabled={isStartDisabled}
                      onStart={runAutomaticWorkflow}
                      aspectRatioId={targetAspectRatioId}
                      onAspectRatioChange={handleAspectRatioChange}
                      showAspectRatio={showTrimStage}
                      showOptions={!showUploadStage}
                      showAction={!showUploadStage}
                      layout={showUploadStage ? "full" : "split"}
                      preview={
                        <PreviewCanvas
                          {...previewCanvasProps}
                          className={
                            showUploadStage
                              ? "rounded-none border-0"
                              : "rounded-lg"
                          }
                          enableUpload={showUploadStage}
                          showControls={false}
                          showPlaybackControls={showTrimStage}
                          engineCanvasContainerRef={
                            showInlinePreview
                              ? engineCanvasContainerRef
                              : undefined
                          }
                        />
                      }
                      previewFooter={
                        showTrimStage ? (
                          <div className="flex flex-col items-center gap-2">
                            <button
                              type="button"
                              onClick={handleRemoveVideo}
                              className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
                            >
                              Remove video
                            </button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleGeminiFaceDebug}
                              disabled={isFaceDebugLoading}
                            >
                              {isFaceDebugLoading
                                ? "Detecting faces..."
                                : "Debug speaker boxes"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleTinyDebugExport}
                              disabled={isFaceDebugLoading}
                            >
                              Tiny export test
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                setIsImportScriptOpen((prev) => !prev)
                              }
                            >
                              {isImportScriptOpen
                                ? "Hide import script"
                                : "Import preload script"}
                            </Button>
                            {isImportScriptOpen && (
                              <div className="w-full max-w-md rounded-lg border bg-muted/20 p-3 text-left">
                                <label className="text-xs font-medium text-foreground">
                                  Preload script
                                </label>
                                <textarea
                                  value={importScriptText}
                                  onChange={(event) => {
                                    setImportScriptText(event.target.value);
                                    if (importScriptError) {
                                      setImportScriptError(null);
                                    }
                                  }}
                                  placeholder="Paste the exported preload script JSON here."
                                  className="mt-2 h-28 w-full resize-none rounded-md border bg-background px-3 py-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                                />
                                {importScriptError && (
                                  <p className="mt-2 text-xs text-destructive">
                                    {importScriptError}
                                  </p>
                                )}
                                <div className="mt-3 flex items-center justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setIsImportScriptOpen(false);
                                      setImportScriptError(null);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={handleImportPreloadScript}
                                    disabled={isImportingScript}
                                  >
                                    {isImportingScript
                                      ? "Importing..."
                                      : "Apply script"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null
                      }
                    />
                    {autoProcessingError && (
                      <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        {autoProcessingError}
                      </div>
                    )}
                  </div>

                  <div
                    className={`transition-opacity duration-300 ${
                      showProcessingStage
                        ? "opacity-100 delay-150"
                        : "opacity-0 pointer-events-none absolute inset-0"
                    }`}
                  >
                    <ProcessingStatusCard
                      statuses={autoProcessStatuses}
                      progress={progress}
                      autoProcessingError={autoProcessingError}
                      analysisStage={analysisStage}
                      analysisEstimate={analysisEstimate}
                      preloadSnippets={speakerSnippets}
                      preloadThumbnails={speakerThumbnails}
                      speakerQuestion={speakerQuestion}
                      hidePreloadDetails={hidePreloadThumbnails}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full"
                      onClick={() => setIsDebugOpen(true)}
                    >
                      View debug details
                    </Button>
                    {showProcessingStage && (
                      <div className="mt-4 h-0 overflow-hidden" aria-hidden="true">
                        <div
                          ref={engineCanvasContainerRef}
                          className="h-0 w-full overflow-hidden"
                        />
                      </div>
                    )}
                  </div>

                  <div
                    className={`transition-opacity duration-300 ${
                      showResultStage
                        ? "opacity-100 delay-150"
                        : "opacity-0 pointer-events-none absolute inset-0"
                    }`}
                  >
                    <div className="space-y-3">
                      {conceptChoices.length > 0 ? (
                        <HighlightPicker
                          conceptChoices={conceptChoices}
                          selectedConceptId={selectedConceptId}
                          applyingConceptId={applyingConceptId}
                          isApplyingConcept={isApplyingConcept}
                          onSelect={handleConceptSelection}
                          onShortenAnother={handleRemoveVideo}
                          speakerPreviews={conceptSpeakerPreviews}
                        />
                      ) : (
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-sm font-medium text-foreground">
                            Results
                          </p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Trim applied. No alternate highlight options were
                            returned for this edit.
                          </p>
                          <div className="mt-3 border-t pt-3">
                            <button
                              type="button"
                              onClick={handleRemoveVideo}
                              className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
                            >
                              Shorten another video
                            </button>
                          </div>
                        </div>
                      )}
                      {canShowTemplate && (
                        <div className="rounded-xl border bg-card p-4">
                          <p className="text-sm font-medium text-foreground">
                            Template
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Choose whether to crop tightly around the active
                            speaker.
                          </p>
                          <div className="mt-3">
                            <TemplatePicker
                              options={SPEAKER_TEMPLATE_OPTIONS}
                              value={speakerTemplateId}
                              onChange={setSpeakerTemplateId}
                            />
                          </div>
                        </div>
                      )}
                      <div className="rounded-xl border bg-card p-4">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_1px_minmax(0,1fr)]">
                          <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">
                              Aspect ratio
                            </p>
                            <AspectRatioPicker
                              options={ASPECT_RATIO_OPTIONS}
                              value={targetAspectRatioId}
                              onChange={handleAspectRatioChange}
                            />
                          </div>
                          <div
                            className="hidden self-stretch bg-border md:block"
                            aria-hidden="true"
                          />
                          <div className="space-y-3">
                            <p className="text-sm font-medium text-foreground">
                              Result settings
                            </p>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-muted-foreground">
                                Text hook
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={textHookEnabled}
                                onClick={() =>
                                  setTextHookEnabled((prev) => !prev)
                                }
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                  textHookEnabled
                                    ? "bg-primary"
                                    : "bg-muted"
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 rounded-full bg-background shadow transition ${
                                    textHookEnabled
                                      ? "translate-x-6"
                                      : "translate-x-1"
                                  }`}
                                />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm text-muted-foreground">
                                Captions
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={captionsEnabled}
                                onClick={() =>
                                  setCaptionsEnabled((prev) => !prev)
                                }
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                  captionsEnabled
                                    ? "bg-primary"
                                    : "bg-muted"
                                }`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 rounded-full bg-background shadow transition ${
                                    captionsEnabled
                                      ? "translate-x-6"
                                      : "translate-x-1"
                                  }`}
                                />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setIsDebugOpen(true)}
                        disabled={
                          !transcriptDebug &&
                          !geminiDebug &&
                          !geminiFaceDebug &&
                          !geminiFaceThumbnail &&
                          !debugExportMetrics &&
                          !captionDebug
                        }
                      >
                        View debug details
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={`${previewMotionClass} ${previewOrderClass}`}>
                <div className="overflow-hidden">
                  <PreviewCanvas
                    {...previewCanvasProps}
                    showControls={
                      shouldShowOverlayControls && !isFaceCropPending
                    }
                    showPlaybackControls={false}
                    enableUpload={false}
                    engineCanvasContainerRef={
                      showFullPreview ? engineCanvasContainerRef : undefined
                    }
                  />
                </div>

                {showResultStage && (
                  <div
                    className={`mt-4 space-y-4 transition-opacity duration-300 ${
                      showResultStage ? "delay-150" : ""
                    }`}
                  >
                    <TimelineScrubber
                      isPlaying={isPlaying}
                      timelinePosition={timelinePosition}
                      timelineDuration={timelineDuration}
                      timelineSegments={timelineSegments}
                      isEngineReady={isEngineReady}
                      onTogglePlayback={togglePlayback}
                      onScrub={(value) => {
                        setTimelinePosition(value);
                        scrubToTime(value);
                      }}
                      onScrubStart={() => setIsScrubbingTimeline(true)}
                      onScrubEnd={() => {
                        setIsScrubbingTimeline(false);
                        scrubToTime(timelinePosition);
                      }}
                      onScrubCancel={() => {
                        if (isScrubbingTimeline) {
                          setIsScrubbingTimeline(false);
                          scrubToTime(timelinePosition);
                        }
                      }}
                    />
                    {activeSpeakerPreview && (
                      <div className="flex items-center gap-3 rounded-lg border bg-card/60 px-3 py-2 text-sm">
                        <div className="h-10 w-10 overflow-hidden rounded-full border bg-background">
                          {activeSpeakerPreview.thumbnail ? (
                            <img
                              src={activeSpeakerPreview.thumbnail.src}
                              alt={activeSpeakerPreview.label}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                              No face
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">
                            Speaking now
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {activeSpeakerPreview.label}
                          </p>
                        </div>
                      </div>
                    )}
                    {exportError && (
                      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                        {exportError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        <EditorModal
          isOpen={isEditorOpen}
          onClose={closeEditor}
          editorContainerRef={editorContainerRef}
          isLoading={isEditorLoading}
          error={editorError}
        />
        <DebugModal
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
          transcript={transcriptDebugText}
          gemini={geminiDebug}
          geminiFaceBoxes={geminiFaceDebugText}
          geminiFaceThumbnail={geminiFaceThumbnailUrl}
          debugExportMetrics={debugExportMetricsText}
          captions={captionDebugText}
          preloadScript={preloadScript}
          onExportPreloadScript={handleExportPreloadScript}
          isExportingPreloadScript={isPreloadScriptExporting}
        />

        {hasVideo && !showProcessingStage && (
          <footer className="border-t">
            <div className="container flex h-14 items-center justify-center text-xs text-muted-foreground">
              Built with CE.SDK · React · Tailwind CSS
            </div>
          </footer>
        )}
      </div>
    </ThemeProvider>
  );
}
