import { t } from "../i18n";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import type { Point, Rect } from "../model/geometry";
import { boundingRect } from "../model/geometry";
import {
  parseContentStream,
  type ContentOp,
  type Operand,
} from "./contentStream";
import { fontsOf } from "./pdfFonts";
import {
  addResource,
  ascii,
  concat,
  matrixOf,
  pageContentBytes,
  rewriteShow,
  streamBytes,
} from "./textEdit";
import {
  IDENTITY,
  apply,
  findTextShows,
  multiply,
  type Matrix,
  type ShowPart,
  type TextShow,
} from "./textShows";

/**
 * Secure redaction (spec 012). Everything under the areas is taken out of the
 * file, never just covered:
 *  - glyphs whose box touches an area are removed from the content of the
 *    page and of the forms it draws (visible or not), keeping the position of
 *    the rest of the text;
 *  - the pixels of images under an area are overwritten and the image is
 *    encoded again (its soft mask too); images that cannot be decoded are
 *    removed from the page; inline images that touch an area are removed;
 *  - painted paths inside an area are removed;
 *  - annotations and form fields that touch an area are removed;
 *  - alternate text of the touched marked content and structure is removed.
 * Changed streams, forms, images and resource dictionaries are new objects:
 * whatever else uses the originals keeps them. `cleanFile` then drops every
 * object no longer referenced, so the old streams are not saved.
 */

/** Decodes and encodes JPEG images (a canvas in the browser). */
export interface ImageCodec {
  decodeJpeg(
    bytes: Uint8Array,
  ): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  /** RGBA pixels to a JPEG. */
  encodeJpeg(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
  ): Promise<Uint8Array>;
}

const MAX_DEPTH = 12;
/** Overlap below this (user space units) does not count as touching. */
const EPS = 0.01;
/** Glyph box across the baseline, in em: the usual descender and ascender. */
export const GLYPH_DESCENT = 0.25;
export const GLYPH_ASCENT = 0.9;

export const overlaps = (a: Rect, b: Rect) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPS &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPS;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  inner.x + inner.width <= outer.x + outer.width + EPS &&
  inner.y + inner.height <= outer.y + outer.height + EPS;

const transformRect = (m: Matrix, r: Rect): Rect =>
  boundingRect([
    apply(m, r.x, r.y),
    apply(m, r.x + r.width, r.y),
    apply(m, r.x + r.width, r.y + r.height),
    apply(m, r.x, r.y + r.height),
  ]);

function invert(m: Matrix): Matrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

const UNIT: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** Box of a glyph in user space (along its advance, descender to ascender). */
export function glyphBox(
  show: TextShow,
  part: Extract<ShowPart, { kind: "glyph" }>,
): Rect {
  const fs = show.fontSize;
  const rise = show.state.rise;
  const width = Math.max(part.advance, Math.abs(fs) * 0.1);
  const y0 = rise - GLYPH_DESCENT * fs;
  const y1 = rise + GLYPH_ASCENT * fs;
  return boundingRect([
    apply(show.userMatrix, part.x, y0),
    apply(show.userMatrix, part.x + width, y0),
    apply(show.userMatrix, part.x + width, y1),
    apply(show.userMatrix, part.x, y1),
  ]);
}

const isName = (o: Operand | undefined): o is { type: "name"; name: string } =>
  typeof o === "object" &&
  o !== null &&
  !Array.isArray(o) &&
  "type" in o &&
  o.type === "name";

const nums = (o: Operand[]) =>
  o.filter((v): v is number => typeof v === "number");

