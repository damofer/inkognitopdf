import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFContext,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";
import { TEXT_MARKUP, type AnnotationItem } from "../model/document";
import type { Point, Rect } from "../model/geometry";
import { parseHexColor } from "./color";
import { metricsOf, wrapText } from "./formAppearance";
import { parseRef, refKey } from "./formRead";
import type { FontCache } from "./fonts";
import { SubstituteFont } from "./substituteFont";

/**
 * Writes standard PDF annotations (spec 001, CA4; spec 005, CA7): Highlight,
 * Underline, StrikeOut, Ink, Line (also arrows), Square, Circle, Text (notes)
 * and FreeText, each with an appearance stream so every viewer shows them the
 * same way, while staying editable in other PDF editors.
 */

export interface AnnotationContext {
  fonts: FontCache;
  now: Date;
}

type LiteralObject = NonNullable<Parameters<PDFContext["stream"]>[1]>;

/** Size of a note icon, in points. */
export const NOTE_SIZE = 20;

const SHORT_FONT = { Helvetica: "Helv", Times: "TiRo", Courier: "Cour" };

/** Entries rewritten when an annotation of the original file is changed. */
const REPLACED = [
  "Subtype",
  "AP",
  "AS",
  "Rect",
  "QuadPoints",
  "InkList",
  "L",
  "LE",
  "C",
  "IC",
  "CA",
  "Contents",
  "RC",
  "BS",
  "Border",
  "BE",
  "DA",
  "DS",
  "RD",
  "M",
];

export async function addAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  item: AnnotationItem,
  { fonts, now }: AnnotationContext,
): Promise<void> {
  const color = parseHexColor(item.color);
  const half = item.width / 2;
  const n = (v: number) => Number(v.toFixed(3));
  const rgb = (c: number[]) => c.map(n).join(" ");
  let subtype: string;
  let bbox: Rect;
  const ops: string[] = [];
  const extra: LiteralObject = {};
  let font: Awaited<ReturnType<FontCache["forText"]>> | undefined;
  let border = true;
  let extGState = false;

  switch (item.shape) {
    case "highlight":
    case "underline":
    case "strikeout": {
      const rects = item.rects ?? [];
      if (rects.length === 0) return;
      subtype = {
        highlight: "Highlight",
        underline: "Underline",
        strikeout: "StrikeOut",
      }[item.shape];
      bbox = union(rects);
      extra.QuadPoints = rects.flatMap((r) => [
        r.x,
        r.y + r.height,
        r.x + r.width,
        r.y + r.height,
        r.x,
        r.y,
        r.x + r.width,
        r.y,
      ]);
      extra.CA = 1;
      border = false;
      if (item.shape === "highlight") {
        extGState = true;
        ops.push("/GS0 gs", `${rgb(color)} rg`);
        for (const r of rects)
          ops.push(`${n(r.x)} ${n(r.y)} ${n(r.width)} ${n(r.height)} re f`);
      } else {
        ops.push(`${rgb(color)} RG`);
        for (const r of rects) {
          const t = Math.max(0.5, r.height / 14);
          const y = r.y + r.height * (item.shape === "underline" ? 0.12 : 0.45);
          ops.push(
            `${n(t)} w ${n(r.x)} ${n(y)} m ${n(r.x + r.width)} ${n(y)} l S`,
          );
        }
      }
      break;
    }
    case "ink":
    case "line":
    case "arrow": {
      const paths = (item.paths ?? []).filter((p) => p.length >= 2);
      if (paths.length === 0) return;
      subtype = item.shape === "ink" ? "Ink" : "Line";
      const strokes =
        item.shape === "ink" ? paths : [[paths[0]![0]!, paths[0]!.at(-1)!]];
      const head = Math.max(6, item.width * 4);
      bbox = inflate(
        union(paths.flat().map((p) => ({ ...p, width: 0, height: 0 }))),
        item.shape === "arrow" ? head + half : half,
      );
      if (item.shape === "ink")
        extra.InkList = paths.map((path) => path.flatMap((p) => [p.x, p.y]));
      else {
        const [a, b] = strokes[0] as [Point, Point];
        extra.L = [a.x, a.y, b.x, b.y];
        if (item.shape === "arrow") {
          extra.LE = ["None", "OpenArrow"];
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const wing = (turn: number) => ({
            x: b.x + head * Math.cos(angle + turn),
            y: b.y + head * Math.sin(angle + turn),
          });
          strokes.push([wing((5 * Math.PI) / 6), b, wing((-5 * Math.PI) / 6)]);
        }
      }
      ops.push(`${rgb(color)} RG`, `${n(item.width)} w`, "1 J 1 j");
      for (const path of strokes) ops.push(strokePath(path, n));
      break;
    }
    case "square":
    case "circle": {
      const r = item.rects?.[0];
      if (!r) return;
      subtype = item.shape === "square" ? "Square" : "Circle";
      bbox = inflate(r, half);
      const fill = item.fill ? parseHexColor(item.fill) : null;
      if (fill) {
        extra.IC = fill;
        ops.push(`${rgb(fill)} rg`);
      }
      ops.push(`${rgb(color)} RG`, `${n(item.width)} w`);
      const paint = fill ? (item.width > 0 ? "B" : "f") : "S";
      ops.push(
        item.shape === "square"
          ? `${n(r.x)} ${n(r.y)} ${n(r.width)} ${n(r.height)} re ${paint}`
          : `${ellipsePath(r, n)} ${paint}`,
      );
      break;
    }
    case "note": {
      const r = item.rects?.[0];
      if (!r) return;
      subtype = "Text";
      bbox = r;
      border = false;
      extra.Name = "Comment";
      extra.Open = false;
      extra.Contents = PDFHexString.fromText(item.text ?? "");
      // A sheet in the note color with three lines of text.
      ops.push(
        `${rgb(color)} rg 0 G 0.6 w`,
        `${n(r.x + 0.5)} ${n(r.y + 0.5)} ${n(r.width - 1)} ${n(r.height - 1)} re B`,
        "0.8 w",
        ...[0.7, 0.5, 0.3].map((f) => {
          const y = r.y + r.height * f;
          return `${n(r.x + r.width * 0.2)} ${n(y)} m ${n(r.x + r.width * 0.8)} ${n(y)} l S`;
        }),
      );
      break;
    }
    case "freeText": {
      const r = item.rects?.[0];
      if (!r) return;
      subtype = "FreeText";
      bbox = r;
      border = false;
      const text = (item.text ?? "").replace(/\r\n?/g, "\n");
      const family = item.font ?? "Helvetica";
      const size = item.fontSize ?? 12;
      font = await fonts.forText(text || "a", family, false, false);
      const metrics = metricsOf(font);
      const lines = wrapText(text, metrics, size, Math.max(1, r.width - 4));
      const lineHeight = (metrics.ascent - metrics.descent) * size;
      extra.Contents = PDFHexString.fromText(text);
      extra.DA = PDFString.of(
        `/${SHORT_FONT[family]} ${n(size)} Tf ${rgb(color)} rg`,
      );
      const top = r.y + r.height - 2 - metrics.ascent * size;
      const encode = (t: string) =>
        font instanceof SubstituteFont
          ? font.encode(t).toString()
          : font!.encodeText(t).toString();
      ops.push(
        "q",
        `${n(r.x)} ${n(r.y)} ${n(r.width)} ${n(r.height)} re W n`,
        "BT",
        `/F0 ${n(size)} Tf`,
        `${rgb(color)} rg`,
        ...lines.map(
          (line, i) =>
            `1 0 0 1 ${n(r.x + 2)} ${n(top - i * lineHeight)} Tm ${encode(line)} Tj`,
        ),
        "ET",
        "Q",
      );
      break;
    }
  }

  const ctx = doc.context;
  const bboxArray = [bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height];
  const resources: LiteralObject = {};
  if (extGState)
    resources.ExtGState = { GS0: { Type: "ExtGState", BM: "Multiply" } };
  if (font) resources.Font = { F0: font.ref };
  const appearance = ctx.stream(ops.join("\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: bboxArray,
    Resources: resources,
  });
  const entries: LiteralObject = {
    Type: "Annot",
    Subtype: subtype,
    Rect: bboxArray,
    F: item.shape === "note" ? 28 : 4,
    P: page.ref,
    NM: PDFString.of(item.id),
    M: PDFString.fromDate(now),
    AP: { N: ctx.register(appearance) },
    ...extra,
  };
  if (item.shape !== "freeText") entries.C = color;
  if (border) entries.BS = { W: item.width, S: "S" };
  else if (item.shape === "freeText") entries.BS = { W: 0 };
  const annot = ctx.obj(entries);
  if (border)
    annot.set(PDFName.of("Border"), ctx.obj([0, 0, PDFNumber.of(item.width)]));

  // A change to an annotation of the original file rewrites it in place: its
  // other entries (author, creation date, popup) and references to it stay.
  const ref = item.source ? parseRef(item.source) : null;
  const original = ref ? ctx.lookup(ref) : undefined;
  if (ref && original instanceof PDFDict) {
    const merged = original.clone(ctx);
    for (const key of REPLACED) merged.delete(PDFName.of(key));
    for (const [key, value] of annot.entries())
      if (!merged.has(key)) merged.set(key, value);
    ctx.assign(ref, merged);
    return;
  }
  page.node.addAnnot(ctx.register(annot));
}

