import { Download, Loader2, Pause, Pencil, Play, UploadCloud } from "lucide-react";
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  Ref,
} from "react";
import { cn } from "@/lib/utils";

type PreviewCanvasProps = {
  videoFile: File | null;
  isEngineReady: boolean;
  engineInitError: string | null;
  isUploadDisabled: boolean;
  isDropActive: boolean;
  onUploadClick: () => void;
  onUploadKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenEditor: () => void;
  onExport?: () => void;
  showControls?: boolean;
  isExporting?: boolean;
  isExtracting?: boolean;
  aspectRatio?: number;
  className?: string;
  enableUpload?: boolean;
  showPlaybackControls?: boolean;
  isPlaying?: boolean;
  timelineDuration?: number;
  onTogglePlayback?: () => void;
  isFaceCropPending?: boolean;
  engineCanvasContainerRef?: Ref<HTMLDivElement>;
  fileInputRef: Ref<HTMLInputElement>;
};

const PreviewCanvas = ({
  videoFile,
  isEngineReady,
  engineInitError,
  isUploadDisabled,
  isDropActive,
  onUploadClick,
  onUploadKeyDown,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileChange,
  onOpenEditor,
  onExport,
  showControls = false,
  isExporting = false,
  isExtracting = false,
  aspectRatio = 16 / 9,
  className,
  enableUpload = true,
  showPlaybackControls = false,
  isPlaying = false,
  timelineDuration = 0,
  onTogglePlayback,
  isFaceCropPending = false,
  engineCanvasContainerRef,
  fileInputRef,
}: PreviewCanvasProps) => {
  const shouldShowPlayback =
    Boolean(videoFile) && showPlaybackControls && Boolean(onTogglePlayback);
  const isPlaybackDisabled = !isEngineReady || !timelineDuration;
  const shouldShowPreview = Boolean(videoFile) && !isFaceCropPending && !isExtracting;
  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return "0:00.00";
    const minutes = Math.floor(value / 60);
    const seconds = (value % 60).toFixed(2).padStart(5, "0");
    return `${minutes}:${seconds}`;
  };

  return (
    <div
      className={cn(
        "group relative w-full overflow-hidden rounded-xl border",
        videoFile ? "bg-black/80" : "bg-card/40",
        className
      )}
      style={{ aspectRatio }}
    >
      {videoFile && showControls && (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          {onExport && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black/80 disabled:opacity-50"
              onClick={onExport}
              disabled={!isEngineReady || isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Export
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/60 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black/80 disabled:opacity-50"
            onClick={onOpenEditor}
            disabled={!isEngineReady}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
      )}
      {videoFile && shouldShowPlayback && (
        <>
          <button
            type="button"
            className="absolute left-1/2 top-1/2 z-10 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white opacity-0 pointer-events-none shadow-lg transition hover:bg-black/80 disabled:opacity-50 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
            onClick={onTogglePlayback}
            disabled={isPlaybackDisabled}
            aria-label={isPlaying ? "Pause" : "Play"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5" />
            )}
          </button>
          <div className="absolute bottom-3 right-3 z-10 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
            {formatTime(timelineDuration)}
          </div>
        </>
      )}
      <div
        ref={engineCanvasContainerRef}
        className={`h-full w-full transition-opacity duration-500 ${
          shouldShowPreview
            ? "opacity-100"
            : "opacity-0 pointer-events-none"
        }`}
      />
      {videoFile && isExtracting && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/70 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading video...</span>
        </div>
      )}
      {videoFile && isFaceCropPending && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="sr-only">Analyzing framing...</span>
        </div>
      )}
      {videoFile && !isEngineReady && !engineInitError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
          Loading CreativeEngine preview...
        </div>
      )}
      {videoFile && engineInitError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-destructive">
          Failed to initialize the CreativeEngine canvas: {engineInitError}
        </div>
      )}
      {enableUpload && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 text-center transition-opacity duration-500 ${
            videoFile ? "opacity-0 pointer-events-none" : "opacity-100"
          } ${
            isUploadDisabled
              ? "cursor-not-allowed border-muted/60 bg-muted/20"
              : "cursor-pointer border-muted bg-background/60 hover:border-primary/60"
          } ${
            isDropActive && !isUploadDisabled ? "border-primary bg-primary/5" : ""
          }`}
          role="button"
          tabIndex={videoFile || isUploadDisabled ? -1 : 0}
          aria-disabled={isUploadDisabled}
          aria-hidden={videoFile}
          onClick={onUploadClick}
          onKeyDown={onUploadKeyDown}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={onFileChange}
            className="sr-only"
            disabled={isUploadDisabled}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-background">
            <UploadCloud className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Drop a video to start
            </p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
          </div>
          {!isEngineReady && !engineInitError && (
            <p className="text-xs text-muted-foreground">
              Loading CreativeEngine...
            </p>
          )}
          {engineInitError && (
            <p className="text-xs text-destructive">
              CreativeEngine failed to load: {engineInitError}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default PreviewCanvas;
