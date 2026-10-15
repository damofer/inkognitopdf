/**
 * Editing text of a scanned image (spec 010). A recognized line (OCR of the
 * app, or the invisible text layer of a scanned PDF) becomes a text edit that
 * paints the paper color over the old line and draws the new text visibly,
 * sized, colored and placed like the original as measured in the pixels.
 */
import type { OcrBox, OcrLine, TextEditItem } from "../model/document";
import type { PageGeometry, Point, Rect } from "../model/geometry";
import { boxBounds, OCR_FONT } from "../ocr/ocrText";
import { measureLine } from "../ocr/scanStyle";
import type { TextBox } from "./textBoxes";

/** Arimo's ascent and descent, in em: an OCR line box spans about both. */
const ASCENT = 0.905;
const DESCENT = 0.212;
/** Extent of pdf.js text runs around their baseline (as in textBoxes.ts). */
const TEXT_ASCENT = 0.95;
const TEXT_DESCENT = 0.25;
/** Words below this OCR confidence are doubtful (as in spec 003, CA6). */
const DOUBTFUL = 60;

/** A line of text in a scanned image, wherever it comes from. */
export interface ImageLine {
  pageId: string;
  /** Box from the bottom of the descenders to the top of the letters. */
  box: OcrBox;
  /** Degrees counter-clockwise of the text direction. */
  rotate: number;
  text: string;
  lowConfidence: boolean;
}

/** The page as pixels, rotated as shown, with its geometry. */
export interface PagePixels {
  image: { width: number; height: number; data: Uint8ClampedArray };
  geometry: PageGeometry;
}

function axes(rotate: number) {
  const a = (rotate * Math.PI) / 180;
  return {
    u: { x: Math.cos(a), y: Math.sin(a) },
    v: { x: -Math.sin(a), y: Math.cos(a) },
  };
}

const grow = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  width: r.width + 2 * d,
  height: r.height + 2 * d,
});

export function ocrImageLine(
  pageId: string,
  rotate: number,
  line: OcrLine,
  /** Where the line was clicked, in user space. */
  p: Point,
): ImageLine {
  const { u, v } = axes(rotate);
  const along = (q: Point) => (q.x - line.at.x) * u.x + (q.y - line.at.y) * u.y;
  const across = (q: Point) =>
    (q.x - line.at.x) * v.x + (q.y - line.at.y) * v.y;
  const words = line.words
    .map((w) => ({ w, start: along(w.at), end: along(w.at) + w.width }))
    .sort((a, b) => a.start - b.start);
  // OCR joins the cells of a table row into one line: a gap wider than a
  // letter or so starts another group of words, and only the clicked group
  // is edited (the other cells and the rules between them stay).
  const tall = [...line.words.map((w) => w.height)].sort((a, b) => a - b)[
    line.words.length >> 1
  ]!;
  const groups: (typeof words)[] = [];
  for (const word of words) {
    const last = groups.at(-1);
    if (last && word.start - last.at(-1)!.end < tall) last.push(word);
    else groups.push([word]);
  }
  const x = along(p);
  const group =
    groups.find(
      (g) => x >= g[0]!.start - tall / 2 && x <= g.at(-1)!.end + tall / 2,
    ) ??
    groups.reduce((best, g) =>
      Math.abs((g[0]!.start + g.at(-1)!.end) / 2 - x) <
      Math.abs((best[0]!.start + best.at(-1)!.end) / 2 - x)
        ? g
        : best,
    );
  const start = group[0]!.start;
  const end = Math.max(...group.map((g) => g.end));
  const low = Math.min(...group.map((g) => across(g.w.at)));
  const high = Math.max(...group.map((g) => across(g.w.at) + g.w.height));
  const confidence =
    group.reduce((sum, g) => sum + g.w.confidence, 0) / group.length;
  return {
    pageId,
    box: {
      at: {
        x: line.at.x + u.x * start + v.x * low,
        y: line.at.y + u.y * start + v.y * low,
      },
      width: end - start,
      height: high - low,
    },
    rotate,
    text: group.map((g) => g.w.text).join(" "),
    lowConfidence: confidence < DOUBTFUL,
  };
}

/**
 * The line of invisible text around `box` (an OCR layer writes one run per
 * word, each sized to its own box): runs whose heights overlap, each less
 * than a letter or two apart.
 */
