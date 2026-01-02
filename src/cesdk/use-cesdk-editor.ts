import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CESDK_LICENSE_KEY,
  DEFAULT_ASSET_LIBRARY_BASE_URL,
  DEMO_ASSET_LIBRARY_BASE_URL,
  EDITOR_ASSET_BASE_URL,
} from "./config";
import type { CreativeEngineInstance } from "./engine";

type UseCesdkEditorOptions = {
  isOpen: boolean;
  engineRef: RefObject<CreativeEngineInstance | null>;
};

export const useCesdkEditor = ({
  isOpen,
  engineRef,
}: UseCesdkEditorOptions) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<any>(null);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    let isCancelled = false;
    const initEditor = async () => {
      if (!editorContainerRef.current) return;
      setIsEditorLoading(true);
      setEditorError(null);
      try {
        const [{ default: CreativeEditorSDK }, archiveUrl] = await Promise.all([
          import("@cesdk/cesdk-js"),
          (async () => {
            const engine = engineRef.current;
            if (!engine) return null;
            try {
              const archive = await engine.scene.saveToArchive();
              return URL.createObjectURL(archive);
            } catch (sceneError) {
              console.warn("Failed to serialize scene for editor", sceneError);
              return null;
            }
          })(),
        ]);
        if (isCancelled || !editorContainerRef.current) return;
        const editor = await CreativeEditorSDK.create(
          editorContainerRef.current,
          {
            license: CESDK_LICENSE_KEY,
            theme: "dark",
            baseURL: EDITOR_ASSET_BASE_URL,
            sceneMode: "Video",
          }
        );
        editorInstanceRef.current = editor;
        try {
          await editor.addDefaultAssetSources({
            baseURL: DEFAULT_ASSET_LIBRARY_BASE_URL,
          });
        } catch (assetError) {
          console.warn("Failed to preload editor asset sources", assetError);
        }
        try {
          await editor.addDemoAssetSources({
            baseURL: DEMO_ASSET_LIBRARY_BASE_URL,
            sceneMode: "Video",
          });
        } catch (demoError) {
          console.warn("Failed to add demo assets", demoError);
        }
        if (archiveUrl) {
          try {
            await editor.loadFromArchiveURL(archiveUrl, true);
          } finally {
            URL.revokeObjectURL(archiveUrl);
          }
        } else {
          await editor.createVideoScene();
        }
      } catch (error) {
        if (!isCancelled) {
          setEditorError(
            error instanceof Error
              ? error.message
              : "Failed to initialize CE.SDK editor."
          );
        }
      } finally {
        if (!isCancelled) {
          setIsEditorLoading(false);
        }
      }
    };
    initEditor();
    return () => {
      isCancelled = true;
      if (editorInstanceRef.current) {
        try {
          editorInstanceRef.current.dispose();
        } catch (error) {
          console.warn("Failed to dispose editor", error);
        }
        editorInstanceRef.current = null;
      }
      if (editorContainerRef.current) {
        editorContainerRef.current.replaceChildren();
      }
    };
  }, [engineRef, isOpen]);

  return {
    editorContainerRef,
    isEditorLoading,
    editorError,
  };
};
