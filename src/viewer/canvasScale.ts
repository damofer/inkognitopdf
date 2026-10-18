/**
 * Most pixels one page canvas may have: the canvas limit of iOS Safari, where a
 * larger canvas renders blank. Desktop browsers allow more, but at this size
 * one page already takes 64 MB (spec 035).
 */
export const MAX_CANVAS_PIXELS = 2 ** 24;

/**
 * Device pixels per CSS pixel for a canvas shown at `width` × `height` CSS
 * pixels: the screen's pixel ratio, lowered when the canvas would pass
 * MAX_CANVAS_PIXELS (high zoom on a dense phone screen). The page then looks a
 * little softer instead of failing to render.
 */
export function canvasScale(
  width: number,
  height: number,
  pixelRatio = window.devicePixelRatio || 1,
): number {
  const area = width * height;
  if (area <= 0) return pixelRatio;
  return Math.min(pixelRatio, Math.sqrt(MAX_CANVAS_PIXELS / area));
}
