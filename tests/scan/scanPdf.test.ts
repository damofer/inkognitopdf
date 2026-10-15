// Spec 002, CA8 (PDF output) and CA11 (time, in Node with margin).
import { createCanvas } from "@napi-rs/canvas";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  type PDFDict,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../../src/engine/applyEdits";
import { applyOperation } from "../../src/model/operations";
import type { Rgba } from "../../src/scan/image";
import { enhance, findCorners, rectify } from "../../src/scan/pipeline";
import {
  scanPage,
  toScanImage,
  type EncodeJpeg,
} from "../../src/scan/scanImage";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "../helpers";
import { synthPhoto, testPage } from "./synthPhoto";

export const encodeJpeg: EncodeJpeg = async (image: Rgba, quality: number) => {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(image.width, image.height);
  data.data.set(image.data);
  ctx.putImageData(data, 0, 0);
  return new Uint8Array(await canvas.encode("jpeg", Math.round(quality * 100)));
};

const source = testPage(150);

function imageOf(doc: PDFDocument, pageIndex: number): PDFRawStream {
  const page = doc.getPage(pageIndex);
  const xobjects = page.node
    .Resources()!
    .lookup(PDFName.of("XObject")) as PDFDict;
  const [name] = xobjects.keys();
  return doc.context.lookup(xobjects.get(name!)) as PDFRawStream;
}

describe("scanned pages to PDF (CA8)", () => {
  it(
    "writes 1-bit lossless and JPEG pages at 200 ppi, no watermark",
    { timeout: 60_000 },
    async () => {
      const { photo } = synthPhoto({
        seed: 401,
        page: source,
        width: 2400,
        height: 1800,
      });
      const t0 = performance.now();
      const { quad, found } = findCorners(photo);
      const page = rectify(photo, quad);
      const bw = enhance(page.image, "bw");
      const ms = performance.now() - t0;
      console.log(`detect + rectify + photocopy: ${ms.toFixed(0)} ms`);
      expect(found).toBe(true);
      // A4 detected from the proportions.
      expect(page.widthPt).toBeCloseTo(595.28, 1);
      const color = enhance(page.image, "original", 1);
      const pages = [
        scanPage("s1", await toScanImage(bw, encodeJpeg)),
        scanPage("s2", await toScanImage(color, encodeJpeg)),
      ];
      const { bytes } = await applyEdits(
        new Uint8Array(),
        { pages, items: [] },
        testDeps,
      );
      if (qpdfPath) await qpdfCheck(bytes);

      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(2);
      const [w1, h1] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
      expect(w1).toBeCloseTo(595.28, 0);
      expect(h1).toBeCloseTo(841.89, 0);
      // The rotated colour page is landscape.
      expect(doc.getPage(1).getWidth()).toBeCloseTo(841.89, 0);

      const one = imageOf(doc, 0);
      expect(one.dict.get(PDFName.of("BitsPerComponent"))).toEqual(
        PDFNumber.of(1),
      );
      expect(one.dict.get(PDFName.of("Filter"))).toEqual(
        PDFName.of("FlateDecode"),
      );
      const width = (one.dict.get(PDFName.of("Width")) as PDFNumber).asNumber();
      expect((width / w1) * 72).toBeCloseTo(200, 0);
      const two = imageOf(doc, 1);
      expect(two.dict.get(PDFName.of("Filter"))).toEqual(
        PDFName.of("DCTDecode"),
      );

      // Nothing else on the page: no text, no watermark.
      const pdf = await openPdf(bytes);
      for (const n of [1, 2]) {
        const text = await (await pdf.getPage(n)).getTextContent();
        expect(text.items).toHaveLength(0);
      }
      await pdf.loadingTask.destroy();
    },
  );

  it("adds scanned pages to an open document, with undo-able operations (CA9)", async () => {
    const original = await fixture("simple-text.pdf");
    const state = await stateFor(original);
    const { photo } = synthPhoto({
      seed: 402,
      page: testPage(80),
      width: 1200,
      height: 900,
    });
    const page = rectify(photo, findCorners(photo).quad, "auto", 100);
    const scan = scanPage(
      "scan-1",
      await toScanImage(enhance(page.image, "bw"), encodeJpeg),
      100,
    );
    const next = applyOperation(state, {
      kind: "insertPages",
      atIndex: 1,
      pages: [scan],
    });
    expect(next.pages.map((p) => p.id)).toEqual([
      "p0",
      "scan-1",
      ...state.pages.slice(1).map((p) => p.id),
    ]);
    const { bytes } = await applyEdits(original, next, testDeps);
    if (qpdfPath) await qpdfCheck(bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(state.pages.length + 1);
  });
});

describe("time (CA11, Node)", () => {
  it(
    "a 12 MP photo goes from detection to photocopy in under 3 s",
    { timeout: 120_000 },
    () => {
      const { photo } = synthPhoto({
        seed: 501,
        page: testPage(200),
        width: 4000,
        height: 3000,
      });
      const t0 = performance.now();
      const { quad, found } = findCorners(photo);
      const page = rectify(photo, quad);
      enhance(page.image, "bw");
      const ms = performance.now() - t0;
      console.log(`12 MP: ${ms.toFixed(0)} ms`);
      expect(found).toBe(true);
      expect(ms).toBeLessThan(3000);
    },
  );
});
