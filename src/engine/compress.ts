// Spec 014: smaller PDFs. Images with more resolution than their page needs
// are scaled down and encoded again as JPEG, uncompressed streams are
// compressed, unused objects go and objects are packed in object streams.
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
} from "pdf-lib";
import {
  listOf,
  parmsOf,
  pruneUnreachable,
  unpredict,
  type ImageCodec,
} from "./redact";

export type CompressLevel = "high" | "balanced" | "small";

export const LEVELS: Record<
  CompressLevel,
  { dpi: number; quality: number; always: boolean }
> = {
  // Only images above the limit are touched.
  high: { dpi: 200, quality: 0.85, always: false },
  balanced: { dpi: 150, quality: 0.72, always: true },
  small: { dpi: 96, quality: 0.55, always: true },
};

/** A new image is kept only when it saves at least this much. */
const MIN_SAVING = 0.9;
const MAX_DEPTH = 12;

export interface CompressResult {
  bytes: Uint8Array;
  before: number;
  after: number;
  /** Images encoded again. */
  images: number;
}

const name = (key: string) => PDFName.of(key);

function inheritedResources(node: PDFDict, doc: PDFDocument) {
  for (let n: PDFDict | undefined = node, i = 0; n && i < 32; i++) {
    const r = n.lookup(name("Resources"));
    if (r instanceof PDFDict) return r;
    const parent: PDFObject | undefined = n.lookup(name("Parent"));
    n = parent instanceof PDFDict ? parent : undefined;
  }
  return doc.context.obj({});
}

/**
 * The largest number of pixels each image needs on a side: the longest side
 * of the largest page that shows it, in inches, times the resolution. The
 * image is never drawn larger than its page, so this never loses detail.
 */
function imageLimits(doc: PDFDocument, dpi: number) {
  const limits = new Map<PDFRef, number>();
  const visit = (
    resources: PDFDict,
    limit: number,
    depth: number,
    seen: Set<PDFRef>,
  ) => {
    if (depth > MAX_DEPTH) return;
    const xobjects = resources.lookup(name("XObject"));
    if (!(xobjects instanceof PDFDict)) return;
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef) || seen.has(value)) continue;
      const stream = doc.context.lookup(value);
      if (!(stream instanceof PDFStream)) continue;
      const subtype = stream.dict.lookup(name("Subtype"));
      if (subtype === name("Image"))
        limits.set(value, Math.max(limits.get(value) ?? 0, limit));
      else if (subtype === name("Form")) {
        const inner = stream.dict.lookup(name("Resources"));
        visit(
          inner instanceof PDFDict ? inner : resources,
          limit,
          depth + 1,
          new Set([...seen, value]),
        );
      }
    }
  };
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const limit = Math.ceil((Math.max(width, height) / 72) * dpi);
    visit(inheritedResources(page.node, doc), limit, 0, new Set());
  }
  return limits;
}

/** Color components when the image can be encoded again as sRGB, else 0. */
function simpleComponents(doc: PDFDocument, space: PDFObject | undefined) {
  const v = space === undefined ? undefined : doc.context.lookup(space);
  if (v instanceof PDFName)
    return (
      { DeviceGray: 1, G: 1, CalGray: 1, DeviceRGB: 3, RGB: 3, CalRGB: 3 }[
        v.decodeText()
      ] ?? 0
    );
  if (v instanceof PDFArray && v.size() >= 2) {
    const family = doc.context.lookup(v.get(0));
    if (family === name("CalGray")) return 1;
    if (family === name("CalRGB")) return 3;
    if (family === name("ICCBased")) {
      const icc = doc.context.lookup(v.get(1));
      const n =
        icc instanceof PDFStream ? icc.dict.lookup(name("N")) : undefined;
      const comps = n instanceof PDFNumber ? n.asNumber() : 0;
      return comps === 1 || comps === 3 ? comps : 0;
    }
  }
  return 0;
}

/** Area-average downscaling of RGBA pixels. */
export function downscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(toWidth * toHeight * 4);
  const sx = width / toWidth;
  const sy = height / toHeight;
  for (let y = 0; y < toHeight; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < toWidth; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      const sum = [0, 0, 0, 0];
      let total = 0;
      for (
        let yy = Math.floor(y0);
        yy < Math.min(height, Math.ceil(y1));
        yy++
      ) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (
          let xx = Math.floor(x0);
          xx < Math.min(width, Math.ceil(x1));
          xx++
        ) {
          const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          const k = (yy * width + xx) * 4;
          for (let c = 0; c < 4; c++) sum[c]! += rgba[k + c]! * w;
          total += w;
        }
      }
      const o = (y * toWidth + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = sum[c]! / total;
    }
  }
  return out;
}

