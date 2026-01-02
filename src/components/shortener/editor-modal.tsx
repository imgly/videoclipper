import { X } from "lucide-react";
import type { RefObject } from "react";

type EditorModalProps = {
  isOpen: boolean;
  onClose: () => void;
  editorContainerRef: RefObject<HTMLDivElement>;
  isLoading: boolean;
  error: string | null;
};

const EditorModal = ({
  isOpen,
  onClose,
  editorContainerRef,
  isLoading,
  error,
}: EditorModalProps) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4 py-6 backdrop-blur">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <p className="text-sm font-semibold">Advanced Editor</p>
            <p className="text-xs text-muted-foreground">
              Tweak the current scene directly in CE.SDK.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative flex-1 bg-black/80">
          <div ref={editorContainerRef} className="h-full w-full" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
              Loading CE.SDK Editor...
            </div>
          )}
        </div>
        {error && <div className="border-t px-5 py-3 text-sm text-destructive">{error}</div>}
      </div>
    </div>
  );
};

export default EditorModal;
