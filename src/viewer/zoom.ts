import { t } from "../i18n";

/** Zoom is expressed as CSS pixels per PDF point (1 = 100 %). */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_STEPS: readonly number[] = [
  MIN_ZOOM,
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  MAX_ZOOM,
];

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? MAX_ZOOM;
}

export function zoomOut(zoom: number): number {
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? MIN_ZOOM
  );
}

/** Zoom that makes a page of `pageWidth` points fill `containerWidth` CSS pixels. */
export function fitWidth(
  pageWidth: number,
  containerWidth: number,
  padding = 32,
): number {
  if (pageWidth <= 0) return 1;
  return clampZoom((containerWidth - padding) / pageWidth);
}

export function formatZoom(zoom: number): string {
  return t("viewer.zoomValue", Math.round(zoom * 100));
}