/** A name token for a content stream. */
const nameToken = (name: string) =>
  "/" +
  [...name]
    .map((c) =>
      /[!-~]/.test(c) && !/[()<>[\]{}/%#]/.test(c)
        ? c
        : `#${(c.charCodeAt(0) & 0xff).toString(16).padStart(2, "0")}`,
    )
    .join("");

const ALT_KEYS = ["ActualText", "Alt", "E"];

interface Cut {
  start: number;
  end: number;
  text: string;
}

interface Marked {
  opIndex: number;
  tag: string;
  mcid: number | undefined;
  /** Its properties carry alternate text (ActualText, Alt, E). */
  alt: boolean;
  touched: boolean;
}

class Redactor {
  readonly warnings: string[] = [];
  /** Marked content ids of the page stream whose content changed. */
  readonly touchedMcids = new Set<number>();
  private imageFailed = false;

  constructor(
    private readonly doc: PDFDocument,
    private readonly areas: Rect[],
    private readonly codec: ImageCodec | undefined,
  ) {}

  private hits(box: Rect) {
    return this.areas.filter((a) => overlaps(a, box));
  }

  /**
   * New bytes and resources for a content stream, or null when nothing under
   * the areas was found in it (or in the forms it draws).
   */
  async stream(
    bytes: Uint8Array,
    resources: PDFDict | undefined,
    base: Matrix,
    path: PDFObject[],
  ): Promise<{ bytes: Uint8Array; resources: PDFDict | undefined } | null> {
    const ctx = this.doc.context;
    const ops = parseContentStream(bytes);
    const cuts: Cut[] = [];
    const touchedOps = new Set<number>();

    // Text: every glyph that touches an area.
    for (const show of findTextShows(ops, fontsOf(this.doc, resources), {
      base,
      source: bytes,
    })) {
      const drop = new Set<ShowPart>();
      for (const part of show.parts)
        if (part.kind === "glyph" && this.hits(glyphBox(show, part)).length)
          drop.add(part);
      if (drop.size === 0) continue;
      cuts.push({
        start: show.start,
        end: show.end,
        text: ` ${rewriteShow(show, ops[show.opIndex]!, drop)} `,
      });
      touchedOps.add(show.opIndex);
    }

    // Resources are copied on the first change.
    let own: PDFDict | null = null;
    const ownResources = () => {
      if (!own) {
        own = resources ? resources.clone(ctx) : ctx.obj({});
        const xobjects = own.lookup(PDFName.of("XObject"));
        own.set(
          PDFName.of("XObject"),
          xobjects instanceof PDFDict ? xobjects.clone(ctx) : ctx.obj({}),
        );
      }
      return own;
    };
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    const replaced = new Set<string>();
    const kept = new Set<string>();
    let inheritedForm = false;

    const marked: Marked[] = [];
    const touch = () => {
      for (const m of marked) {
        m.touched = true;
        if (m.mcid !== undefined && path.length === 0)
          this.touchedMcids.add(m.mcid);
      }
    };

    interface State {
      ctm: Matrix;
      lineWidth: number;
    }
    let gs: State = { ctm: IDENTITY, lineWidth: 1 };
    const stack: State[] = [];
    let pathStart = -1;
    let points: Point[] = [];
    let clip = false;
    const resetPath = () => {
      pathStart = -1;
      points = [];
      clip = false;
    };
    const user = () => multiply(gs.ctm, base);

    for (let i = 0; i < ops.length; i++) {
      const op: ContentOp = ops[i]!;
      const o = op.operands;
      if (touchedOps.has(i)) touch();
      switch (op.operator) {
        case "q":
          stack.push({ ...gs });
          break;
        case "Q":
          gs = stack.pop() ?? gs;
          break;
        case "cm": {
          const m = nums(o);
          if (m.length === 6)
            gs = { ...gs, ctm: multiply(m as Matrix, gs.ctm) };
          break;
        }
        case "w":
          gs = { ...gs, lineWidth: nums(o)[0] ?? gs.lineWidth };
          break;
        case "m":
        case "l":
        case "c":
        case "v":
        case "y":
        case "re": {
          if (pathStart < 0) pathStart = i;
          const m = user();
          const n = nums(o);
          if (op.operator === "re" && n.length === 4) {
            const [x, y, w, h] = n as [number, number, number, number];
            points.push(
              apply(m, x, y),
              apply(m, x + w, y),
              apply(m, x + w, y + h),
              apply(m, x, y + h),
            );
          } else
            for (let k = 0; k + 1 < n.length; k += 2)
              points.push(apply(m, n[k]!, n[k + 1]!));
          break;
        }
        case "W":
        case "W*":
          clip = true;
          break;
        case "n":
          resetPath();
          break;
        case "S":
        case "s":
        case "f":
        case "F":
        case "f*":
        case "B":
        case "B*":
        case "b":
        case "b*": {
          if (pathStart >= 0 && !clip && points.length > 0) {
            const box = boundingRect(points);
            if (!/^[fF]/.test(op.operator)) {
              const m = user();
              const pad =
                (gs.lineWidth *
                  Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))) /
                2;
              box.x -= pad;
              box.y -= pad;
              box.width += 2 * pad;
              box.height += 2 * pad;
            }
            if (this.areas.some((a) => contains(a, box))) {
              cuts.push({
                start: ops[pathStart]!.start,
                end: op.end,
                text: " ",
              });
              touch();
            }
          }
          resetPath();
          break;
        }
        case "BI": {
          if (this.hits(transformRect(user(), UNIT)).length) {
            cuts.push({ start: op.start, end: op.end, text: " " });
            touch();
          }
          break;
        }
        case "BDC":
        case "BMC": {
          const tag = isName(o[0]) ? o[0].name : "Span";
          let props: Record<string, unknown> | null = null;
          const p = o[1];
          if (
            op.operator === "BDC" &&
            p &&
            typeof p === "object" &&
            !Array.isArray(p)
          ) {
            if ("type" in p && p.type === "dict") props = p.entries;
            else if (isName(p)) {
              const list = resources?.lookup(PDFName.of("Properties"));
              const dict =
                list instanceof PDFDict
                  ? list.lookup(PDFName.of(p.name))
                  : undefined;
              if (dict instanceof PDFDict) {
                props = {};
                for (const [k, v] of dict.entries()) {
                  const value = ctx.lookup(v);
                  props[k.decodeText()] =
                    value instanceof PDFNumber ? value.asNumber() : value;
                }
              }
            }
          }
          const mcid = props?.MCID;
          marked.push({
            opIndex: i,
            tag,
            mcid: typeof mcid === "number" ? mcid : undefined,
            alt: !!props && ALT_KEYS.some((k) => k in props!),
            touched: false,
          });
          break;
        }
        case "EMC": {
          const m = marked.pop();
          if (m?.touched && m.alt) {
            const start = ops[m.opIndex]!;
            cuts.push({
              start: start.start,
              end: start.end,
              text:
                m.mcid === undefined
                  ? ` ${nameToken(m.tag)} BMC `
                  : ` ${nameToken(m.tag)} <</MCID ${m.mcid}>> BDC `,
            });
          }
          break;
        }
        case "Do": {
          if (!isName(o[0]) || !(xobjects instanceof PDFDict)) break;
          const name = o[0].name;
          const stream = xobjects.lookup(PDFName.of(name));
          if (!(stream instanceof PDFStream)) break;
          const subtype = stream.dict.lookup(PDFName.of("Subtype"));
          if (subtype === PDFName.of("Image")) {
            const m = user();
            const hits = this.hits(transformRect(m, UNIT));
            const inverse = invert(m);
            if (hits.length === 0 || !inverse) {
              kept.add(name);
              break;
            }
            const unit = hits.map((a) => transformRect(inverse, a));
            const image = await this.image(stream, unit);
            replaced.add(name);
            touch();
            if (!image) {
              this.imageFailed = true;
              cuts.push({ start: op.start, end: op.end, text: " " });
              break;
            }
            const newName = addResource(
              this.doc,
              ownResources(),
              "XObject",
              ctx.register(image),
              "PcR",
            );
            cuts.push({
              start: op.start,
              end: op.end,
              text: ` ${nameToken(newName)} Do `,
            });
            break;
          }
          if (
            subtype !== PDFName.of("Form") ||
            path.length >= MAX_DEPTH ||
            path.includes(stream)
          ) {
            kept.add(name);
            break;
          }
          const matrix = multiply(
            multiply(matrixOf(this.doc, stream.dict), gs.ctm),
            base,
          );
          const formResources = stream.dict.lookup(PDFName.of("Resources"));
          if (!(formResources instanceof PDFDict)) inheritedForm = true;
          const bbox = rectOf(this.doc, stream.dict.lookup(PDFName.of("BBox")));
          const formBytes = streamBytes(stream);
          if (
            !formBytes ||
            (bbox && this.hits(transformRect(matrix, bbox)).length === 0)
          ) {
            kept.add(name);
            break;
          }
          const child = await this.stream(
            formBytes,
            formResources instanceof PDFDict ? formResources : resources,
            matrix,
            [...path, stream],
          );
          if (!child) {
            kept.add(name);
            break;
          }
          // Copy-on-write: other uses of the form keep the original.
          const copy = ctx.flateStream(child.bytes);
          for (const [key, value] of stream.dict.entries())
            if (!["Length", "Filter", "DecodeParms"].includes(key.decodeText()))
              copy.dict.set(key, value);
          if (child.resources)
            copy.dict.set(PDFName.of("Resources"), child.resources);
          const newName = addResource(
            this.doc,
            ownResources(),
            "XObject",
            ctx.register(copy),
            "PcR",
          );
          replaced.add(name);
          touch();
          cuts.push({
            start: op.start,
            end: op.end,
            text: ` ${nameToken(newName)} Do `,
          });
          break;
        }
      }
    }

    if (cuts.length === 0) return null;
    // The originals leave the copied resources when nothing here uses them.
    if (own && !inheritedForm) {
      const dict = (own as PDFDict).lookup(PDFName.of("XObject"));
      if (dict instanceof PDFDict)
        for (const name of replaced)
          if (!kept.has(name)) dict.delete(PDFName.of(name));
    }
    cuts.sort((a, b) => a.start - b.start);
    const chunks: Uint8Array[] = [];
    let pos = 0;
    for (const cut of cuts) {
      if (cut.start < pos) continue;
      chunks.push(bytes.subarray(pos, cut.start), ascii(cut.text));
      pos = cut.end;
    }
    chunks.push(bytes.subarray(pos));
    return { bytes: concat(chunks), resources: own ?? resources };
  }

  /**
   * A copy of an image with the samples under `unit` (rects in the image's
   * unit square) overwritten, or null when the image cannot be processed.
   */
  async image(stream: PDFStream, unit: Rect[]): Promise<PDFStream | null> {
    const ctx = this.doc.context;
    const dict = stream.dict;
    const width = numberOf(this.doc, dict.lookup(PDFName.of("Width")));
    const height = numberOf(this.doc, dict.lookup(PDFName.of("Height")));
    if (!width || !height) return null;
    const filters = listOf(this.doc, dict.lookup(PDFName.of("Filter")));
    const skip = new Set([
      "Length",
      "Filter",
      "DecodeParms",
      "SMask",
      "Mask",
      "Alternates",
      "Metadata",
      "OPI",
      "Thumb",
    ]);
    const copyDict = (into: PDFDict, extraSkip: string[] = []) => {
      for (const [key, value] of dict.entries()) {
        const k = key.decodeText();
        if (!skip.has(k) && !extraSkip.includes(k)) into.set(key, value);
      }
    };
    let copy: PDFStream;

    if (filters.includes("DCTDecode")) {
      if (
        filters.length !== 1 ||
        !this.codec ||
        !(stream instanceof PDFRawStream)
      )
        return null;
      if (dict.lookup(PDFName.of("ImageMask")) === PDFBool.True) return null;
      let decoded;
      try {
        decoded = await this.codec.decodeJpeg(stream.contents);
      } catch {
        return null;
      }
      if (decoded.width !== width || decoded.height !== height) return null;
      const rgba = decoded.data;
      for (const r of unit) {
        const { x0, x1, y0, y1 } = pixelRange(r, width, height);
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const k = (y * width + x) * 4;
            rgba[k] = rgba[k + 1] = rgba[k + 2] = 0;
            rgba[k + 3] = 255;
          }
      }
      const jpeg = await this.codec.encodeJpeg(rgba, width, height);
      copy = ctx.stream(jpeg, {});
      copyDict(copy.dict, ["ColorSpace", "BitsPerComponent", "Decode"]);
      copy.dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      copy.dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
      copy.dict.set(PDFName.of("BitsPerComponent"), ctx.obj(8));
    } else {
      const layout = sampleLayout(this.doc, dict, width);
      if (!layout) return null;
      let samples: Uint8Array;
      try {
        samples =
          stream instanceof PDFRawStream
            ? decodePDFRawStream(stream).decode()
            : (streamBytes(stream) ?? new Uint8Array());
      } catch {
        return null;
      }
      const parms = parmsOf(this.doc, dict, filters.length);
      if (parms) {
        const out = unpredict(samples, parms, layout.rowBytes);
        if (!out) return null;
        samples = out;
      }
      if (samples.length < layout.rowBytes * height) return null;
      samples = samples.slice(0, layout.rowBytes * height);
      for (const r of unit) {
        const { x0, x1, y0, y1 } = pixelRange(r, width, height);
        for (let y = y0; y < y1; y++)
          clearBits(
            samples,
            y * layout.rowBytes * 8 + x0 * layout.bitsPerPixel,
            y * layout.rowBytes * 8 + x1 * layout.bitsPerPixel,
          );
      }
      copy = ctx.flateStream(samples, {});
      copyDict(copy.dict);
    }

    // Masks hold the same shapes: they are redacted too.
    for (const key of ["SMask", "Mask"]) {
      const mask = dict.lookup(PDFName.of(key));
      if (mask instanceof PDFStream) {
        const redacted = await this.image(mask, unit);
        if (!redacted) return null;
        copy.dict.set(PDFName.of(key), ctx.register(redacted));
      } else if (mask)
        copy.dict.set(PDFName.of(key), dict.get(PDFName.of(key))!);
    }
    return copy;
  }

  finish(pageNumber: number) {
    if (this.imageFailed)
      this.warnings.push(t("redact.imageRemoved", pageNumber));
  }
}

