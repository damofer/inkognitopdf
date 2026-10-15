// Spec 014: compressing a PDF scales images down to what their page needs,
// encodes them again as JPEG and drops what nothing uses.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { compressPdf, downscale } from "../src/engine/compress";
import { decryptPdf, encryptPdf } from "../src/engine/pdfCrypto";
import { pageText, qpdfCheck, qpdfPath, testCodec } from "./helpers";

/** RGBA pixels of a gradient with some grain, like a photo of a page. */
function photo(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const grain = (seed >>> 24) % 24;
      const k = (y * width + x) * 4;
      rgba[k] = (x * 255) / width + grain;
      rgba[k + 1] = (y * 255) / height + grain;
      rgba[k + 2] = 128 + grain;
      rgba[k + 3] = 255;
    }
  return rgba;
}

/** One page with a large JPEG, one with a large Flate image, and junk. */
async function heavyPdf() {
  const doc = await PDFDocument.create();
  const jpeg = await testCodec.encodeJpeg(photo(1600, 1600), 1600, 1600, 0.95);
  const image = await doc.embedJpg(jpeg);
  const first = doc.addPage([300, 300]);
  first.drawImage(image, { x: 0, y: 0, width: 300, height: 300 });
  first.drawText("Pagina con foto 9911", { x: 20, y: 20, size: 12 });

  const ctx = doc.context;
  const rgba = photo(900, 900);
  const rgb = new Uint8Array(900 * 900 * 3);
  for (let i = 0; i < 900 * 900; i++)
    rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  const flate = ctx.flateStream(rgb, {
    Type: "XObject",
    Subtype: "Image",
    Width: 900,
    Height: 900,
    ColorSpace: "DeviceRGB",
    BitsPerComponent: 8,
  });
  const flateRef = ctx.register(flate);
  const second = doc.addPage([200, 200]);
  second.node.setXObject(PDFName.of("Im9"), flateRef);
  const content = ctx.flateStream("q 200 0 0 200 0 0 cm /Im9 Do Q");
  second.node.addContentStream(ctx.register(content));

  ctx.register(ctx.flateStream(new Uint8Array(200_000).map((_, i) => i * 7)));
  return { bytes: await doc.save(), jpeg: image.ref, flate: flateRef };
}

const sizeOf = (
  doc: PDFDocument,
  ref: ReturnType<PDFDocument["context"]["register"]>,
) => {
  const stream = doc.context.lookup(ref) as PDFRawStream;
  const n = (key: string) =>
    (stream.dict.lookup(PDFName.of(key)) as PDFNumber).asNumber();
  return { width: n("Width"), height: n("Height"), stream };
};

describe("compressPdf (spec 014)", () => {
  it("balanced: images fit 150 dpi of their page and the file shrinks", async () => {
    const { bytes, jpeg, flate } = await heavyPdf();
    const result = await compressPdf(bytes, "balanced", testCodec);
    expect(result.before).toBe(bytes.length);
    expect(result.after).toBe(result.bytes.length);
    expect(result.after).toBeLessThan(result.before * 0.5);
    expect(result.images).toBe(2);
    const doc = await PDFDocument.load(result.bytes);
    // 300 pt = 4.17 in → 625 px; 200 pt = 2.78 in → 417 px.
    expect(sizeOf(doc, jpeg).width).toBe(625);
    const second = sizeOf(doc, flate);
    expect(second.width).toBe(417);
    expect(second.stream.dict.lookup(PDFName.of("Filter"))).toBe(
      PDFName.of("DCTDecode"),
    );
    expect(doc.getPageCount()).toBe(2);
    expect(await pageText(result.bytes, 1)).toBe("Pagina con foto 9911");
    if (qpdfPath) await qpdfCheck(result.bytes);
  });

  it("smaller presets give smaller files", async () => {
    const { bytes } = await heavyPdf();
    const high = await compressPdf(bytes, "high", testCodec);
    const small = await compressPdf(bytes, "small", testCodec);
    expect(high.after).toBeLessThan(bytes.length);
    expect(small.after).toBeLessThan(high.after);
  });

  it("high quality leaves images that already fit alone", async () => {
    const doc = await PDFDocument.create();
    const jpeg = await testCodec.encodeJpeg(photo(300, 300), 300, 300, 0.95);
    const image = await doc.embedJpg(jpeg);
    doc.addPage([300, 300]).drawImage(image, { x: 0, y: 0 });
    const bytes = await doc.save();
    const result = await compressPdf(bytes, "high", testCodec);
    expect(result.images).toBe(0);
    expect(result.after).toBeLessThanOrEqual(result.before);
  });

  it("never returns a larger file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const bytes = await doc.save({ useObjectStreams: true });
    const result = await compressPdf(bytes, "small", testCodec);
    expect(result.after).toBeLessThanOrEqual(bytes.length);
    expect(result.bytes.length).toBe(result.after);
  });

  it("downscale averages the area each new pixel covers", () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255, 200, 100, 0, 255, 100, 50, 0, 255, 100, 50, 0, 255,
    ]);
    expect([...downscale(rgba, 2, 2, 1, 1)]).toEqual([100, 50, 0, 255]);
  });
});

// The local corpus of real PDFs (not in the repository; see realWorld.test.ts).
const corpus = process.env.REAL_PDFS ?? join(import.meta.dirname, "real-pdfs");
const realFiles = existsSync(corpus)
  ? readdirSync(corpus).filter((f) => f.toLowerCase().endsWith(".pdf"))
  : [];

describe.skipIf(realFiles.length === 0)("real PDFs (spec 014)", () => {
  for (const name of realFiles)
    it(`${name}: compressed and protected, same pages and text`, async () => {
      const bytes = new Uint8Array(await readFile(join(corpus, name)));
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      const text = await pageText(bytes, 1);
      const small = await compressPdf(bytes, "balanced", testCodec);
      expect(small.after).toBeLessThanOrEqual(bytes.length);
      expect((await PDFDocument.load(small.bytes)).getPageCount()).toBe(pages);
      expect(await pageText(small.bytes, 1)).toBe(text);
      const locked = await encryptPdf(small.bytes, {
        password: "x",
        allowPrint: true,
        allowCopy: true,
      });
      const open = await decryptPdf(locked, "x");
      expect(await pageText(open.bytes, 1)).toBe(text);
      if (qpdfPath) await qpdfCheck(open.bytes);
    }, 60_000);
});
