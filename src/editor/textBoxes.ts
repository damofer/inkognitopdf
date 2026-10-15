import type { TextEditItem } from "../model/document";
import { boundingRect, type Point, type Rect } from "../model/geometry";

/** A run of existing page text, as pdf.js extracts it, in PDF user space. */
export interface TextBox {
  text: string;
  /** Baseline origin. */
  at: Point;
  size: number;
  /** Degrees counter-clockwise. */
  rotate: number;
  /** Length along the baseline. */
  width: number;
  /** Axis-aligned bounds of the glyph boxes. */
  area: Rect;
  /** CSS font family reported by pdf.js, for previews. */
  fontFamily: string;
  /** Name of the font face pdf.js registers for this font (its `loadedName`). */
  loadedName: string;
}

interface PdfjsTextContent {
  items: unknown[];
  styles: Record<string, { fontFamily?: string } | undefined>;
}

interface PdfjsTextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
}

const ASCENT = 0.95;
const DESCENT = 0.25;

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Converts pdf.js text content (`page.getTextContent()`) into text boxes. */
export function textBoxes(content: PdfjsTextContent): TextBox[] {
  const boxes: TextBox[] = [];
  for (const raw of content.items) {
    if (typeof raw !== "object" || raw === null || !("str" in raw)) continue;
    const item = raw as PdfjsTextItem;
    if (item.str.trim() === "") continue;
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    if (size === 0) continue;
    const angle = Math.atan2(b, a);
    const rotate = round((angle * 180) / Math.PI);
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
    const v = { x: -u.y, y: u.x };
    const corner = (along: number, up: number) => ({
      x: e + u.x * along + v.x * up,
      y: f + u.y * along + v.y * up,
    });
    boxes.push({
      text: item.str,
      at: { x: e, y: f },
      size: round(size),
      rotate: rotate === 0 ? 0 : rotate,
      width: item.width,
      area: boundingRect([
        corner(0, -DESCENT * size),
        corner(item.width, -DESCENT * size),
        corner(item.width, ASCENT * size),
        corner(0, ASCENT * size),
      ]),
      fontFamily: content.styles[item.fontName]?.fontFamily ?? "sans-serif",
      loadedName: item.fontName,
    });
  }
  return boxes;
}

/** True when `p` (PDF user space) falls on the box, with `tolerance` points of margin. */
export function boxContains(box: TextBox, p: Point, tolerance = 1): boolean {
  const angle = (box.rotate * Math.PI) / 180;
  const dx = p.x - box.at.x;
  const dy = p.y - box.at.y;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  const up = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return (
    along >= -tolerance &&
    along <= box.width + tolerance &&
    up >= -DESCENT * box.size - tolerance &&
    up <= ASCENT * box.size + tolerance
  );
}

/**
 * The text under `p`, as the user sees it: when runs overlap (a dot leader
 * drawn under a label and its value), the one drawn last is on top.
 */
export function boxAt(boxes: TextBox[], p: Point): TextBox | undefined {
  return boxes.findLast((b) => boxContains(b, p));
}

/**
 * CSS font family to preview new text like the original: the font pdf.js
 * loaded from the PDF (same glyphs), then the open font that completes the
 * characters it lacks, as the saved file will do.
 */
export function previewFamily(box: TextBox, substitute?: string): string {
  const generic = /mono/i.test(box.fontFamily)
    ? "monospace"
    : /serif/i.test(box.fontFamily) && !/sans/i.test(box.fontFamily)
      ? "serif"
      : "sans-serif";
  const open =
    substitute ??
    { monospace: "Cousine", serif: "Tinos", "sans-serif": "Arimo" }[generic];
  return `"${box.loadedName}", "${open}", ${generic}`;
}

/** Text-edit item that replaces `box` with `text`. */
export function textEditFor(
  box: TextBox,
  pageId: string,
  id: string,
  text: string,
): TextEditItem {
  return {
    kind: "textEdit",
    id,
    pageId,
    area: box.area,
    originalText: box.text,
    text,
    at: box.at,
    size: box.size,
    rotate: box.rotate,
    previewFont: previewFamily(box),
    color: "#000000",
  };
}