function numberOf(doc: PDFDocument, obj: PDFObject | undefined): number {
  const v = obj === undefined ? undefined : doc.context.lookup(obj);
  return v instanceof PDFNumber ? v.asNumber() : 0;
}

function rectOf(doc: PDFDocument, obj: PDFObject | undefined): Rect | null {
  if (!(obj instanceof PDFArray) || obj.size() !== 4) return null;
  const [x0, y0, x1, y1] = obj.asArray().map((v) => numberOf(doc, v)) as [
    number,
    number,
    number,
    number,
  ];
  return boundingRect([
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ]);
}

function listOf(doc: PDFDocument, obj: PDFObject | undefined): string[] {
  const v = obj === undefined ? undefined : doc.context.lookup(obj);
  if (v instanceof PDFName) return [v.decodeText()];
  if (v instanceof PDFArray)
    return v
      .asArray()
      .map((x) => doc.context.lookup(x))
      .filter((x): x is PDFName => x instanceof PDFName)
      .map((x) => x.decodeText());
  return [];
}

/** Pixel columns and rows of a rect in the image's unit square. */
function pixelRange(r: Rect, width: number, height: number) {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  // Rounding noise must not add a whole row or column.
  const floor = (v: number) => Math.floor(v + 1e-6);
  const ceil = (v: number) => Math.ceil(v - 1e-6);
  return {
    x0: clamp(floor(r.x * width), width),
    x1: clamp(ceil((r.x + r.width) * width), width),
    // Row 0 is the top of the image (unit y = 1).
    y0: clamp(floor((1 - r.y - r.height) * height), height),
    y1: clamp(ceil((1 - r.y) * height), height),
  };
}

