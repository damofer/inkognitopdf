import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from "pdf-lib";
import type { AnnotationItem, AnnotationShape } from "../model/document";
import type { Point, Rect } from "../model/geometry";
import { rgbToHex } from "./color";
import { colorOf, numberOf, parseDa, rectOf, refKey, textOf } from "./formRead";

/**
 * Annotations of the original file, for selecting, changing and removing them
 * (spec 005, HU8). Widgets, links and popups are not listed.
 */
export interface ExistingAnnot {
  /** Object reference, as "12 0 R". */
  source: string;
  subtype: string;
  /** Bounds on the page. */
  rect: Rect;
  /** The annotation as an editable item, when pdfcraft can redraw its type. */
  item: AnnotationItem | null;
  /** Author, for the UI. */
  author?: string;
}

const SKIPPED = new Set(["Widget", "Link", "Popup"]);

const SHAPES: Record<string, AnnotationShape> = {
  Highlight: "highlight",
  Underline: "underline",
  StrikeOut: "strikeout",
  Ink: "ink",
  Line: "line",
  Square: "square",
  Circle: "circle",
  Text: "note",
  FreeText: "freeText",
};

/** Id of the item that stands for an annotation of the original file. */
export const existingItemId = (source: string) =>
  `annot-${source.replace(/ /g, "-")}`;

function numbers(value: unknown): number[] {
  return value instanceof PDFArray
    ? value.asArray().map((v) => numberOf(v) ?? 0)
    : [];
}

function strokeWidth(dict: PDFDict): number {
  const bs = dict.lookup(PDFName.of("BS"));
  if (bs instanceof PDFDict) {
    const w = numberOf(bs.lookup(PDFName.of("W")));
    if (w !== undefined) return w;
  }
  const border = numbers(dict.lookup(PDFName.of("Border")));
  return border.length >= 3 ? border[2]! : 1;
}

function pairs(flat: number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

function bounds(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function toItem(
  dict: PDFDict,
  subtype: string,
  rect: Rect,
  source: string,
  pageId: string,
): AnnotationItem | null {
  let shape = SHAPES[subtype];
  if (!shape) return null;
  const c = colorOf(dict.lookup(PDFName.of("C")));
  const base = {
    kind: "annotation" as const,
    id: existingItemId(source),
    pageId,
    source,
    color: c ? rgbToHex(...c) : "#000000",
    width: 0,
  };
  switch (shape) {
    case "highlight":
    case "underline":
    case "strikeout": {
      const q = numbers(dict.lookup(PDFName.of("QuadPoints")));
      const rects: Rect[] = [];
      for (let i = 0; i + 7 < q.length; i += 8)
        rects.push(bounds(pairs(q.slice(i, i + 8))));
      return { ...base, shape, rects: rects.length > 0 ? rects : [rect] };
    }
    case "ink": {
      const list = dict.lookup(PDFName.of("InkList"));
      const paths =
        list instanceof PDFArray
          ? list
              .asArray()
              .map((p) =>
                pairs(
                  numbers(p instanceof PDFRef ? dict.context.lookup(p) : p),
                ),
              )
              .filter((p) => p.length >= 2)
          : [];
      if (paths.length === 0) return null;
      return { ...base, shape, width: strokeWidth(dict), paths };
    }
    case "line": {
      const l = numbers(dict.lookup(PDFName.of("L")));
      if (l.length < 4) return null;
      const le = dict.lookup(PDFName.of("LE"));
      const end = le instanceof PDFArray ? textOf(le.lookup(1)) : undefined;
      if (end && /Arrow/.test(end)) shape = "arrow";
      return {
        ...base,
        shape,
        width: strokeWidth(dict),
        paths: [pairs(l.slice(0, 4))],
      };
    }
    case "square":
    case "circle": {
      const width = strokeWidth(dict);
      const rd = numbers(dict.lookup(PDFName.of("RD")));
      const [l, b, r, t] =
        rd.length === 4 ? rd : [width / 2, width / 2, width / 2, width / 2];
      const fill = colorOf(dict.lookup(PDFName.of("IC")));
      return {
        ...base,
        shape,
        width,
        rects: [
          {
            x: rect.x + l!,
            y: rect.y + b!,
            width: Math.max(1, rect.width - l! - r!),
            height: Math.max(1, rect.height - b! - t!),
          },
        ],
        ...(fill ? { fill: rgbToHex(...fill) } : {}),
      };
    }
    case "note":
      return {
        ...base,
        shape,
        color: c ? base.color : "#ffd400",
        rects: [rect],
        text: textOf(dict.lookup(PDFName.of("Contents"))) ?? "",
      };
    case "freeText": {
      const da = parseDa(
        textOf(dict.lookup(PDFName.of("DA"))) ?? "/Helv 12 Tf 0 g",
      );
      return {
        ...base,
        shape,
        color: da.color,
        rects: [rect],
        text: textOf(dict.lookup(PDFName.of("Contents"))) ?? "",
        font: da.font,
        fontSize: da.size > 0 ? da.size : 12,
      };
    }
    default:
      return null;
  }
}

/** Annotations of page `pageIndex`; `pageId` is set on the items. */
export function readAnnotations(
  doc: PDFDocument,
  pageIndex: number,
  pageId: string,
): ExistingAnnot[] {
  const page = doc.getPages()[pageIndex];
  const annots = page?.node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  const out: ExistingAnnot[] = [];
  for (const entry of annots.asArray()) {
    if (!(entry instanceof PDFRef)) continue;
    const dict = doc.context.lookup(entry);
    if (!(dict instanceof PDFDict)) continue;
    const subtype = textOf(dict.lookup(PDFName.of("Subtype"))) ?? "";
    if (SKIPPED.has(subtype)) continue;
    const flags = numberOf(dict.lookup(PDFName.of("F"))) ?? 0;
    if (flags & (2 | 32)) continue; // hidden or no view
    const rect = rectOf(dict.lookup(PDFName.of("Rect")));
    if (!rect) continue;
    const source = refKey(entry);
    out.push({
      source,
      subtype,
      rect,
      item: toItem(dict, subtype, rect, source, pageId),
      author: textOf(dict.lookup(PDFName.of("T"))),
    });
  }
  return out;
}
