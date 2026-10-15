/**
 * Look of a line of text in a scanned image (spec 010): the paper around it,
 * the ink color, where its baseline is and how tall its letters are. Used to
 * cover the old text with the paper color and to draw the new text alike.
 */
import type { Rgba } from "../scan/image";

/** A box in image pixels, `x1`/`y1` exclusive. */
export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LineStyle {
  /** Paper color around the line, "#rrggbb". */
  background: string;
  /** Ink color of the letters, "#rrggbb". */
  color: string;
  /** Row of the baseline, in image pixels. */
  baseline: number;
  /** First column with ink, in image pixels. */
  left: number;
  /** Font size in image pixels (Arimo's cap height is 0.716 em). */
  size: number;
  /** Thick strokes for the size: a bold face. */
  bold: boolean;
  /** Typical stroke width, in em (0 when not measured). */
  stem: number;
  /** False when no ink was found (the box sizes are used instead). */
  measured: boolean;
}

/**
 * Stems of a regular sans face are about 0.09 em wide (up to 0.12 after the
 * photocopy filter thickens them), bold ones 0.13 em or more.
 */
const BOLD_STEM = 0.118;

/** Cap height of Arimo (and Arial, Helvetica), in em. */
export const CAP_HEIGHT = 0.716;
/** Ascent and descent of Arimo, in em: a line box spans about their sum. */
const ASCENT = 0.905;
const DESCENT = 0.212;

const hex = (rgb: number[]) =>
  `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

const luma = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

function median(values: number[]): number {
  if (values.length === 0) return 255;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1]!;
}

function clampBox(image: Rgba, box: PixelBox): PixelBox {
  return {
    x0: Math.max(0, Math.floor(box.x0)),
    y0: Math.max(0, Math.floor(box.y0)),
    x1: Math.min(image.width, Math.ceil(box.x1)),
    y1: Math.min(image.height, Math.ceil(box.y1)),
  };
}

/** Median color of a ring `pad` pixels outside `box`. */
export function backgroundAround(
  image: Rgba,
  box: PixelBox,
  pad: number,
): number[] {
  const channels: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
    const i = (y * image.width + x) * 4;
    for (let c = 0; c < 3; c++) channels[c]!.push(image.data[i + c]!);
  };
  const { x0, y0, x1, y1 } = clampBox(image, box);
  const step = Math.max(1, Math.round((x1 - x0 + y1 - y0) / 400));
  for (let ring = pad; ring <= pad + 2; ring++) {
    for (let x = x0 - ring; x < x1 + ring; x += step) {
      take(x, y0 - ring);
      take(x, y1 - 1 + ring);
    }
    for (let y = y0 - ring; y < y1 + ring; y += step) {
      take(x0 - ring, y);
      take(x1 - 1 + ring, y);
    }
  }
  return channels.map(median);
}

/**
 * Measures the line of text in `box` (the box of the recognized line, as
 * found by OCR: from the top of the tallest letter to the bottom of the
 * lowest descender).
 */
export function measureLine(image: Rgba, box: PixelBox): LineStyle {
  const height = box.y1 - box.y0;
  const pad = Math.max(2, Math.round(height * 0.2));
  const paper = backgroundAround(image, box, pad);
  const paperLuma = luma(paper[0]!, paper[1]!, paper[2]!);
  // A little above and below: OCR boxes can be one or two pixels tight.
  const area = clampBox(image, {
    x0: box.x0,
    y0: box.y0 - height * 0.1,
    x1: box.x1,
    y1: box.y1 + height * 0.1,
  });
  const width = area.x1 - area.x0;
  const rows = area.y1 - area.y0;

  const lumas: number[] = [];
  for (let y = area.y0; y < area.y1; y++)
    for (let x = area.x0; x < area.x1; x++) {
      const i = (y * image.width + x) * 4;
      lumas.push(luma(image.data[i]!, image.data[i + 1]!, image.data[i + 2]!));
    }
  const darkest = [...lumas].sort((a, b) => a - b)[
    Math.floor(lumas.length * 0.05)
  ];
  const fallback: LineStyle = {
    background: hex(paper),
    color: paperLuma > 128 ? "#000000" : "#ffffff",
    baseline: box.y0 + (height * ASCENT) / (ASCENT + DESCENT),
    left: box.x0,
    size: height / (ASCENT + DESCENT),
    bold: false,
    stem: 0,
    measured: false,
  };
  if (darkest === undefined || paperLuma - darkest < 40) return fallback;

  const threshold = (paperLuma + darkest) / 2;
  const ink: number[][] = [[], [], []];
  const perRow = new Array<number>(rows).fill(0);
  let left = Infinity;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < width; x++) {
      if (lumas[y * width + x]! >= threshold) continue;
      perRow[y]!++;
      left = Math.min(left, x);
      const i = ((area.y0 + y) * image.width + area.x0 + x) * 4;
      for (let c = 0; c < 3; c++) ink[c]!.push(image.data[i + c]!);
    }
  const most = Math.max(...perRow);
  // Rows with a few stray pixels (noise, a neighbouring line) do not count.
  const top = perRow.findIndex((n) => n >= Math.max(1, most * 0.04));
  let baseline = -1;
  for (let y = rows - 1; y >= 0; y--)
    if (perRow[y]! >= most * 0.3) {
      baseline = y + 1;
      break;
    }
  if (top < 0 || baseline <= top)
    return { ...fallback, color: hex(ink.map(median)) };

  // Letters taller than the box allows would be noise: keep it in range.
  const size = Math.min(
    Math.max((baseline - top) / CAP_HEIGHT, fallback.size * 0.5),
    fallback.size * 1.3,
  );

  // Stroke width: the median length of horizontal runs of ink between the
  // top of the letters and the baseline (mostly vertical stems).
  const runs: number[] = [];
  for (let y = top; y < baseline; y++) {
    let run = 0;
    for (let x = 0; x <= width; x++) {
      if (x < width && lumas[y * width + x]! < threshold) run++;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
  }
  const stem = median(runs);
  return {
    background: hex(paper),
    color: hex(ink.map(median)),
    baseline: area.y0 + baseline,
    left: area.x0 + left,
    size,
    bold: runs.length > 0 && stem / size > BOLD_STEM,
    stem: runs.length > 0 ? stem / size : 0,
    measured: true,
  };
}
