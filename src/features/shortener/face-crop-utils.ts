import type { FaceBounds } from "./types";

export type FaceCropRect = {
  width: number;
  height: number;
  x: number;
  y: number;
};

export type NormalizedCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FaceDetectionResult = {
  detection?: { box: { x: number; y: number; width: number; height: number } };
  box?: { x: number; y: number; width: number; height: number };
};

/**
 * Clamp a value between min and max bounds
 */
export const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Convert ImageData to a canvas element for face detection
 */
export const imageDataToCanvas = (img: ImageData): HTMLCanvasElement => {
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

/**
 * Normalize a crop rect to 0-1 coordinates relative to source dimensions
 */
export const normalizeCropRect = (
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

/**
 * Build a pixel-based crop rect from normalized face bounds
 */
export const buildFacePixelCropRect = (
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

/**
 * Scale a crop rect with optional extra padding and vertical bias
 */
export const scaleCropRect = (
  rect: FaceCropRect,
  scale: number,
  maxWidth: number,
  maxHeight: number,
  extraWidth = 0,
  extraHeight = 0,
  topBias = 0.5
): FaceCropRect => {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const safeExtraWidth = Number.isFinite(extraWidth) ? extraWidth : 0;
  const safeExtra = Number.isFinite(extraHeight) ? extraHeight : 0;
  const safeBias = Number.isFinite(topBias) ? clampValue(topBias, 0, 1) : 0.5;
  if (safeScale === 1 && safeExtra === 0 && safeExtraWidth === 0) {
    return rect;
  }
  const width = Math.max(1, rect.width * safeScale);
  const height = Math.max(1, rect.height * safeScale + safeExtra);
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

/**
 * Parse face detection results into normalized FaceBounds
 */
export const parseFaceDetections = (
  detections: FaceDetectionResult[],
  canvasWidth: number,
  canvasHeight: number
): FaceBounds[] => {
  if (!detections?.length) return [];
  return detections.map((detection) => {
    const box =
      "detection" in detection ? detection.detection!.box : detection.box!;
    const { x, y, width, height } = box;
    const x0 = x / canvasWidth;
    const x1 = (x + width) / canvasWidth;
    const y0 = y / canvasHeight;
    const y1 = (y + height) / canvasHeight;
    return {
      cx: (x + width / 2) / canvasWidth,
      cy: (y + height / 2) / canvasHeight,
      x0,
      x1,
      y0,
      y1,
    };
  });
};