export function invisibleImageLine(
  pageId: string,
  boxes: TextBox[],
  box: TextBox,
): ImageLine {
  const { u, v } = axes(box.rotate);
  const along = (p: { x: number; y: number }) =>
    (p.x - box.at.x) * u.x + (p.y - box.at.y) * u.y;
  const across = (p: { x: number; y: number }) =>
    (p.x - box.at.x) * v.x + (p.y - box.at.y) * v.y;
  /** Extent of a run across the line, from its descenders to its ascenders. */
  const span = (b: TextBox) => {
    const base = across(b.at);
    return {
      low: base - TEXT_DESCENT * b.size,
      high: base + TEXT_ASCENT * b.size,
    };
  };
  const mine = span(box);
  const row = boxes
    .filter((b) => {
      if (Math.abs(b.rotate - box.rotate) >= 1) return false;
      const s = span(b);
      const overlap = Math.min(s.high, mine.high) - Math.max(s.low, mine.low);
      return overlap > 0.5 * Math.min(s.high - s.low, mine.high - mine.low);
    })
    .map((b) => ({ b, start: along(b.at), end: along(b.at) + b.width }))
    .sort((a, b) => a.start - b.start);
  const at = row.findIndex((r) => r.b === box);
  let first = at;
  let last = at;
  const gap = box.size;
  while (first > 0 && row[first]!.start - row[first - 1]!.end < gap) first--;
  while (last < row.length - 1 && row[last + 1]!.start - row[last]!.end < gap)
    last++;
  const line = row.slice(first, last + 1);
  const start = line[0]!.start;
  const end = Math.max(...line.map((r) => r.end));
  const low = Math.min(...line.map((r) => span(r.b).low));
  const high = Math.max(...line.map((r) => span(r.b).high));
  return {
    pageId,
    box: {
      at: {
        x: box.at.x + u.x * start + v.x * low,
        y: box.at.y + u.y * start + v.y * low,
      },
      width: end - start,
      height: high - low,
    },
    rotate: box.rotate,
    text: line.map((r) => r.b.text.trim()).join(" "),
    lowConfidence: false,
  };
}

/** First guess from the box alone, shown at once and refined from pixels. */
export function imageEditFor(line: ImageLine): TextEditItem {
  const { box, rotate } = line;
  const size = box.height / (ASCENT + DESCENT);
  const { v } = axes(rotate);
  const rise = DESCENT * size;
  return {
    kind: "textEdit",
    id: "",
    pageId: line.pageId,
    // A margin hides the anti-aliased edges of the old letters.
    area: grow(boxBounds(rotate, box), Math.max(0.5, size * 0.06)),
    originalText: line.text,
    text: line.text,
    at: { x: box.at.x + v.x * rise, y: box.at.y + v.y * rise },
    size,
    rotate,
    previewFont: OCR_FONT,
    color: "#000000",
    background: "#ffffff",
    ...(line.lowConfidence ? { lowConfidence: true } : {}),
  };
}

/** Direction of text that runs left to right on screen, in user space. */
function screenRotation(geometry: PageGeometry): number {
  const a = geometry.toPdf({ x: 0, y: 0 });
  const b = geometry.toPdf({ x: 1, y: 0 });
  return Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

/** The edit with the paper, ink, size and baseline measured in the pixels. */
export function measuredEdit(
  edit: TextEditItem,
  line: ImageLine,
  { image, geometry }: PagePixels,
  /** Other lines of the page: bold is judged against their strokes. */
  others: OcrBox[] = [],
): TextEditItem {
  const measure = (box: OcrBox) =>
    measureArea({ image, geometry }, boxBounds(line.rotate, box));
  const style = measure(line.box);
  const colored = {
    ...edit,
    background: style.background,
    color: style.color,
  };
  // Sizes come from rows of pixels: only for text that runs across them.
  const across =
    (((screenRotation(geometry) - line.rotate) % 360) + 360) % 360 === 0;
  if (!style.measured || !across) return colored;
  const size = style.size / geometry.scale;
  // The photocopy filter thickens every stroke a little.
  const bold =
    thickerStrokes(
      style.stem,
      [...others]
        .sort((a, b) => b.width - a.width)
        .slice(0, 8)
        .map((box) => measure(box)),
    ) ?? style.bold;
  return {
    ...colored,
    bold,
    size,
    at: geometry.toPdf({ x: style.left, y: style.baseline }),
    area: grow(boxBounds(line.rotate, line.box), Math.max(0.5, size * 0.06)),
  };
}

/** The look of the text in `area` (user space) of the page's pixels. */
function measureArea({ image, geometry }: PagePixels, area: Rect) {
  const view = geometry.rectToView(area);
  return measureLine(image, {
    x0: view.x,
    y0: view.y,
    x1: view.x + view.width,
    y1: view.y + view.height,
  });
}

/**
 * Bold is relative: strokes clearly thicker than those of the page's text.
 * Undefined when the page has no text to compare with.
 */
function thickerStrokes(
  stem: number,
  others: ReturnType<typeof measureLine>[],
): boolean | undefined {
  const stems = others
    .filter((s) => s.measured && s.stem > 0)
    .map((s) => s.stem)
    .sort((a, b) => a - b);
  const typical = stems[stems.length >> 1];
  return typical === undefined
    ? undefined
    : stem > Math.max(0.105, typical * 1.22);
}

/**
 * Text drawn bold with a font whose name and descriptor do not say so (a
 * Type 3 font, a subset named "F2"): its strokes, as rendered, are clearly
 * thicker than those of the longest lines of the page.
 */
export function boldByStrokes(
  pixels: PagePixels,
  area: Rect,
  others: Rect[],
): boolean {
  const style = measureArea(pixels, area);
  if (!style.measured) return false;
  const measured = [...others]
    .sort((a, b) => b.width - a.width)
    .slice(0, 8)
    .map((r) => measureArea(pixels, r));
  if (measured.filter((s) => s.measured).length < 3) return false;
  return thickerStrokes(style.stem, measured) ?? false;
}
