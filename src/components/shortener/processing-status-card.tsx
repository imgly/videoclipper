import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  LOADING_STEPS,
} from "@/features/shortener/constants";
import type {
  ProcessingStatus,
  ProcessingStepId,
  SpeakerFaceThumbnail,
  SpeakerSnippet,
} from "@/features/shortener/types";

type ProcessingStatusCardProps = {
  statuses: Record<ProcessingStepId, ProcessingStatus>;
  progress: number;
  autoProcessingError: string | null;
  analysisStage?: string | null;
  analysisEstimate?: {
    minSeconds: number;
    maxSeconds: number;
    wordCount: number;
  } | null;
  showFaceDetection?: boolean;
  preloadSnippets?: SpeakerSnippet[];
  preloadThumbnails?: SpeakerFaceThumbnail[];
  hidePreloadDetails?: boolean;
  speakerQuestion?: {
    speaker: SpeakerSnippet;
    index: number;
    total: number;
    isPlaying: boolean;
    hasPlayed: boolean;
    canPlay: boolean;
    faceOptions: SpeakerFaceThumbnail[];
    onPlay: () => void;
    onSelect: (face: SpeakerFaceThumbnail) => void;
  } | null;
  isCreatingVideo?: boolean;
};

const ANALYSIS_SUBSTEPS = [
  "Queued",
  "Sending transcript",
  "AI Reading Transcript",
  "AI Shortening Transcript",
];

const resolveAnalysisSubstep = (stage?: string | null) => {
  const index = ANALYSIS_SUBSTEPS.findIndex((step) => step === stage);
  const resolvedIndex = index === -1 ? 0 : index;
  return {
    label: ANALYSIS_SUBSTEPS[resolvedIndex],
    index: resolvedIndex + 1,
    total: ANALYSIS_SUBSTEPS.length,
  };
};

const formatAnalysisEstimate = (
  analysisEstimate?: ProcessingStatusCardProps["analysisEstimate"]
) => {
  if (!analysisEstimate) return null;
  const formatSeconds = (value: number) => {
    if (value >= 60) {
      return `${Math.max(1, Math.round(value / 60))} min`;
    }
    return `${value}s`;
  };
  const formatRange = (minSeconds: number, maxSeconds: number) =>
    minSeconds >= 60 || maxSeconds >= 90
      ? `${formatSeconds(minSeconds)}-${formatSeconds(maxSeconds)}`
      : `${minSeconds}-${maxSeconds}s`;
  return {
    range: formatRange(analysisEstimate.minSeconds, analysisEstimate.maxSeconds),
    wordCount: analysisEstimate.wordCount,
  };
};

const describeProcessingStatus = (
  status: ProcessingStatus,
  stepId: ProcessingStepId,
  progress: number,
  analysisStage?: string | null
) => {
  if (status === "active" && stepId === "audio" && progress > 0) {
    return `Extracting... ${progress}%`;
  }
  if (stepId === "analysis") {
    if (status === "complete") {
      return "Done";
    }
    if (status === "error") {
      return "Needs attention";
    }
    const substep = resolveAnalysisSubstep(analysisStage);
    return `${substep.index}/${substep.total} · ${substep.label}`;
  }
  switch (status) {
    case "active":
      return "In progress";
    case "complete":
      return "Done";
    case "error":
      return "Needs attention";
    default:
      return "Waiting";
  }
};

const describeFaceDetectionStatus = (
  status: ProcessingStatus,
  meta?: { faces: number; speakers: number; awaitingChoice?: boolean }
) => {
  if (status === "error") {
    return "Needs attention";
  }
  if (status === "complete") {
    return meta?.faces ? `${meta.faces} faces detected` : "Done";
  }
  if (status === "active") {
    if (meta?.awaitingChoice) {
      return "Help identify the speakers";
    }
    return meta?.speakers
      ? `Detecting faces for ${meta.speakers} speakers`
      : "Detecting faces";
  }
  return "Waiting";
};

const renderProcessingStatusIcon = (status: ProcessingStatus) => {
  if (status === "complete") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  }
  if (status === "active") {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-4 w-4 text-destructive" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50" />;
};

