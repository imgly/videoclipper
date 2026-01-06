"use client";

import { Copy, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type DebugModalProps = {
  isOpen: boolean;
  onClose: () => void;
  transcript: string | null;
  gemini: string | null;
  geminiFaceBoxes: string | null;
  geminiFaceThumbnail: string | null;
  debugExportMetrics: string | null;
  captions: string | null;
  preloadScript: string | null;
  onExportPreloadScript?: () => void;
  isExportingPreloadScript?: boolean;
};

const DebugModal = ({
  isOpen,
  onClose,
  transcript,
  gemini,
  geminiFaceBoxes,
  geminiFaceThumbnail,
  debugExportMetrics,
  captions,
  preloadScript,
  onExportPreloadScript,
  isExportingPreloadScript = false,
}: DebugModalProps) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyText = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  const handleCopy = async (section: string, value: string | null) => {
    if (!value) return;
    try {
      await copyText(value);
      setCopiedSection(section);
      window.setTimeout(() => {
        setCopiedSection((current) => (current === section ? null : current));
      }, 1600);
    } catch (error) {
      console.warn("Failed to copy debug output", error);
    }
  };

  const renderSection = (
    section: string,
    label: string,
    description: string,
    value: string | null
  ) => (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleCopy(section, value)}
          disabled={!value}
          className="gap-2"
        >
          <Copy className="h-3.5 w-3.5" />
          {copiedSection === section ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
        {value ?? "Not available yet."}
      </pre>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-semibold">Debug output</p>
            <p className="text-xs text-muted-foreground">
              Copy raw data from the transcription, Gemini, face boxes, and caption passes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {renderSection(
            "transcript",
            "ElevenLabs transcript",
            "Raw transcription response from ElevenLabs.",
            transcript
          )}
          {renderSection(
            "gemini",
            "Gemini response",
            "Raw model output before normalization.",
            gemini
          )}
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Gemini face boxes
                </p>
                <p className="text-xs text-muted-foreground">
                  Raw face bounding box response from Gemini.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopy("geminiFaceBoxes", geminiFaceBoxes)}
                disabled={!geminiFaceBoxes}
                className="gap-2"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedSection === "geminiFaceBoxes" ? "Copied" : "Copy"}
              </Button>
            </div>
            {geminiFaceThumbnail && (
              <div className="mt-3 overflow-hidden rounded-lg border bg-background p-2">
                <img
                  src={geminiFaceThumbnail}
                  alt="Gemini face boxes thumbnail"
                  className="h-48 w-full object-contain"
                />
              </div>
            )}
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
              {geminiFaceBoxes ?? "Not available yet."}
            </pre>
          </div>
          {renderSection(
            "debugExportMetrics",
            "Debug export metrics",
            "Page size and export target used for debug thumbnails.",
            debugExportMetrics
          )}
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Preload import script
                </p>
                <p className="text-xs text-muted-foreground">
                  Export a payload to skip API calls and jump into the speaker
                  quiz.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onExportPreloadScript}
                  disabled={!onExportPreloadScript || isExportingPreloadScript}
                  className="gap-2"
                >
                  {isExportingPreloadScript ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {isExportingPreloadScript ? "Exporting" : "Generate"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopy("preloadScript", preloadScript)}
                  disabled={!preloadScript}
                  className="gap-2"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copiedSection === "preloadScript" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
              {preloadScript ?? "Generate a script to enable importing."}
            </pre>
          </div>
          {renderSection(
            "captions",
            "Caption segments",
            "Captions generated per trimmed version in CE.SDK.",
            captions
          )}
        </div>
      </div>
    </div>
  );
};

export default DebugModal;
