/**
 * Scan pipeline (spec 002): photo → page corners → rectified page at the
 * output resolution → enhancement mode. Pure functions, run in a worker.
 */
import { detectPage } from "./detect";
import {
  grayscale,
  grayToRgba,
  photocopy,
  bitmapToRgba,
  rotateRgba,
  type Bitmap,
  type ScanMode,
} from "./enhance";
import { aspectRatio, warp, type Quad } from "./homography";
import { toGray, type Gray, type Rgba } from "./image";

export type PaperSize = "auto" | "a4" | "letter";

/** Output resolution, pixels per inch (spec 002, CA8). */
export const SCAN_PPI = 200;

const SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a5: [419.53, 595.28],
  legal: [612, 1008],
} as const;

/** The whole photo, as a quad (used when no page is found). */
export function fullQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

/** Corners found in the photo, or the whole photo. */
export function findCorners(photo: Rgba): { quad: Quad; found: boolean } {
  const detection = detectPage(toGray(photo));
  return detection
    ? { quad: detection.quad, found: true }
    : { quad: fullQuad(photo.width, photo.height), found: false };
}

/** Moves each corner `share` of the way to the centre (drops the paper's very edge). */
export function insetQuad(quad: Quad, share = 0.004): Quad {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  return quad.map((p) => ({
    x: p.x + (cx - p.x) * share * 2,
    y: p.y + (cy - p.y) * share * 2,
  })) as Quad;
}

/**
 * Page size in points for a page of `ratio` (width / height): a standard
 * size when the ratio is that close to one, else 210 mm on the short side.
 */
export function pageSize(
  ratio: number,
  paper: PaperSize = "auto",
): { widthPt: number; heightPt: number } {
  const landscape = ratio > 1;
  const orient = (w: number, h: number) =>
    landscape ? { widthPt: h, heightPt: w } : { widthPt: w, heightPt: h };
  if (paper !== "auto") return orient(SIZES[paper][0], SIZES[paper][1]);
  const portrait = landscape ? 1 / ratio : ratio;
  for (const [w, h] of Object.values(SIZES))
    if (Math.abs(portrait / (w / h) - 1) < 0.025) return orient(w, h);
  const short = 595.28;
  return orient(short, short / portrait);
}

export interface Rectified {
  image: Rgba;
  widthPt: number;
  heightPt: number;
}

/** The page inside `quad`, flattened, at SCAN_PPI. */
export function rectify(
  photo: Rgba,
  quad: Quad,
  paper: PaperSize = "auto",
  ppi = SCAN_PPI,
): Rectified {
  const ratio = aspectRatio(quad, photo.width, photo.height);
  const { widthPt, heightPt } = pageSize(ratio, paper);
  const width = Math.round((widthPt / 72) * ppi);
  const height = Math.round((heightPt / 72) * ppi);
  return {
    image: warp(photo, insetQuad(quad), width, height),
    widthPt,
    heightPt,
  };
}

export type Enhanced =
  | { mode: "original"; image: Rgba }
  | { mode: "gray"; image: Rgba; gray: Gray }
  | { mode: "bw"; image: Rgba; bitmap: Bitmap };

/** Applies a mode to a rectified page, after `quarters` clockwise turns. */
export function enhance(page: Rgba, mode: ScanMode, quarters = 0): Enhanced {
  const image = rotateRgba(page, quarters);
  if (mode === "bw") {
    const bitmap = photocopy(image);
    return { mode, bitmap, image: bitmapToRgba(bitmap) };
  }
  if (mode === "gray") {
    const g = grayscale(image);
    return { mode, gray: g, image: grayToRgba(g) };
  }
  return { mode, image };
}
