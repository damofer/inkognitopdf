import {
  PDFDict,
  PDFHexString,
  PDFName,
  type PDFDocument,
  type PDFFont,
  type PDFRef,
} from "pdf-lib";
import { parseHexColor } from "./color";
import { type FontCache } from "./fonts";
import { colorOf, numberOf, rectOf, type DaStyle } from "./formRead";
import { SubstituteFont } from "./substituteFont";

/**
 * Appearance streams of form widgets (spec 005, plan: formAppearance): the
 * text is drawn with the family, size and color of the field's /DA.
 */

type AnyFont = PDFFont | SubstituteFont;
type Rgb = [number, number, number];

/** Font metrics per unit of size, for both kinds of fonts. */
export interface Metrics {
  width(text: string): number;
  ascent: number;
  descent: number;
}

export function metricsOf(font: AnyFont): Metrics {
  if (font instanceof SubstituteFont)
    return {
      width: (t) => font.widthOf(t),
      ascent: font.ascent,
      descent: font.descent,
    };
  const ascent = font.heightAtSize(1, { descender: false });
  return {
    width: (t) => font.widthOfTextAtSize(t, 1),
    ascent,
    descent: ascent - font.heightAtSize(1),
  };
}

const encode = (font: AnyFont, text: string): PDFHexString =>
  font instanceof SubstituteFont
    ? font.encode(text)
    : (font.encodeText(text) as PDFHexString);

/** Box, colors and border of a widget. */
export interface WidgetLook {
  /** Size of the appearance box (the Rect, swapped when rotated a quarter). */
  width: number;
  height: number;
  rotate: number;
  background: Rgb | null;
  border: Rgb | null;
  borderWidth: number;
}

export function widgetLook(widget: PDFDict): WidgetLook {
  const rect = rectOf(widget.lookup(PDFName.of("Rect"))) ?? {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  const mk = widget.lookup(PDFName.of("MK"));
  const get = (key: string) =>
    mk instanceof PDFDict ? mk.lookup(PDFName.of(key)) : undefined;
  const rotate = ((((numberOf(get("R")) ?? 0) % 360) + 360) % 360) as number;
  const bs = widget.lookup(PDFName.of("BS"));
  const border = colorOf(get("BC"));
  const width =
    bs instanceof PDFDict ? (numberOf(bs.lookup(PDFName.of("W"))) ?? 1) : 1;
  const sideways = rotate === 90 || rotate === 270;
  return {
    width: sideways ? rect.height : rect.width,
    height: sideways ? rect.width : rect.height,
    rotate,
    background: colorOf(get("BG")),
    border,
    borderWidth: border ? width : 0,
  };
}

const n = (v: number) => Number(v.toFixed(3));
const rgbOp = (c: Rgb, op: "rg" | "RG") => `${c.map(n).join(" ")} ${op}`;

/** Background and border of a widget, in its appearance box. */
function frame(look: WidgetLook, round = false): string[] {
  const { width: w, height: h, borderWidth: bw } = look;
  const ops: string[] = [];
  const shape = (inset: number) =>
    round
      ? ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset)
      : `${n(inset)} ${n(inset)} ${n(w - 2 * inset)} ${n(h - 2 * inset)} re`;
  if (look.background) ops.push(rgbOp(look.background, "rg"), `${shape(0)} f`);
  if (look.border && bw > 0)
    ops.push(rgbOp(look.border, "RG"), `${n(bw)} w`, `${shape(bw / 2)} S`);
  return ops;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5522847498;
  const c = (...v: number[]) => v.map(n).join(" ");
  return [
    `${c(cx + rx, cy)} m`,
    `${c(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)} c`,
    `${c(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)} c`,
    `${c(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)} c`,
    `${c(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)} c`,
  ].join(" ");
}

/** Registers a Form XObject with `ops` for a widget of this look. */
function appearance(
  doc: PDFDocument,
  look: WidgetLook,
  ops: string[],
  font?: AnyFont,
): PDFRef {
  const r = (look.rotate * Math.PI) / 180;
  const matrix =
    look.rotate === 0
      ? undefined
      : [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0].map((v) =>
          Math.round(v),
        );
  const stream = doc.context.stream(ops.join("\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, n(look.width), n(look.height)],
    ...(matrix ? { Matrix: matrix } : {}),
    Resources: font ? { Font: { F0: font.ref } } : {},
  });
  return doc.context.register(stream);
}

/** Padding between the widget edge and its text. */
const padding = (look: WidgetLook) => Math.max(2, look.borderWidth + 1);