/** Components of an image color space, or 0 when unknown. */
function componentsOf(doc: PDFDocument, space: PDFObject | undefined): number {
  const v = space === undefined ? undefined : doc.context.lookup(space);
  if (v instanceof PDFName)
    return (
      {
        DeviceGray: 1,
        CalGray: 1,
        G: 1,
        DeviceRGB: 3,
        RGB: 3,
        CalRGB: 3,
        Lab: 3,
        DeviceCMYK: 4,
        CMYK: 4,
        Indexed: 1,
        I: 1,
      }[v.decodeText()] ?? 0
    );
  if (v instanceof PDFArray && v.size() > 0) {
    const family = doc.context.lookup(v.get(0));
    if (!(family instanceof PDFName)) return 0;
    switch (family.decodeText()) {
      case "Indexed":
      case "I":
      case "Separation":
      case "CalGray":
        return 1;
      case "CalRGB":
      case "Lab":
        return 3;
      case "ICCBased": {
        const icc = doc.context.lookup(v.get(1));
        return icc instanceof PDFStream
          ? numberOf(doc, icc.dict.lookup(PDFName.of("N")))
          : 0;
      }
      case "DeviceN": {
        const names = doc.context.lookup(v.get(1));
        return names instanceof PDFArray ? names.size() : 0;
      }
      default:
        return componentsOf(doc, family);
    }
  }
  return 0;
}

