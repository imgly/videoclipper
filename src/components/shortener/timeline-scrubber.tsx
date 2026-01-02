import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimeRange } from "@/features/shortener/types";

type TimelineScrubberProps = {
  isPlaying: boolean;
  timelinePosition: number;
  timelineDuration: number;
  timelineSegments: TimeRange[];
  isEngineReady: boolean;
  onTogglePlayback: () => void;
  onScrub: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onScrubCancel?: () => void;
  className?: string;
};

const formatTime = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "0.00";

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const TimelineScrubber = ({
  isPlaying,
  timelinePosition,
  timelineDuration,
  timelineSegments,
  isEngineReady,
  onTogglePlayback,
  onScrub,
  onScrubStart,
  onScrubEnd,
  onScrubCancel,
  className,
}: TimelineScrubberProps) => {
  const hasDuration = timelineDuration > 0;
  const progress = hasDuration
    ? clampPercent((timelinePosition / timelineDuration) * 100)
    : 0;
  const hasSegments = hasDuration && timelineSegments.length > 1;

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
          onClick={onTogglePlayback}
          disabled={!hasDuration || !isEngineReady}
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4" /> Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Play
            </>
          )}
        </button>
        <div className="text-xs text-muted-foreground">
          {formatTime(timelinePosition)}s / {formatTime(timelineDuration)}s
        </div>
      </div>

      <div className="mt-4">
        <div className="relative h-3 w-full">
          <div className="absolute inset-0 rounded-full bg-muted/60" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
            style={{ width: `${progress}%` }}
          />
          {hasSegments &&
            timelineSegments.map((segment, index) => {
              const start = clampPercent(
                (segment.start / timelineDuration) * 100
              );
              const end = clampPercent((segment.end / timelineDuration) * 100);
              const width = Math.max(0, end - start);
              return (
                <div
                  key={`${segment.start}-${segment.end}-${index}`}
                  className="absolute inset-y-0 rounded-full bg-primary/40"
                  style={{ left: `${start}%`, width: `${width}%` }}
                />
              );
            })}
          <input
            type="range"
            min={0}
            max={hasDuration ? timelineDuration : 0}
            step={0.01}
            value={hasDuration ? timelinePosition : 0}
            onChange={(event) => onScrub(Number(event.target.value))}
            onPointerDown={onScrubStart}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubCancel}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onScrubCancel?.();
              }
            }}
            disabled={!hasDuration || !isEngineReady}
            className="absolute inset-0 z-10 h-3 w-full cursor-pointer appearance-none bg-transparent accent-primary"
            aria-label="Timeline position"
          />
        </div>
      </div>
    </div>
  );
};

export default TimelineScrubber;