/** Splits text into lines that fit `maxWidth` (in units of font size × size). */
export function wrapText(
  text: string,
  metrics: Metrics,
  size: number,
  maxWidth: number,
): string[] {
  const out: string[] = [];
  const fits = (t: string) => metrics.width(t) * size <= maxWidth;
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      if (line === "" || fits((line + word).trimEnd())) line += word;
      else {
        out.push(line.trimEnd());
        line = word;
      }
      // A word longer than the line is broken by characters.
      while (line.trimEnd().length > 1 && !fits(line.trimEnd())) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Automatic font size (/DA size 0): a single line fills the height and shrinks
 * to fit the width; several lines take the largest size up to 12 that fits.
 */
export function autoSize(
  text: string,
  metrics: Metrics,
  innerWidth: number,
  innerHeight: number,
  multiline: boolean,
): number {
  const lineHeight = metrics.ascent - metrics.descent;
  if (!multiline) {
    let size = innerHeight / lineHeight;
    const width = metrics.width(text);
    if (width > 0) size = Math.min(size, innerWidth / width);
    return Math.max(4, Math.min(size, 100));
  }
  for (let size = 12; size > 4; size -= 0.5) {
    const lines = wrapText(text, metrics, size, innerWidth);
    if (lines.length * size * lineHeight <= innerHeight) return size;
  }
  return 4;
}

export interface TextFieldLook {
  kind: "text" | "multiline" | "dropdown" | "list";
  /** Text shown (dropdown: the label of the choice). */
  value: string;
  /** List box: labels and the indexes chosen. */
  options?: string[];
  selected?: number[];
  topIndex?: number;
  align: 0 | 1 | 2;
  maxLength?: number;
  comb: boolean;
  style: DaStyle;
}

/** Appearance of a text, dropdown or list widget. */
export async function textAppearance(
  doc: PDFDocument,
  fonts: FontCache,
  look: WidgetLook,
  field: TextFieldLook,
): Promise<PDFRef> {
  const { style } = field;
  const all =
    field.kind === "list" ? (field.options ?? []).join("") : field.value;
  const font = await fonts.forText(
    all || "a",
    style.font,
    style.bold,
    style.italic,
  );
  const metrics = metricsOf(font);
  const pad = padding(look);
  const { width: w, height: h, borderWidth: bw } = look;
  const innerWidth = Math.max(1, w - 2 * pad);
  const multiline = field.kind === "multiline";
  const innerHeight = Math.max(1, h - 2 * bw - (multiline ? 2 : 4));
  const size =
    style.size > 0
      ? style.size
      : field.kind === "list"
        ? 12
        : autoSize(field.value, metrics, innerWidth, innerHeight, multiline);
  const lineHeight = (metrics.ascent - metrics.descent) * size;
  const color = parseHexColor(style.color);
  const ops = [
    ...frame(look),
    "/Tx BMC",
    "q",
    `${n(bw)} ${n(bw)} ${n(w - 2 * bw)} ${n(h - 2 * bw)} re W n`,
  ];
  const text: string[] = [];
  const show = (line: string, x: number, y: number) =>
    text.push(`1 0 0 1 ${n(x)} ${n(y)} Tm ${encode(font, line).toString()} Tj`);
  const alignedX = (line: string) => {
    const lw = metrics.width(line) * size;
    if (field.align === 1) return (w - lw) / 2;
    if (field.align === 2) return w - pad - lw;
    return pad;
  };

  if (field.kind === "list") {
    const options = field.options ?? [];
    const top = field.topIndex ?? 0;
    const selected = new Set(field.selected ?? []);
    let y = h - bw;
    for (let i = top; i < options.length && y > bw; i++) {
      if (selected.has(i))
        ops.push(
          "0.6 0.75 0.86 rg",
          `${n(bw)} ${n(y - lineHeight)} ${n(w - 2 * bw)} ${n(lineHeight)} re f`,
        );
      show(options[i]!, alignedX(options[i]!), y - metrics.ascent * size);
      y -= lineHeight;
    }
  } else if (multiline) {
    const lines = wrapText(field.value, metrics, size, innerWidth);
    let y = h - bw - 1 - metrics.ascent * size;
    for (const line of lines) {
      show(line, alignedX(line), y);
      y -= lineHeight;
    }
  } else if (field.comb && field.maxLength) {
    const cell = w / field.maxLength;
    const y = (h - lineHeight) / 2 - metrics.descent * size;
    [...field.value].slice(0, field.maxLength).forEach((ch, i) => {
      show(ch, i * cell + (cell - metrics.width(ch) * size) / 2, y);
    });
  } else {
    const y = (h - lineHeight) / 2 - metrics.descent * size;
    show(field.value, alignedX(field.value), y);
  }
  if (text.length > 0)
    ops.push(
      "BT",
      `/F0 ${n(size)} Tf`,
      `${color.map(n).join(" ")} rg`,
      ...text,
      "ET",
    );
  ops.push("Q", "EMC");
  return appearance(doc, look, ops, font);
}

/** On and Off appearances of a check box (a check mark) or radio button (a dot). */
export function buttonAppearances(
  doc: PDFDocument,
  look: WidgetLook,
  kind: "checkbox" | "radio",
  color: string,
): { on: PDFRef; off: PDFRef } {
  const round = kind === "radio";
  const { width: w, height: h } = look;
  const c = parseHexColor(color);
  const s = Math.min(w, h);
  const mark =
    kind === "radio"
      ? [`${rgbOp(c, "rg")}`, `${ellipse(w / 2, h / 2, s / 4, s / 4)} f`]
      : [
          `${rgbOp(c, "RG")}`,
          `${n(Math.max(1, s / 10))} w 1 J 1 j`,
          `${n(w / 2 - s * 0.3)} ${n(h / 2)} m`,
          `${n(w / 2 - s * 0.08)} ${n(h / 2 - s * 0.22)} l`,
          `${n(w / 2 + s * 0.3)} ${n(h / 2 + s * 0.25)} l S`,
        ];
  return {
    on: appearance(doc, look, [...frame(look, round), "q", ...mark, "Q"]),
    off: appearance(doc, look, frame(look, round)),
  };
}