function sampleLayout(doc: PDFDocument, dict: PDFDict, width: number) {
  const mask = dict.lookup(PDFName.of("ImageMask")) === PDFBool.True;
  const bpc = mask
    ? 1
    : numberOf(doc, dict.lookup(PDFName.of("BitsPerComponent")));
  // A soft mask has no color space: one gray component.
  const comps = mask
    ? 1
    : dict.has(PDFName.of("ColorSpace"))
      ? componentsOf(doc, dict.get(PDFName.of("ColorSpace")))
      : 1;
  if (![1, 2, 4, 8, 16].includes(bpc) || comps < 1) return null;
  const bitsPerPixel = bpc * comps;
  return {
    bpc,
    comps,
    bitsPerPixel,
    rowBytes: Math.ceil((width * bitsPerPixel) / 8),
  };
}

interface Predictor {
  predictor: number;
  colors: number;
  bpc: number;
  columns: number;
}

/** Predictor parameters of the last filter (Flate or LZW), when it has one. */
function parmsOf(
  doc: PDFDocument,
  dict: PDFDict,
  filters: number,
): Predictor | null {
  let parms = dict.lookup(PDFName.of("DecodeParms"));
  if (parms instanceof PDFArray)
    parms = doc.context.lookup(parms.get(filters - 1));
  if (!(parms instanceof PDFDict)) return null;
  const get = (key: string, fallback: number) => {
    const v = parms.lookup(PDFName.of(key));
    return v instanceof PDFNumber ? v.asNumber() : fallback;
  };
  const predictor = get("Predictor", 1);
  if (predictor <= 1) return null;
  return {
    predictor,
    colors: get("Colors", 1),
    bpc: get("BitsPerComponent", 8),
    columns: get("Columns", 1),
  };
}