const ProcessingStatusCard = ({
  statuses,
  progress,
  autoProcessingError,
  analysisStage,
  analysisEstimate,
  showFaceDetection,
  preloadSnippets,
  preloadThumbnails,
  hidePreloadDetails,
  speakerQuestion,
  isCreatingVideo,
}: ProcessingStatusCardProps) => {
  const preloadFaces = preloadThumbnails ?? [];
  const preloadMeta = {
    faces: preloadFaces.length,
    speakers: preloadSnippets?.length ?? 0,
    awaitingChoice: Boolean(speakerQuestion),
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="relative">
        {/* Loading Steps Content */}
        <div
          className={`transition-opacity duration-300 ease-in-out ${
            showFaceDetection
              ? "opacity-0 pointer-events-none absolute inset-0"
              : "opacity-100"
          }`}
        >
          <div className="flex flex-col gap-1 text-sm font-medium sm:flex-row sm:items-center sm:justify-between">
            <span>Processing status</span>
            <span className="text-xs font-normal text-muted-foreground">
              Steps run sequentially
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {LOADING_STEPS.map((step) => {
              const status = statuses[step.id];
              const analysisMeta =
                step.id === "analysis"
                  ? formatAnalysisEstimate(analysisEstimate)
                  : null;
              return (
                <div
                  key={step.id}
                  className="rounded-md border border-dashed px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {renderProcessingStatusIcon(status)}
                      <div>
                        <p className="text-sm font-medium text-foreground">{step.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {describeProcessingStatus(
                            status,
                            step.id,
                            progress,
                            analysisStage
                          )}
                        </p>
                      </div>
                    </div>
                    {status === "error" ? (
                      <span className="text-xs text-destructive">Retry</span>
                    ) : step.id === "analysis" &&
                      analysisMeta &&
                      status !== "complete" ? (
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Est. {analysisMeta.range}</div>
                        <div>{analysisMeta.wordCount.toLocaleString()} words</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Face Detection Content */}
        <div
          className={`transition-opacity duration-300 ease-in-out ${
            showFaceDetection
              ? "opacity-100"
              : "opacity-0 pointer-events-none absolute inset-0"
          }`}
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {isCreatingVideo ? "Creating video" : "Detecting faces"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isCreatingVideo
                  ? "Applying your selections..."
                  : describeFaceDetectionStatus(statuses.preload, preloadMeta)}
              </p>
            </div>
          </div>

          {isCreatingVideo ? null : speakerQuestion ? (
            <div
              key={speakerQuestion.speaker.id}
              className="mt-4 animate-in rounded-md border bg-muted/20 p-4 fade-in-0 duration-300 slide-in-from-bottom-2"
            >
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  Speaker {speakerQuestion.index} of {speakerQuestion.total}
                </p>
                <p className="mt-3 text-base font-medium text-foreground">
                  Who is {speakerQuestion.speaker.label}?
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Listen to the clip, then choose the matching face.
                </p>
                <button
                  type="button"
                  onClick={speakerQuestion.onPlay}
                  disabled={!speakerQuestion.canPlay}
                  className={`mt-4 inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50 ${
                    !speakerQuestion.isPlaying && speakerQuestion.canPlay
                      ? "animate-pulse border-primary/70 shadow-[0_0_14px_rgba(59,130,246,0.45)]"
                      : speakerQuestion.isPlaying
                        ? "border-primary/70"
                        : ""
                  }`}
                >
                  {speakerQuestion.isPlaying ? "Playing..." : "Play audio"}
                </button>
              </div>
              {speakerQuestion.hasPlayed && (
                <>
                  {speakerQuestion.faceOptions.length ? (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {speakerQuestion.faceOptions.map((thumb) => (
                        <button
                          key={thumb.id}
                          type="button"
                          onClick={() => speakerQuestion.onSelect(thumb)}
                          className="overflow-hidden rounded-full border bg-background transition hover:border-primary"
                        >
                          <div className="aspect-square w-full min-h-28">
                            <img
                              src={thumb.src}
                              alt="Face option"
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-md border border-dashed bg-background/60 p-3 text-center text-xs text-muted-foreground">
                      No face options available.
                    </div>
                  )}
                </>
              )}
            </div>
          ) : preloadSnippets?.length && !hidePreloadDetails ? (
            <div className="mt-4 space-y-3">
              {preloadSnippets.map((snippet) => {
                const faces = preloadFaces.filter(
                  (thumb) => thumb.speakerId === snippet.id
                );
                return (
                  <div
                    key={snippet.id}
                    className="rounded-md border bg-muted/20 p-2"
                  >
                    <div className="text-center text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {snippet.label}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {faces.length ? (
                        faces.map((thumb, index) => (
                          <div
                            key={thumb.id}
                            className="overflow-hidden rounded-full border bg-background"
                          >
                            <div className="aspect-square w-full min-h-28">
                              <img
                                src={thumb.src}
                                alt={`${snippet.label} face ${index + 1}`}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex aspect-square w-full min-h-28 items-center justify-center rounded-md border border-dashed bg-background/60 text-[11px] text-muted-foreground">
                          {statuses.preload === "active"
                            ? "Detecting faces..."
                            : "No faces detected"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {autoProcessingError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {autoProcessingError}
        </div>
      )}
    </div>
  );
};

export default ProcessingStatusCard;
