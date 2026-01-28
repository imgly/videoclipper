/**
 * Calculate scene dimensions to fit a target aspect ratio
 * while maintaining source resolution
 */
export const calculateSceneDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number
): { width: number; height: number } => {
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