/** Undoes a PNG (10–15) or TIFF (2) predictor; null when not supported. */
export function unpredict(
  data: Uint8Array,
  p: Predictor,
  rowBytes: number,
): Uint8Array | null {
  const bytesPerRow = Math.ceil((p.columns * p.colors * p.bpc) / 8);
  if (bytesPerRow !== rowBytes) return null;
  if (p.predictor === 2) {
    if (p.bpc !== 8) return null;
    const out = data.slice();
    for (let row = 0; row * rowBytes < out.length; row++)
      for (let i = p.colors; i < rowBytes; i++) {
        const k = row * rowBytes + i;
        if (k >= out.length) break;
        out[k] = (out[k]! + out[k - p.colors]!) & 0xff;
      }
    return out;
  }
  if (p.predictor < 10) return null;
  const bpp = Math.max(1, Math.ceil((p.colors * p.bpc) / 8));
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = new Uint8Array(rows * rowBytes);
  for (let row = 0; row < rows; row++) {
    const type = data[row * (rowBytes + 1)]!;
    const src = row * (rowBytes + 1) + 1;
    const dst = row * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const raw = data[src + i]!;
      const left = i >= bpp ? out[dst + i - bpp]! : 0;
      const up = row > 0 ? out[dst - rowBytes + i]! : 0;
      const upLeft = row > 0 && i >= bpp ? out[dst - rowBytes + i - bpp]! : 0;
      let value: number;
      switch (type) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const base = left + up - upLeft;
          const pa = Math.abs(base - left);
          const pb = Math.abs(base - up);
          const pc = Math.abs(base - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return null;
      }
      out[dst + i] = value & 0xff;
    }
  }
  return out;
}

