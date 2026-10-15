import type { Item, TextStyle } from "../model/document";
import type { Point, Rect } from "../model/geometry";

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: "Helvetica",
  size: 14,
  color: "#000000",
  bold: false,
  italic: false,
  lineHeight: 1.2,
};

/** CSS font stacks that match the PDF standard fonts closely enough for preview. */
export const CSS_FONT: Record<TextStyle["font"], string> = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  Times: "'Times New Roman', Times, 'Liberation Serif', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', monospace",
};

/**
 * Distance from the top of a CSS line box to the baseline, for previews.
 * Uses typical ascent/descent ratios of the standard fonts.
 */
export function baselineOffset(
  fontSizePx: number,
  lineHeightPx: number,
): number {
  return (lineHeightPx - 1.15 * fontSizePx) / 2 + 0.905 * fontSizePx;
}

const shift = (p: Point, d: Point): Point => ({ x: p.x + d.x, y: p.y + d.y });
const shiftRect = (r: Rect, d: Point): Rect => ({
  ...r,
  x: r.x + d.x,
  y: r.y + d.y,
});

/** Moves an item by `delta` in PDF user space. */
export function moveItem(item: Item, delta: Point): Item {
  switch (item.kind) {
    case "text":
      return { ...item, at: shift(item.at, delta) };
    case "textEdit":
      // The area marks the original text to remove, so it stays in place.
      return { ...item, at: shift(item.at, delta) };
    case "image":
    case "whiteout":
    case "signature":
    case "signField":
    case "formField":
      return { ...item, rect: shiftRect(item.rect, delta) };
    case "annotation":
      return {
        ...item,
        rects: item.rects?.map((r) => shiftRect(r, delta)),
        paths: item.paths?.map((path) => path.map((p) => shift(p, delta))),
      };
    case "ocr":
      // Recognized text belongs to the image under it.
      return item;
    case "redaction":
      // An applied area stays where it was confirmed (spec 012).
      return item.applied
        ? item
        : { ...item, rect: shiftRect(item.rect, delta) };
    case "annotRemoval":
    case "formValue":
      return item;
  }
}

/** Items whose rectangle can be resized with a handle. */
export function resizableRect(item: Item): Rect | null {
  if (item.kind === "redaction") return item.applied ? null : item.rect;
  if (
    item.kind === "image" ||
    item.kind === "whiteout" ||
    item.kind === "signature" ||
    item.kind === "signField" ||
    item.kind === "formField"
  )
    return item.rect;
  if (
    item.kind === "annotation" &&
    (item.shape === "square" ||
      item.shape === "circle" ||
      item.shape === "freeText")
  )
    return item.rects?.[0] ?? null;
  return null;
}

export function withRect(item: Item, rect: Rect): Item {
  if (item.kind === "redaction") return { ...item, rect };
  if (
    item.kind === "image" ||
    item.kind === "whiteout" ||
    item.kind === "signature" ||
    item.kind === "signField" ||
    item.kind === "formField"
  )
    return { ...item, rect };
  if (item.kind === "annotation") return { ...item, rects: [rect] };
  return item;
}

/** Normalizes a rect so width and height are at least `min`. */
export function minSize(rect: Rect, min = 4): Rect {
  return {
    ...rect,
    width: Math.max(min, rect.width),
    height: Math.max(min, rect.height),
  };
}

/**
 * Merges the per-glyph-run rectangles of a text selection into one rectangle
 * per visual line (rects whose vertical extents mostly overlap).
 */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Rect[] = [];
  for (const r of sorted) {
    const line = lines.find((l) => {
      const overlap =
        Math.min(l.y + l.height, r.y + r.height) - Math.max(l.y, r.y);
      return overlap > 0.5 * Math.min(l.height, r.height);
    });
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const x0 = Math.min(line.x, r.x);
    const y0 = Math.min(line.y, r.y);
    const x1 = Math.max(line.x + line.width, r.x + r.width);
    const y1 = Math.max(line.y + line.height, r.y + r.height);
    Object.assign(line, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return lines;
}

/** Visual clockwise rotation of an item drawn with `itemRotate` (CCW) on a page shown at `pageRotation`. */
export function visualRotation(
  pageRotation: number,
  itemRotate: number,
): number {
  return (((pageRotation - itemRotate) % 360) + 360) % 360;
}
