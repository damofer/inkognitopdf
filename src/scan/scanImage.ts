/**
 * From an enhanced page to a page of the document model (spec 002, HU9).
 */
import type { PageEntry, ScanImage } from "../model/document";
import type { Rgba } from "./image";
import { SCAN_PPI, type Enhanced } from "./pipeline";

/** Encodes RGBA as JPEG (OffscreenCanvas in the browser, a canvas in tests). */
export type EncodeJpeg = (image: Rgba, quality: number) => Promise<Uint8Array>;

export const JPEG_QUALITY = 0.85;

export async function toScanImage(
  page: Enhanced,
  encodeJpeg: EncodeJpeg,
): Promise<ScanImage> {
  if (page.mode === "bw")
    return {
      format: "bw",
      data: page.bitmap.data,
      width: page.bitmap.width,
      height: page.bitmap.height,
    };
  return {
    format: "jpeg",
    data: await encodeJpeg(page.image, JPEG_QUALITY),
    width: page.image.width,
    height: page.image.height,
  };
}

/** A new page holding `image` at `ppi` (its size in points follows from it). */
export function scanPage(
  id: string,
  image: ScanImage,
  ppi = SCAN_PPI,
): PageEntry {
  return {
    id,
    source: { kind: "scan", image },
    box: [0, 0, (image.width / ppi) * 72, (image.height / ppi) * 72],
    baseRotation: 0,
    extraRotation: 0,
  };
}