/** Sets bits [from, to) of `data` to zero (most significant bit first). */
export function clearBits(data: Uint8Array, from: number, to: number) {
  let bit = from;
  const clear = (b: number) => {
    data[b >> 3] = data[b >> 3]! & ~(0x80 >> (b % 8));
  };
  while (bit < to && bit % 8 !== 0) clear(bit++);
  while (bit + 8 <= to) {
    data[bit >> 3] = 0;
    bit += 8;
  }
  while (bit < to) clear(bit++);
}

const rectOfAnnot = (doc: PDFDocument, annot: PDFDict) =>
  rectOf(doc, annot.lookup(PDFName.of("Rect")));

/** Removes a field (or widget) from its parent's Kids or from the form. */
function removeField(doc: PDFDocument, node: PDFObject, depth = 0) {
  const dict = doc.context.lookup(node);
  if (!(dict instanceof PDFDict) || depth > MAX_DEPTH) return;
  const parentRef = dict.get(PDFName.of("Parent"));
  const parent = parentRef ? doc.context.lookup(parentRef) : undefined;
  const without = (array: PDFArray) => {
    for (let i = array.size() - 1; i >= 0; i--)
      if (array.get(i) === node || doc.context.lookup(array.get(i)) === dict)
        array.remove(i);
  };
  if (parent instanceof PDFDict) {
    const kids = parent.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray) {
      without(kids);
      if (kids.size() === 0) removeField(doc, parentRef!, depth + 1);
    }
    return;
  }
  const form = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(form instanceof PDFDict)) return;
  for (const key of ["Fields", "CO"]) {
    const list = form.lookup(PDFName.of(key));
    if (list instanceof PDFArray) without(list);
  }
}

/** Removes annotations (and fields) that touch an area, with their popups and replies. */
function redactAnnotations(doc: PDFDocument, page: PDFPage, areas: Rect[]) {
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return;
  const removed = new Set<PDFObject>();
  const isRemoved = (o: PDFObject | undefined) =>
    !!o && (removed.has(o) || removed.has(doc.context.lookup(o) as PDFObject));
  for (let changed = true; changed;) {
    changed = false;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i);
      const dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      const rect = rectOfAnnot(doc, dict);
      const popupOfRemoved =
        dict.lookup(PDFName.of("Subtype")) === PDFName.of("Popup") &&
        isRemoved(dict.get(PDFName.of("Parent")));
      if (
        (rect && areas.some((a) => overlaps(a, rect))) ||
        popupOfRemoved ||
        isRemoved(dict.get(PDFName.of("IRT")))
      ) {
        annots.remove(i);
        removed.add(entry);
        removed.add(dict);
        if (dict.lookup(PDFName.of("Subtype")) === PDFName.of("Widget"))
          removeField(doc, entry);
        changed = true;
      }
    }
  }
}