/** The image as RGBA pixels, or null when it is not one this can redo. */
async function pixelsOf(
  doc: PDFDocument,
  stream: PDFRawStream,
  codec: ImageCodec,
): Promise<Uint8ClampedArray | null> {
  const dict = stream.dict;
  const get = (key: string) => dict.lookup(name(key));
  const width = (get("Width") as PDFNumber | undefined)?.asNumber() ?? 0;
  const height = (get("Height") as PDFNumber | undefined)?.asNumber() ?? 0;
  if (width < 1 || height < 1) return null;
  if (get("ImageMask") === PDFBool.True || dict.has(name("Decode")))
    return null;
  const comps = simpleComponents(doc, dict.get(name("ColorSpace")));
  if (!comps) return null;
  const filters = listOf(doc, dict.get(name("Filter")));
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    try {
      const decoded = await codec.decodeJpeg(stream.contents);
      return decoded.width === width && decoded.height === height
        ? decoded.data
        : null;
    } catch {
      return null;
    }
  }
  if (!filters.every((f) => f === "FlateDecode")) return null;
  const bpc = get("BitsPerComponent");
  if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) return null;
  let samples: Uint8Array;
  try {
    samples = filters.length
      ? decodePDFRawStream(stream).decode()
      : stream.contents;
  } catch {
    return null;
  }
  const rowBytes = width * comps;
  const parms = filters.length ? parmsOf(doc, dict, filters.length) : null;
  if (parms) {
    const out = unpredict(samples, parms, rowBytes);
    if (!out) return null;
    samples = out;
  }
  if (samples.length < rowBytes * height) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * comps;
    rgba[i * 4] = samples[s]!;
    rgba[i * 4 + 1] = samples[s + (comps === 3 ? 1 : 0)]!;
    rgba[i * 4 + 2] = samples[s + (comps === 3 ? 2 : 0)]!;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export async function compressPdf(
  bytes: Uint8Array,
  level: CompressLevel,
  codec: ImageCodec,
): Promise<CompressResult> {
  const { dpi, quality, always } = LEVELS[level];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  let images = 0;

  for (const [ref, limit] of imageLimits(doc, dpi)) {
    const stream = ctx.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    const width = (stream.dict.lookup(name("Width")) as PDFNumber).asNumber();
    const height = (stream.dict.lookup(name("Height")) as PDFNumber).asNumber();
    const scale = Math.min(1, limit / Math.max(width, height));
    if (scale === 1 && !always) continue;
    const rgba = await pixelsOf(doc, stream, codec);
    if (!rgba) continue;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const pixels = scale < 1 ? downscale(rgba, width, height, w, h) : rgba;
    const jpeg = await codec.encodeJpeg(pixels, w, h, quality);
    if (jpeg.length > stream.contents.length * MIN_SAVING) continue;
    const dict = ctx.obj({});
    for (const [key, value] of stream.dict.entries())
      if (
        ![
          "Filter",
          "DecodeParms",
          "Length",
          "ColorSpace",
          "BitsPerComponent",
          "Width",
          "Height",
        ].includes(key.decodeText())
      )
        dict.set(key, value);
    dict.set(name("Filter"), name("DCTDecode"));
    dict.set(name("ColorSpace"), name("DeviceRGB"));
    dict.set(name("BitsPerComponent"), ctx.obj(8));
    dict.set(name("Width"), ctx.obj(w));
    dict.set(name("Height"), ctx.obj(h));
    ctx.assign(ref, PDFRawStream.of(dict, jpeg));
    images++;
  }

  // Streams written without compression (except XMP, read as plain text).
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.contents.length < 64) continue;
    if (obj.dict.has(name("Filter"))) continue;
    if (obj.dict.lookup(name("Type")) === name("Metadata")) continue;
    const packed = ctx.flateStream(obj.contents, {});
    for (const [key, value] of obj.dict.entries())
      if (key !== name("Length")) packed.dict.set(key, value);
    packed.dict.set(name("Filter"), name("FlateDecode"));
    ctx.assign(ref, packed);
  }

  pruneUnreachable(doc);
  const out = await doc.save({
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  return {
    bytes: out.length < bytes.length ? out : bytes,
    before: bytes.length,
    after: Math.min(out.length, bytes.length),
    images,
  };
}
