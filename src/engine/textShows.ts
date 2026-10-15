import type { Point, Rect } from "../model/geometry";
import { boundingRect } from "../model/geometry";
import type { ContentOp, Operand } from "./contentStream";
import { codesOf, type FontInfo } from "./pdfFonts";
import { rgbToHex } from "./color";

/**
 * Text state machine over a parsed content stream (ISO 32000-1 §9.3–§9.4):
 * finds every text-showing operation with its position on the page, so the
 * text-edit engine can remove exactly the operators inside an edited area.
 */

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m × n: applies m first, then n. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

export const apply = (m: Matrix, x: number, y: number): Point => ({
  x: m[0] * x + m[2] * y + m[4],
  y: m[1] * x + m[3] * y + m[5],
});

/** A glyph or a TJ adjustment, in the order they appear in the operator. */
export type ShowPart =
  | {
      kind: "glyph";
      /** Bytes of the character code in the string. */
      bytes: Uint8Array;
      /** Centre of the glyph box, in user space. */
      center: Point;
      /** Baseline origin of the glyph, in user space. */
      origin: Point;
      /** Offset from the start of the operation, in text space. */
      x: number;
      /** Unicode text of the glyph ("" when unknown). */
      unicode: string;
      /** Horizontal displacement, including Tc and Tw, in unscaled text space. */
      advance: number;
    }
  | { kind: "adjust"; value: number };

export interface TextShow {
  /** Index of the operation in the parsed stream. */
  opIndex: number;
  operator: "Tj" | "TJ" | "'" | '"';
  start: number;
  end: number;
  font: FontInfo | null;
  /** Unicode text, when the font allows decoding it. */
  text: string;
  /** Baseline origin of the first glyph, in user space. */
  origin: Point;
  /** Bounding box of the glyphs, in user space. */
  bbox: Rect;
  /** Effective font size in user space units. */
  size: number;
  /** Text direction, degrees counter-clockwise. */
  angle: number;
  /** Fill color when the text was shown. */
  color: string;
  /** Horizontal displacement of the whole operation, in unscaled text space. */
  advance: number;
  parts: ShowPart[];
  /** Text state needed to replace the operation by an equal displacement. */
  fontSize: number;
  horizontalScale: number;
  /** Text space to the stream's own space at the start: Tm × CTM (local). */
  matrix: Matrix;
  /** Text space to user space at the start. */
  userMatrix: Matrix;
  /** Graphics and text state to draw new text that looks the same. */
  state: ReplayState;
}

/** State replayed before new text, as content-stream operators. */
export interface ReplayState {
  fontName: string | null;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  rise: number;
  renderMode: number;
  lineWidth: number;
  /** Fill color operators, verbatim (e.g. `/CS0 cs 0.2 0.4 scn`). */
  fillOps: string;
  strokeOps: string;
  /** ExtGState operators in effect (`/GS1 gs`), verbatim. */
  extGStateOps: string;
}

export interface FindOptions {
  /** Stream space to user space (a form's Matrix × CTM at the Do). */
  base?: Matrix;
  /** The parsed bytes, to keep color and state operators verbatim. */
  source?: Uint8Array;
  /** Called for every `Do`, with the local CTM. */
  onDo?: (name: string, ctm: Matrix, opIndex: number) => void;
}

interface GraphicsState {
  ctm: Matrix;
  fill: string;
  fillSpace: string;
  fillColor: string;
  strokeSpace: string;
  strokeColor: string;
  extGState: string;
  renderMode: number;
  lineWidth: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScale: number;
  leading: number;
  fontName: string | null;
  fontSize: number;
  rise: number;
}

const isNum = (o: Operand | undefined): o is number => typeof o === "number";
const nums = (ops: Operand[]) => ops.filter(isNum);

function toColor(values: number[]): string | null {
  const c = values.map((v) => Math.max(0, Math.min(1, v)));
  if (c.length === 1) return rgbToHex(c[0]!, c[0]!, c[0]!);
  if (c.length === 3) return rgbToHex(c[0]!, c[1]!, c[2]!);
  if (c.length === 4) {
    const k = c[3]!;
    return rgbToHex(
      (1 - c[0]!) * (1 - k),
      (1 - c[1]!) * (1 - k),
      (1 - c[2]!) * (1 - k),
    );
  }
  return null;
}

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