/** Removes the alternate text of structure elements whose content changed. */
function redactStructure(doc: PDFDocument, page: PDFRef, mcids: Set<number>) {
  if (mcids.size === 0) return;
  const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));
  if (!(root instanceof PDFDict)) return;
  const seen = new Set<PDFObject>();
  const clean = (elements: PDFDict[]) => {
    for (const el of elements)
      for (const key of ALT_KEYS) el.delete(PDFName.of(key));
  };
  const walk = (
    node: PDFObject | undefined,
    pg: PDFObject | undefined,
    parents: PDFDict[],
  ) => {
    if (node === undefined || seen.has(node)) return;
    if (node instanceof PDFRef) seen.add(node);
    const v = doc.context.lookup(node);
    if (v instanceof PDFNumber) {
      if (pg === page && mcids.has(v.asNumber())) clean(parents);
      return;
    }
    if (v instanceof PDFArray) {
      for (const k of v.asArray()) walk(k, pg, parents);
      return;
    }
    if (!(v instanceof PDFDict)) return;
    const type = v.lookup(PDFName.of("Type"));
    const ownPage = v.get(PDFName.of("Pg")) ?? pg;
    if (type === PDFName.of("MCR")) {
      const mcid = v.lookup(PDFName.of("MCID"));
      if (
        ownPage === page &&
        mcid instanceof PDFNumber &&
        mcids.has(mcid.asNumber())
      )
        clean(parents);
      return;
    }
    if (type === PDFName.of("OBJR")) return;
    walk(v.get(PDFName.of("K")), ownPage, [...parents, v]);
  };
  walk(root.get(PDFName.of("K")), undefined, []);
}

/**
 * Removes everything under `areas` (user space) from a page (spec 012). The
 * page must have its final content: run it after everything is drawn and
 * every font and image is embedded (`doc.flush()`).
 */
export async function redactPage(
  doc: PDFDocument,
  page: PDFPage,
  areas: Rect[],
  codec: ImageCodec | undefined,
  pageNumber: number,
): Promise<string[]> {
  if (areas.length === 0) return [];
  page.node.normalize();
  const redactor = new Redactor(doc, areas, codec);
  const result = await redactor.stream(
    pageContentBytes(doc, page),
    page.node.normalizedEntries().Resources,
    IDENTITY,
    [],
  );
  if (result) {
    page.node.set(
      PDFName.of("Contents"),
      doc.context.obj([
        doc.context.register(doc.context.flateStream(result.bytes)),
      ]),
    );
    if (result.resources)
      page.node.set(PDFName.of("Resources"), result.resources);
  }
  redactAnnotations(doc, page, areas);
  redactStructure(doc, page.ref, redactor.touchedMcids);
  // A thumbnail shows the page as it was; private data of other programs too.
  for (const key of ["Thumb", "PieceInfo"]) page.node.delete(PDFName.of(key));
  redactor.finish(pageNumber);
  return redactor.warnings;
}

/** Removes the document information, XMP metadata and private program data. */
export function clearMetadata(doc: PDFDocument) {
  doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
  for (const key of ["Metadata", "PieceInfo"])
    doc.catalog.delete(PDFName.of(key));
  for (const page of doc.getPages())
    for (const key of ["Metadata", "PieceInfo", "Thumb"])
      page.node.delete(PDFName.of(key));
}

/** Deletes every object that cannot be reached from the trailer. */
export function pruneUnreachable(doc: PDFDocument) {
  const ctx = doc.context;
  const reached = new Set<PDFRef>();
  const pending: PDFObject[] = [];
  const { Root, Info, Encrypt } = ctx.trailerInfo;
  for (const o of [Root, Info, Encrypt]) if (o) pending.push(o);
  while (pending.length > 0) {
    const obj = pending.pop()!;
    if (obj instanceof PDFRef) {
      if (reached.has(obj)) continue;
      reached.add(obj);
      const target = ctx.lookup(obj);
      if (target) pending.push(target);
    } else if (obj instanceof PDFDict)
      for (const [, value] of obj.entries()) pending.push(value);
    else if (obj instanceof PDFArray) pending.push(...obj.asArray());
    else if (obj instanceof PDFStream) pending.push(obj.dict);
  }
  for (const [ref] of ctx.enumerateIndirectObjects())
    if (!reached.has(ref)) ctx.delete(ref);
}

/**
 * Writes the saved file again without unreferenced objects (old streams,
 * earlier revisions, object streams of the original) and, if asked, without
 * metadata.
 */
export async function cleanFile(
  bytes: Uint8Array,
  options: { clearMetadata: boolean },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (options.clearMetadata) clearMetadata(doc);
  pruneUnreachable(doc);
  return doc.save({ updateFieldAppearances: false });
}
