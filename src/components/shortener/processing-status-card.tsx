import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  PROCESSING_STEPS,
} from "@/features/shortener/constants";
import type {
  ProcessingStatus,
  ProcessingStepId,
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
}: ProcessingStatusCardProps) => (
  <div className="rounded-xl border bg-card p-4">
    <div className="flex flex-col gap-1 text-sm font-medium sm:flex-row sm:items-center sm:justify-between">
      <span>Processing status</span>
      <span className="text-xs font-normal text-muted-foreground">
        Steps run sequentially
      </span>
    </div>
    <div className="mt-4 space-y-3">
      {PROCESSING_STEPS.map((step) => {
        const status = statuses[step.id];
        const analysisMeta =
          step.id === "analysis"
            ? formatAnalysisEstimate(analysisEstimate)
            : null;
        return (
          <div
            key={step.id}
            className="flex items-center justify-between rounded-md border border-dashed px-3 py-2"
          >
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
        );
      })}
    </div>
    {autoProcessingError && (
      <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        {autoProcessingError}
      </div>
    )}
  </div>
);

export default ProcessingStatusCard;
