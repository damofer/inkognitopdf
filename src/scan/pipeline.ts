/**
 * Scan pipeline (spec 002): photo → page corners → rectified page at the
 * output resolution → enhancement mode. Pure functions, run in a worker.
 */
import { readableCopy, readableGray } from "./darkAreas";
import { detectPage } from "./detect";
import {
  cameraPose,
  findCurl,
  flatRatio,
  warpCurled,
  warpsCleanly,
} from "./dewarp";
import {
  grayToRgba,
  bitmapToRgba,
  rotateRgba,
  type Bitmap,
  type ScanMode,
} from "./enhance";
import { aspectRatio, warp, type Quad } from "./homography";
import { toGray, type Gray, type Rgba } from "./image";

/** "card": an ID card (ID-1, spec 020), only for the ID card mode. */
export type PaperSize = "auto" | "a4" | "letter" | "card";

/** Output resolution, pixels per inch (spec 002, CA8). */
export const SCAN_PPI = 200;

const SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a5: [419.53, 595.28],
  legal: [612, 1008],
} as const;

/** ID-1 card (DNI, driving licence): 85.6 × 53.98 mm, portrait. */
export const CARD_SIZE = [153.01, 242.65] as const;

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
  if (paper === "card") return orient(CARD_SIZE[0], CARD_SIZE[1]);
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
  /** Spec 029: the sheet was curved and has been straightened. */
  curved: boolean;
}

/**
 * The page inside `quad`, flattened, at SCAN_PPI. With `straighten`, a sheet
 * that is not flat has its lines of text straightened too (spec 029); ID
 * cards are rigid and never are.
 */
export function rectify(
  photo: Rgba,
  quad: Quad,
  paper: PaperSize = "auto",
  ppi = SCAN_PPI,
  straighten = true,
): Rectified {
  const ratio = aspectRatio(quad, photo.width, photo.height);
  const frame = insetQuad(quad);
  const found =
    straighten && paper !== "card" ? findCurl(photo, frame, ratio) : null;
  const camera = found
    ? cameraPose(quad, frame, ratio, photo.width, photo.height)
    : null;
  // A shape that would fold or stretch the page is not trusted.
  const curl =
    found && camera && warpsCleanly(found, ratio, camera) ? found : null;
  const { widthPt, heightPt } = pageSize(
    curl && camera ? flatRatio(curl, ratio, camera.height) : ratio,
    paper,
  );
  const width = Math.round((widthPt / 72) * ppi);
  const height = Math.round((heightPt / 72) * ppi);
  return {
    image:
      curl && camera
        ? warpCurled(photo, frame, curl, ratio, camera, width, height)
        : warp(photo, frame, width, height),
    widthPt,
    heightPt,
    curved: !!curl,
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
    const bitmap = readableCopy(image);
    return { mode, bitmap, image: bitmapToRgba(bitmap) };
  }
  if (mode === "gray") {
    const g = readableGray(image);
    return { mode, gray: g, image: grayToRgba(g) };
  }
  return { mode, image };
}

/** A black and white bitmap of an image that is already black and white. */
export function rgbaToBitmap(image: Rgba): Bitmap {
  const { width, height } = image;
  const row = Math.ceil(width / 8);
  const data = new Uint8Array(row * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (image.data[i]! + image.data[i + 1]! + image.data[i + 2]! >= 384)
        data[y * row + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  return { width, height, data };
}

const MM = 72 / 25.4;

/**
 * Spec 020, ID card mode: the sides of a card (each rectified at its real
 * size and enhanced) on one white A4 page, centred, the first above, as a
 * photocopy of an ID would be. The page keeps black and white only when
 * every side is.
 */
export function composeIdPage(sides: Enhanced[], ppi = SCAN_PPI): Enhanced {
  const px = (pt: number) => Math.round((pt / 72) * ppi);
  const width = px(SIZES.a4[0]);
  const height = px(SIZES.a4[1]);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let top = px(30 * MM);
  for (const side of sides) {
    const card = side.image;
    const left = Math.max(0, Math.round((width - card.width) / 2));
    for (let y = 0; y < card.height && top + y < height; y++) {
      const from = y * card.width * 4;
      const length = Math.min(card.width, width - left) * 4;
      data.set(
        card.data.subarray(from, from + length),
        ((top + y) * width + left) * 4,
      );
    }
    top += card.height + px(15 * MM);
  }
  const image: Rgba = { width, height, data };
  if (sides.every((s) => s.mode === "bw"))
    return { mode: "bw", image, bitmap: rgbaToBitmap(image) };
  if (sides.every((s) => s.mode !== "original"))
    return { mode: "gray", image, gray: toGray(image) };
  return { mode: "original", image };
}

/**
 * Spec 020: a small grey picture of the page inside `quad`, with mean 0 and
 * deviation 1, so a new sheet in the same place can be told from the last
 * one whatever the light.
 */
export function pageSignature(
  photo: Rgba,
  quad: Quad,
  width = 24,
  height = 32,
): Float32Array {
  // Four samples a side per cell, averaged, so a few pixels of jitter or
  // noise do not count as a change.
  const big = toGray(warp(photo, quad, width * 4, height * 4));
  const n = width * height;
  const small = new Float32Array(n);
  for (let y = 0; y < height * 4; y++)
    for (let x = 0; x < width * 4; x++)
      small[(y >> 2) * width + (x >> 2)]! += big.data[y * width * 4 + x]! / 16;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += small[i]!;
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (small[i]! - mean) ** 2;
  const deviation = Math.sqrt(variance / n) || 1;
  const signature = new Float32Array(n);
  for (let i = 0; i < n; i++) signature[i] = (small[i]! - mean) / deviation;
  return signature;
}
