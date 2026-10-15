// Spec 003, O017: light text on dark backgrounds. Pure image functions, and
// Tesseract on a synthetic book cover after each scanner mode.
import { createCanvas } from "@napi-rs/canvas";
import { join } from "node:path";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareForOcr } from "../src/ocr/preprocess";
import {
  darkBackground,
  readableCopy,
  readableGray,
  removeSpecks,
} from "../src/scan/darkAreas";
import { bitmapToRgba, rowBytes, type Bitmap } from "../src/scan/enhance";
import { gray, type Rgba } from "../src/scan/image";
import { enhance } from "../src/scan/pipeline";
import { COVER_TITLES, darkCover } from "./ocr/darkCover";

/** A white page with a dark band (rows y0–y1) holding light strokes. */
function bandPage(w: number, h: number, y0: number, y1: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const text =
        y > y0 + 40 && y < y0 + 60 && x > 50 && x < 150 && x % 10 < 3;
      data[i] = text ? 240 : 40;
      data[i + 1] = text ? 240 : 45;
      data[i + 2] = text ? 230 : 130;
    }
  // Dark text on the white part.
  for (let y = 20; y < 40; y++)
    for (let x = 50; x < 150; x++)
      data.fill(20, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return { width: w, height: h, data };
}

const isInk = (b: Bitmap, x: number, y: number) =>
  !(b.data[y * rowBytes(b.width) + (x >> 3)]! & (0x80 >> (x & 7)));

function blank(w: number, h: number): Bitmap {
  return {
    width: w,
    height: h,
    data: new Uint8Array(rowBytes(w) * h).fill(0xff),
  };
}

function ink(b: Bitmap, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      b.data[y * rowBytes(b.width) + (x >> 3)]! &= ~(0x80 >> (x & 7));
}

describe("dark backgrounds", () => {
  it("a white page has none", () => {
    const page = gray(400, 300);
    page.data.fill(250);
    for (let i = 0; i < 4000; i++) page.data[i * 7] = 10;
    expect(darkBackground(page)).toBeNull();
  });

  it("finds a dark band and only it", () => {
    const image = bandPage(400, 600, 300, 600);
    const v = gray(400, 600);
    for (let i = 0; i < v.data.length; i++) v.data[i] = image.data[i * 4]!;
    const mask = darkBackground(v)!;
    expect(mask[450 * 400 + 200]).toBe(1);
    expect(mask[100 * 400 + 200]).toBe(0);
  });

  it("light text on it becomes ink, its background paper", () => {
    const bitmap = readableCopy(bandPage(400, 600, 300, 600));
    expect(isInk(bitmap, 101, 350)).toBe(true); // a light stroke
    expect(isInk(bitmap, 300, 450)).toBe(false); // the dark band
    expect(isInk(bitmap, 100, 30)).toBe(true); // dark text on white
    expect(isInk(bitmap, 300, 100)).toBe(false); // white paper
  });

  it("the greyscale mode leaves the dark band as it is", () => {
    const image = bandPage(400, 600, 300, 600);
    const out = readableGray(image);
    const raw = 0.299 * 40 + 0.587 * 45 + 0.114 * 130;
    expect(out.data[450 * 400 + 300]).toBeCloseTo(raw, 0);
  });

  it("removes lone specks there, not accents next to letters", () => {
    const b = blank(200, 200);
    ink(b, 20, 20, 23, 23); // a star
    ink(b, 100, 100, 130, 140); // a letter
    ink(b, 110, 94, 114, 97); // its accent, 3 px above
    ink(b, 170, 170, 173, 173); // a speck outside the dark area
    const inside = new Uint8Array(200 * 200);
    inside.fill(1, 0, 150 * 200);
    const clean = removeSpecks(b, inside, 8, 4);
    expect(isInk(clean, 21, 21)).toBe(false);
    expect(isInk(clean, 112, 95)).toBe(true);
    expect(isInk(clean, 115, 120)).toBe(true);
    expect(isInk(clean, 171, 171)).toBe(true);
  });

  it("costs little on an ordinary page at 300 ppi", () => {
    const page: Rgba = {
      width: 2550,
      height: 3300,
      data: new Uint8ClampedArray(2550 * 3300 * 4).fill(245),
    };
    const v = gray(2550, 3300);
    v.data.fill(245);
    const started = performance.now();
    expect(darkBackground(v)).toBeNull();
    const elapsed = performance.now() - started;
    console.log(
      `zonas oscuras en una página de 300 ppp: ${elapsed.toFixed(0)} ms`,
    );
    expect(elapsed).toBeLessThan(500);
    expect(readableCopy(page).width).toBe(2550);
  });
});

describe("OCR of a dark book cover (O017)", () => {
  let worker: Worker;

  beforeAll(async () => {
    worker = await createWorker("spa", OEM.LSTM_ONLY, {
      langPath: join(import.meta.dirname, "..", "public", "tesseract"),
      gzip: true,
      cacheMethod: "none",
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  }, 60_000);

  afterAll(() => worker?.terminate());

  /** As the app does: the scanned page drawn at 300 ppi, then cleaned up. */
  function prepared(image: Rgba): Buffer {
    const scale = 300 / 200;
    const source = createCanvas(image.width, image.height);
    const data = source
      .getContext("2d")
      .createImageData(image.width, image.height);
    data.data.set(image.data);
    source.getContext("2d").putImageData(data, 0, 0);
    const w = Math.round(image.width * scale);
    const h = Math.round(image.height * scale);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, w, h);
    const page = ctx.getImageData(0, 0, w, h);
    const clean = bitmapToRgba(
      prepareForOcr({ width: w, height: h, data: page.data }),
    );
    const out = ctx.createImageData(w, h);
    out.data.set(clean.data);
    ctx.putImageData(out, 0, 0);
    return canvas.toBuffer("image/png");
  }

  /** Letters and digits only, upper case: small capitals read either way. */
  const fold = (s: string) => s.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ");

  for (const mode of ["original", "gray", "bw"] as const)
    it(
      `reads the titles after the «${mode}» mode`,
      { timeout: 60_000 },
      async () => {
        const page = enhance(await darkCover(2), mode).image;
        const { data } = await worker.recognize(prepared(page));
        console.log(`portada (${mode}): ${data.text.replace(/\n+/g, " | ")}`);
        for (const title of COVER_TITLES)
          expect(fold(data.text)).toContain(fold(title));
      },
    );
});