export function findTextShows(
  ops: ContentOp[],
  fonts: Map<string, FontInfo>,
  { base = IDENTITY, source, onDo }: FindOptions = {},
): TextShow[] {
  const shows: TextShow[] = [];
  const stack: GraphicsState[] = [];
  const verbatim = (op: ContentOp) =>
    source ? latin1(source.subarray(op.start, op.end)) : "";
  let gs: GraphicsState = {
    ctm: IDENTITY,
    fill: "#000000",
    fillSpace: "",
    fillColor: "",
    strokeSpace: "",
    strokeColor: "",
    extGState: "",
    renderMode: 0,
    lineWidth: 1,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
    leading: 0,
    fontName: null,
    fontSize: 0,
    rise: 0,
  };
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;

  const moveLine = (tx: number, ty: number) => {
    tlm = multiply([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };

  const show = (
    op: ContentOp,
    opIndex: number,
    operator: TextShow["operator"],
    parts: Operand[],
  ) => {
    const font = gs.fontName ? (fonts.get(gs.fontName) ?? null) : null;
    const local = multiply(tm, gs.ctm);
    const start = multiply(local, base);
    let advance = 0;
    let text = "";
    const showParts: ShowPart[] = [];
    const middle = gs.rise + 0.35 * gs.fontSize;
    for (const part of parts) {
      if (isNum(part)) {
        advance -= (part / 1000) * gs.fontSize * gs.horizontalScale;
        showParts.push({ kind: "adjust", value: part });
        continue;
      }
      if (typeof part !== "object" || part === null || !("type" in part))
        continue;
      if (part.type !== "string") continue;
      const size = font?.bytesPerCode ?? 1;
      codesOf(font, part.bytes).forEach((code, k) => {
        const w0 = font ? font.widthOf(code) : 0.5;
        const wordSpace = size === 1 && code === 32 ? gs.wordSpacing : 0;
        const glyphAdvance =
          (w0 * gs.fontSize + gs.charSpacing + wordSpace) * gs.horizontalScale;
        showParts.push({
          kind: "glyph",
          bytes: part.bytes.subarray(k * size, (k + 1) * size),
          center: apply(
            start,
            advance + (w0 * gs.fontSize * gs.horizontalScale) / 2,
            middle,
          ),
          origin: apply(start, advance, gs.rise),
          x: advance,
          unicode: font?.unicodeOf(code) ?? "",
          advance: glyphAdvance,
        });
        advance += glyphAdvance;
        text += font?.unicodeOf(code) ?? "";
      });
    }
    const descent = gs.rise - 0.25 * gs.fontSize;
    const ascent = gs.rise + 0.9 * gs.fontSize;
    const corners = [
      apply(start, 0, descent),
      apply(start, advance, descent),
      apply(start, advance, ascent),
      apply(start, 0, ascent),
    ];
    shows.push({
      opIndex,
      operator,
      start: op.start,
      end: op.end,
      font,
      text,
      origin: apply(start, 0, gs.rise),
      bbox: boundingRect(corners),
      size: gs.fontSize * Math.hypot(start[2], start[3]),
      angle: (Math.atan2(start[1], start[0]) * 180) / Math.PI,
      color: gs.fill,
      advance,
      parts: showParts,
      fontSize: gs.fontSize,
      horizontalScale: gs.horizontalScale,
      matrix: local,
      userMatrix: start,
      state: {
        fontName: gs.fontName,
        fontSize: gs.fontSize,
        charSpacing: gs.charSpacing,
        wordSpacing: gs.wordSpacing,
        horizontalScale: gs.horizontalScale,
        rise: gs.rise,
        renderMode: gs.renderMode,
        lineWidth: gs.lineWidth,
        fillOps: `${gs.fillSpace} ${gs.fillColor}`.trim(),
        strokeOps: `${gs.strokeSpace} ${gs.strokeColor}`.trim(),
        extGStateOps: gs.extGState.trim(),
      },
    });
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };

  ops.forEach((op, i) => {
    const o = op.operands;
    switch (op.operator) {
      case "q":
        stack.push({ ...gs });
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm": {
        const m = nums(o);
        if (m.length === 6) gs = { ...gs, ctm: multiply(m as Matrix, gs.ctm) };
        break;
      }
      case "g":
      case "rg":
      case "k": {
        const color = toColor(nums(o));
        gs = {
          ...gs,
          fill: color ?? gs.fill,
          fillSpace: "",
          fillColor: verbatim(op),
        };
        break;
      }
      case "cs":
        // A new color space starts at its initial color (black for the usual ones).
        gs = { ...gs, fill: "#000000", fillSpace: verbatim(op), fillColor: "" };
        break;
      case "sc":
      case "scn": {
        const color = toColor(nums(o));
        gs = { ...gs, fill: color ?? gs.fill, fillColor: verbatim(op) };
        break;
      }
      case "G":
      case "RG":
      case "K":
        gs = { ...gs, strokeSpace: "", strokeColor: verbatim(op) };
        break;
      case "CS":
        gs = { ...gs, strokeSpace: verbatim(op), strokeColor: "" };
        break;
      case "SC":
      case "SCN":
        gs = { ...gs, strokeColor: verbatim(op) };
        break;
      case "w":
        gs = { ...gs, lineWidth: nums(o)[0] ?? gs.lineWidth };
        break;
      case "gs":
        gs = { ...gs, extGState: `${gs.extGState} ${verbatim(op)}` };
        break;
      case "Tr":
        gs = { ...gs, renderMode: nums(o)[0] ?? 0 };
        break;
      case "Do": {
        const name = o[0];
        if (
          typeof name === "object" &&
          name !== null &&
          "type" in name &&
          name.type === "name"
        )
          onDo?.(name.name, gs.ctm, i);
        break;
      }
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tc":
        gs = { ...gs, charSpacing: nums(o)[0] ?? 0 };
        break;
      case "Tw":
        gs = { ...gs, wordSpacing: nums(o)[0] ?? 0 };
        break;
      case "Tz":
        gs = { ...gs, horizontalScale: (nums(o)[0] ?? 100) / 100 };
        break;
      case "TL":
        gs = { ...gs, leading: nums(o)[0] ?? 0 };
        break;
      case "Ts":
        gs = { ...gs, rise: nums(o)[0] ?? 0 };
        break;
      case "Tf": {
        const name = o[0];
        gs = {
          ...gs,
          fontName:
            typeof name === "object" &&
            name !== null &&
            "type" in name &&
            name.type === "name"
              ? name.name
              : gs.fontName,
          fontSize: isNum(o[1]) ? o[1] : gs.fontSize,
        };
        break;
      }
      case "Td": {
        const [tx = 0, ty = 0] = nums(o);
        moveLine(tx, ty);
        break;
      }
      case "TD": {
        const [tx = 0, ty = 0] = nums(o);
        gs = { ...gs, leading: -ty };
        moveLine(tx, ty);
        break;
      }
      case "Tm": {
        const m = nums(o);
        if (m.length === 6) {
          tlm = m as Matrix;
          tm = tlm;
        }
        break;
      }
      case "T*":
        moveLine(0, -gs.leading);
        break;
      case "Tj":
        show(op, i, "Tj", o.slice(0, 1));
        break;
      case "TJ":
        show(op, i, "TJ", Array.isArray(o[0]) ? o[0] : []);
        break;
      case "'":
        moveLine(0, -gs.leading);
        show(op, i, "'", o.slice(0, 1));
        break;
      case '"': {
        const [aw = 0, ac = 0] = nums(o.slice(0, 2));
        gs = { ...gs, wordSpacing: aw, charSpacing: ac };
        moveLine(0, -gs.leading);
        show(op, i, '"', o.slice(2, 3));
        break;
      }
    }
  });
  return shows;
}
