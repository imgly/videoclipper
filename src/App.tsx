"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { extractTranscriptWords } from "@/lib/transcript";
import type {
  ElevenLabsTranscriptResponse,
  TranscriptWord,
} from "@/lib/transcript";
import { transcribeWithElevenLabs } from "@/features/shortener/elevenLabs";
import { requestGeminiRefinement } from "@/features/shortener/gemini";
import { buildKeepRangesFromWords } from "@/features/shortener/keepRanges";
import { useShortenerWorkflow } from "@/features/shortener/use-shortener-workflow";
import type {
  CaptionSegment,
  GeminiRefinement,
  ProcessingStepId,
  RangeMapping,
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
import TimelineScrubber from "@/components/shortener/timeline-scrubber";
import TrimFocusCard from "@/components/shortener/trim-focus-card";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
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
const HOOK_DURATION_SECONDS = 5;
const HOOK_MAX_WORDS = 18;
const HOOK_MIN_WORDS = 6;
const HOOK_MAX_CHARACTERS = 96;
const HOOK_DEFAULT_TEXT = "Here's the key moment - watch what happens.";
const DEFAULT_ANALYSIS_SECONDS = 30;

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
type FaceBounds = { cx: number; x0: number; x1: number };

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
  const [isFaceCropPending, setIsFaceCropPending] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [textHookEnabled, setTextHookEnabled] = useState(true);
  const [transcriptDebug, setTranscriptDebug] =
    useState<ElevenLabsTranscriptResponse | null>(null);
  const [geminiDebug, setGeminiDebug] = useState<string | null>(null);
  const [captionDebug, setCaptionDebug] = useState<
    Record<string, CaptionSegment[]> | null
  >(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [currentTranscriptWords, setCurrentTranscriptWords] = useState<
    TranscriptWord[]
  >([]);
  const [sourceVideoDuration, setSourceVideoDuration] = useState(0);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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
  const faceCenterCacheRef = useRef<Map<number, FaceBounds>>(new Map());
  const faceCropRunIdRef = useRef(0);

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
    setCaptionDebug(null);
    setIsDebugOpen(false);
    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;
    videoTrackRef.current = null;
    videoTemplateRef.current = null;
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
      const cancel = engine.block.generateVideoThumbnailSequence(
        blockId,
        thumbH,
        safeTime,
        safeTime,
        1,
        (_index, result) => {
          cancel?.();
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result);
          }
        }
      );
    });

  const detectFaceCenterX = async (
    faceapi: FaceApiModule,
    img: ImageData
  ): Promise<FaceBounds | null> => {
    const canvas = imageDataToCanvas(img);
    const detection = await faceapi.detectSingleFace(
      canvas,
      new faceapi.TinyFaceDetectorOptions()
    );
    if (!detection) return null;
    const { x, width } = detection.box;
    const cx = (x + width / 2) / canvas.width;
    const x0 = x / canvas.width;
    const x1 = (x + width) / canvas.width;
    return { cx, x0, x1 };
  };

  const loadFaceModels = useCallback(async () => {
    if (faceModelsReadyRef.current) {
      return faceModelsReadyRef.current;
    }
    faceModelsReadyRef.current = (async () => {
      try {
        const faceapi = await import("face-api.js");
        faceApiRef.current = faceapi;
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

  const positionClipForFace = (
    engine: CreativeEngineInstance,
    clipId: number,
    faceCx: number,
    sceneWidth: number,
    sceneHeight: number
  ) => {
    const blockWidth = engine.block.getWidth(clipId);
    const blockHeight = engine.block.getHeight(clipId);
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
  };

  const detectFaceForClip = useCallback(
    async (engine: CreativeEngineInstance, clipId: number) => {
      const cached = faceCenterCacheRef.current.get(clipId);
      if (cached) {
        console.info("[FaceCrop] cache hit", { clipId, face: cached });
        return cached;
      }
      const faceapi = faceApiRef.current;
      if (!faceapi) {
        console.info("[FaceCrop] face-api not ready", { clipId });
        return null;
      }
      try {
        const sampleTime = getClipSampleTime(engine, clipId);
        console.info("[FaceCrop] sampling frame", { clipId, sampleTime });
        const frame = await grabFrame(engine, clipId, sampleTime);
        const face = await detectFaceCenterX(faceapi, frame);
        console.info("[FaceCrop] detection result", { clipId, face });
        if (face) {
          faceCenterCacheRef.current.set(clipId, face);
        }
        return face;
      } catch (error) {
        console.warn("Failed to detect face for clip", error);
        return null;
      }
    },
    []
  );

  const applyFaceAwareCropping = useCallback(
    async (clipIds?: number[], ratioOverrideId?: string) => {
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
          const face = await detectFaceForClip(engine, clipId);
          if (!face) continue;
          positionClipForFace(engine, clipId, face.cx, sceneWidth, sceneHeight);
        }
      } finally {
        if (runId === faceCropRunIdRef.current) {
          setIsFaceCropPending(false);
        }
      }
    },
    [detectFaceForClip, loadFaceModels, sourceVideoSize, targetAspectRatioId]
  );

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
    setCaptionDebug(null);
    setIsDebugOpen(false);
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

    const videoBlockId = await engine.block.addVideo(blobUrl, 1920, 1080);
    disableBlockHighlight(engine, videoBlockId);
    if (pageRef.current && engine.block.isValid(pageRef.current)) {
      engine.block.appendChild(pageRef.current, videoBlockId);
      ensureTrackForVideoBlock(engine, videoBlockId);
      try {
        const videoFillId = engine.block.getFill(videoBlockId);
        if (videoFillId) {
          try {
            await engine.block.forceLoadAVResource(videoFillId);
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

    try {
      const videoFillBlock = engine.block.getFill(videoBlockId);
      const trackCount = engine.block.getAudioTrackCountFromVideo(videoFillBlock);

      if (trackCount > 0) {
        const audioBlockId = engine.block.createAudioFromVideo(videoFillBlock, 0);
        if (pageRef.current && engine.block.isValid(pageRef.current)) {
          engine.block.appendChild(pageRef.current, audioBlockId);
        }
        audioBlockRef.current = audioBlockId;
        setAudioPlaybackMuted(false, audioBlockId);
        await syncAudioBlockDuration(engine, audioBlockId);
      } else {
        console.warn("Selected video has no audio tracks.");
      }
    } catch (error) {
      console.error("Failed to prepare audio track", error);
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

  const buildAnalysisEstimate = (words: TranscriptWord[]): AnalysisEstimate | null => {
    const wordCount = words.length;
    if (!wordCount) return null;
    const minSeconds = Math.max(8, Math.round(wordCount * 0.015));
    const maxSeconds = Math.max(minSeconds + 5, Math.round(wordCount * 0.03));
    return { minSeconds, maxSeconds, wordCount };
  };

  const transcribeExtractedAudio = async (
    audioBlob: Blob
  ): Promise<TranscriptWord[]> => {
    try {
      setIsTranscribing(true);
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

  const runAutomaticWorkflow = async () => {
    if (!videoFile) {
      setAutoProcessingError("Upload a video first.");
      return;
    }
    if (!engineRef.current || !audioBlockRef.current) {
      setAutoProcessingError(
        "Video is still preparing. Please try again in a moment."
      );
      return;
    }

    let activeStep: ProcessingStepId | null = null;
    beginWorkflow();
    setTranscriptDebug(null);
    setGeminiDebug(null);
    setCaptionDebug(null);
    setIsDebugOpen(false);
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
      setGeminiDebug(rawText);
      setCaptionDebug(buildCaptionDebugMap(words, refinement));
      updateProcessingStatus("analysis", "complete");
      activeStep = null;

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
      setAutoProcessing(false);
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
    const engine = engineRef.current;
    const audioBlock = audioBlockRef.current;
    if (!engine || !audioBlock) {
      throw new Error("Audio track is not ready yet. Upload a video first.");
    }

    let wasMuted = false;
    try {
      wasMuted = engine.block.isMuted(audioBlock);
      engine.block.setMuted(audioBlock, false);
      engine.block.setBool(audioBlock, "playback/muted", false);
    } catch (error) {
      console.warn("Failed to toggle audio mute state", error);
    }

    const pageId = pageRef.current;
    let previousPageDuration: number | null = null;
    if (pageId && engine.block.isValid(pageId)) {
      try {
        previousPageDuration = engine.block.getDuration(pageId);
        const desiredDuration = sourceVideoDuration || previousPageDuration;
        if (desiredDuration && desiredDuration > 0) {
          engine.block.setDuration(pageId, desiredDuration);
        }
      } catch (error) {
        console.warn("Failed to adjust page duration for audio export", error);
      }
    }

    const duration = await ensureAudioDuration(engine, audioBlock);
    if (!duration || duration <= 0) {
      throw new Error("Unable to determine audio duration for export.");
    }

    try {
      const exportedBlob = await engine.block.exportAudio(audioBlock, {
        mimeType: "audio/mp4",
        sampleRate: 48000,
        numberOfChannels: 2,
        timeOffset: 0.0,
        duration,
        onProgress: (
          _renderedFrames: number,
          encodedFrames: number,
          totalFrames: number
        ) => {
          if (!totalFrames) {
            setProgress(0);
            return;
          }
          const percentage = Math.round((encodedFrames / totalFrames) * 100);
          setProgress(Math.min(100, Math.max(0, percentage)));
        },
      });
      return exportedBlob;
    } finally {
      try {
        engine.block.setMuted(audioBlock, wasMuted);
        engine.block.setBool(audioBlock, "playback/muted", wasMuted);
      } catch (error) {
        console.warn("Failed to restore audio mute state", error);
      }
      if (pageId && previousPageDuration !== null) {
        try {
          engine.block.setDuration(pageId, previousPageDuration);
          updateTimelineDuration(engine);
        } catch (error) {
          console.warn("Failed to restore page duration after export", error);
        }
      }
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
    return parent;
  };

  const ensureVideoTrack = (engine: CreativeEngineInstance) => {
    if (videoTrackRef.current && engine.block.isValid(videoTrackRef.current)) {
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
      totalDuration
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
    }

    setVideoFile(null);
    resetWorkflowState();
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
    setCaptionDebug(null);
    setIsDebugOpen(false);
    setProgress(0);
    setIsDropActive(false);
    setIsExporting(false);
    setExportError(null);
    faceCenterCacheRef.current.clear();
    faceCropRunIdRef.current += 1;
    textHookTextRef.current = null;
    textHookDurationRef.current = HOOK_DURATION_SECONDS;
  }, [clearCaptionsTrack, clearVideoBlocks, resetWorkflowState]);

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

    applySceneAspectRatio(
      targetAspectRatioId,
      sourceVideoSize ?? { width: 1920, height: 1080 }
    );

    const trackId = ensureVideoTrack(engine);
    if (!trackId) return;

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
      totalDuration
    );

    if (!keepRanges.length) {
      console.warn("Gemini refinement did not match any transcript ranges.");
      return;
    }

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

    const existingChildren = engine.block.getChildren(trackId) ?? [];
    existingChildren.forEach((child) => {
      if (engine.block.isValid(child)) {
        engine.block.destroy(child);
      }
    });

    const clipIds: number[] = [];
    keepRanges.forEach((range) => {
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
  });

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
  const newDuration = keepRanges.reduce(
    (sum, range) => sum + (range.end - range.start),
    0
  );

    if (pageRef.current) {
      engine.block.setDuration(pageRef.current, newDuration);
    }
    setTimelineDuration(newDuration);
    setTimelinePosition((prev) => Math.min(prev, newDuration));
    let accumulated = 0;
    const rangeMappings: RangeMapping[] = keepRanges.map((range) => {
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
    setAudioPlaybackMuted(true);
    await applyCaptionsForWords(refinedWords, { rangeMappings, sourceWords });
    const hookDuration = Math.min(
      HOOK_DURATION_SECONDS,
      newDuration || HOOK_DURATION_SECONDS
    );
    const resolvedHookText =
      coerceHookText(hookText) ?? buildHookTextFromWords(refinedWords);
    applyTextHook(resolvedHookText, hookDuration);
    void applyFaceAwareCropping(clipIds);
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
    autoProcessing || isExtracting || isTranscribing;
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
      void applyFaceAwareCropping(undefined, ratioId);
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
    !audioBlockRef.current ||
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
        <AppHeader />

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
                          <button
                            type="button"
                            onClick={handleRemoveVideo}
                            className="text-xs font-medium text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
                          >
                            Remove video
                          </button>
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
                    />
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
                        />
                      ) : (
                        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                          Trim applied. No alternate highlight options were
                          returned for this edit.
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
                          !transcriptDebug && !geminiDebug && !captionDebug
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
          captions={captionDebugText}
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
