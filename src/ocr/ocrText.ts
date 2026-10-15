/**
 * Recognized text (spec 003): plain text of lines and pages, and the geometry
 * of OCR boxes. The hidden layer itself is not edited: an edit of scanned
 * text (spec 010) paints over the image and replaces the words it covers.
 */
import type { OcrBox, OcrItem, OcrLine } from "../model/document";
import { boundingRect, type Point, type Rect } from "../model/geometry";

export const OCR_FONT = '"Arimo", sans-serif';

export function lineText(line: OcrLine): string {
  return line.words.map((w) => w.text).join(" ");
}

/** Axis-aligned bounds of a box in user space. */
export function boxBounds(rotate: number, box: OcrBox): Rect {
  const a = (rotate * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -Math.sin(a), y: Math.cos(a) };
  const corner = (along: number, up: number) => ({
    x: box.at.x + u.x * along + v.x * up,
    y: box.at.y + u.y * along + v.y * up,
  });
  return boundingRect([
    corner(0, 0),
    corner(box.width, 0),
    corner(box.width, box.height),
    corner(0, box.height),
  ]);
}

function axes(rotate: number) {
  const a = (rotate * Math.PI) / 180;
  return {
    u: { x: Math.cos(a), y: Math.sin(a) },
    v: { x: -Math.sin(a), y: Math.cos(a) },
  };
}

/** Centre of a box in user space. */
export function boxCenter(rotate: number, box: OcrBox): Point {
  const { u, v } = axes(rotate);
  return {
    x: box.at.x + (u.x * box.width + v.x * box.height) / 2,
    y: box.at.y + (u.y * box.width + v.y * box.height) / 2,
  };
}

/** Whether a word is under one of the edited areas (spec 010). */
export function coveredWord(rotate: number, word: OcrBox, areas: Rect[]) {
  if (areas.length === 0) return false;
  const c = boxCenter(rotate, word);
  return areas.some(
    (r) =>
      c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height,
  );
}

/** Index of the line under `p` (user space), or -1. */
export function lineAt(item: OcrItem, p: Point, tolerance = 1): number {
  const { u, v } = axes(item.rotate);
  return item.lines.findIndex((line) => {
    const dx = p.x - line.at.x;
    const dy = p.y - line.at.y;
    const along = dx * u.x + dy * u.y;
    const up = dx * v.x + dy * v.y;
    return (
      along >= -tolerance &&
      along <= line.width + tolerance &&
      up >= -tolerance &&
      up <= line.height + tolerance
    );
  });
}

/** Plain text of OCR items in reading order: lines, then pages (form feed). */
export function ocrText(pages: (OcrItem | undefined)[]): string {
  return pages
    .map((item) => (item?.lines ?? []).map(lineText).join("\n"))
    .join("\n\f");
}