/**
 * Removes an annotation of the original file and its popup from every page,
 * and from the file: nothing of its text is saved (spec 005, CA8).
 */
export function removeAnnotation(doc: PDFDocument, source: string): void {
  const ref = parseRef(source);
  if (!ref) return;
  const dict = doc.context.lookup(ref);
  const refs = [ref];
  if (dict instanceof PDFDict) {
    const popup = dict.get(PDFName.of("Popup"));
    if (popup instanceof PDFRef) refs.push(popup);
  }
  const keys = new Set(refs.map(refKey));
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i);
      if (entry instanceof PDFRef && keys.has(refKey(entry))) annots.remove(i);
    }
  }
  for (const r of refs) doc.context.delete(r);
}

/** True when the item draws over selected text. */
export const isTextMarkup = (item: AnnotationItem) =>
  TEXT_MARKUP.has(item.shape);

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function inflate(r: Rect, by: number): Rect {
  return {
    x: r.x - by,
    y: r.y - by,
    width: r.width + 2 * by,
    height: r.height + 2 * by,
  };
}

function strokePath(path: Point[], n: (v: number) => number): string {
  const [first, ...rest] = path;
  return [
    `${n(first!.x)} ${n(first!.y)} m`,
    ...rest.map((p) => `${n(p.x)} ${n(p.y)} l`),
    "S",
  ].join(" ");
}

/** Ellipse inscribed in `r`, as four Bézier curves. */
function ellipsePath(r: Rect, n: (v: number) => number): string {
  const k = 0.5522847498;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = r.width / 2;
  const ry = r.height / 2;
  const c = (...v: number[]) => v.map(n).join(" ");
  return [
    `${c(cx + rx, cy)} m`,
    `${c(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)} c`,
    `${c(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)} c`,
    `${c(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)} c`,
    `${c(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)} c`,
  ].join(" ");
}
