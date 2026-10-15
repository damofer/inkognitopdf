// Spec 003, O017: light text on dark backgrounds. Pure image functions, and
// Tesseract on a synthetic book cover after each scanner mode.
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
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
import { bundledFontPath } from "./helpers";
import {
  COVER_TITLES,
  darkCover,
  darkPhotoPage,
  PHOTO_BOX,
} from "./ocr/darkCover";

/** A white page with a dark band (rows y0–y1) holding light text. */
function bandPage(w: number, h: number, y0: number, y1: number): Rgba {
  ensureFont();
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgb(40, 45, 130)";
  ctx.fillRect(0, y0, w, y1 - y0);
  ctx.fillStyle = "rgb(240, 240, 230)";
  ctx.font = "28px ArimoBold";
  ctx.fillText("TEXTO CLARO", 50, y0 + 60);
  // Dark text on the white part (a solid block stands for a bold heading).
  ctx.fillStyle = "rgb(20, 20, 20)";
  ctx.fillRect(50, 20, 100, 20);
  const data = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: data.data };
}

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Bold"), "ArimoBold");
  fontReady = true;
}

/** Share of ink pixels in a rectangle. */
function inkShare(b: Bitmap, x0: number, y0: number, x1: number, y1: number) {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (isInk(b, x, y)) n++;
  return n / ((x1 - x0) * (y1 - y0));
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
    expect(inkShare(bitmap, 50, 335, 260, 362)).toBeGreaterThan(0.15); // text
    expect(inkShare(bitmap, 0, 420, 400, 600)).toBeLessThan(0.01); // band
    expect(isInk(bitmap, 100, 30)).toBe(true); // dark text on white
    expect(isInk(bitmap, 300, 100)).toBe(false); // white paper
  });

  it("the greyscale mode leaves the dark band as it is", () => {
    const image = bandPage(400, 600, 300, 600);
    const out = readableGray(image);
    const raw = 0.299 * 40 + 0.587 * 45 + 0.114 * 130; // the band's colour
    expect(out.data[450 * 400 + 300]).toBeCloseTo(raw, 0);
  });

  it("a dark photo in a document is not a text background", async () => {
    const page = await darkPhotoPage();
    const v = gray(page.width, page.height);
    for (let i = 0; i < v.data.length; i++)
      v.data[i] =
        0.299 * page.data[i * 4]! +
        0.587 * page.data[i * 4 + 1]! +
        0.114 * page.data[i * 4 + 2]!;
    expect(darkBackground(v)).not.toBeNull(); // it is dark…
    expect(darkBackground(v, true)).toBeNull(); // …but holds no light text
  });

  it("the photocopy keeps a dark photo the right way round", async () => {
    const page = await darkPhotoPage();
    const bitmap = readableCopy(page);
    // Brightness of the photo's pixels that came out white and of those that
    // came out black: lights stay white, the night stays black.
    const { x0, y0, x1, y1 } = PHOTO_BOX;
    const sum = [0, 0];
    const count = [0, 0];
    for (let y = y0 + 4; y < y1 - 4; y++)
      for (let x = x0 + 4; x < x1 - 4; x++) {
        const i = (y * page.width + x) * 4;
        const light =
          0.299 * page.data[i]! +
          0.587 * page.data[i + 1]! +
          0.114 * page.data[i + 2]!;
        const k = isInk(bitmap, x, y) ? 1 : 0;
        sum[k]! += light;
        count[k]!++;
      }
    const white = sum[0]! / count[0]!;
    const black = sum[1]! / count[1]!;
    console.log(
      `foto oscura en la fotocopia: brillo medio de lo blanco ${white.toFixed(0)}, de lo negro ${black.toFixed(0)}`,
    );
    expect(white).toBeGreaterThan(black + 20);
    // The buildings stay black, their lit windows white.
    expect(
      inkShare(bitmap, x0 + 45, y0 + 180, x0 + 215, y0 + 465),
    ).toBeGreaterThan(0.6);
    expect(isInk(bitmap, x0 + 780, y0 + 140)).toBe(false); // the moon
    // The text around it is still there.
    expect(inkShare(bitmap, 120, 60, 1100, 200)).toBeGreaterThan(0.03);
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
