// Spec 003, CA2 (O007): character error rate of Tesseract.js on synthetic
// pages, with the same engine, data and settings as the app.
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { join } from "node:path";
import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareForOcr } from "../src/ocr/preprocess";
import { bitmapToRgba } from "../src/scan/enhance";
import { rng, testPage, TEST_LINES, type TestPage } from "./scan/synthPhoto";

let worker: Worker;

beforeAll(async () => {
  worker = await createWorker("spa+eng", OEM.LSTM_ONLY, {
    langPath: join(import.meta.dirname, "..", "public", "tesseract"),
    gzip: true,
    cacheMethod: "none",
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    textord_tabfind_find_tables: "0",
  } as never);
}, 60_000);

afterAll(() => worker?.terminate());

/** Levenshtein distance. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

/** Every text line drawn on the test page. */
const EXPECTED = [
  TEST_LINES[0]!,
  ...[14, 12, 10].flatMap(() => TEST_LINES.slice(1)),
  ...Array.from({ length: 5 }, (_, r) =>
    [1, 2, 3].map((c) => `Celda ${r + 1}.${c}`).join(" "),
  ),
  TEST_LINES[1]!,
];

/** CER: each expected line against its closest recognized line. */
function cer(text: string): number {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  let errors = 0;
  let total = 0;
  for (const want of EXPECTED) {
    const best = Math.min(...lines.map((l) => distance(want, l)), want.length);
    errors += best;
    total += want.length;
  }
  return errors / total;
}

function png(page: TestPage, noise = 0, skew = 0, seed = 1): Buffer {
  const { width, height, data } = page.page;
  const source = createCanvas(width, height);
  const ctx = source.getContext("2d");
  const image = ctx.createImageData(width, height);
  const next = rng(seed);
  for (let i = 0; i < data.length; i++) {
    const n =
      noise *
      Math.sqrt(-2 * Math.log(Math.max(next(), 1e-12))) *
      Math.cos(2 * Math.PI * next());
    const v = data[i]! * 0.85 + 25 + n; // grey paper, ink not fully black
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  if (!skew) return prepared(source);
  const out = createCanvas(width, height);
  const o = out.getContext("2d");
  o.fillStyle = "rgb(242,242,242)";
  o.fillRect(0, 0, width, height);
  o.translate(width / 2, height / 2);
  o.rotate((skew * Math.PI) / 180);
  o.drawImage(source, -width / 2, -height / 2);
  return prepared(out);
}

/** The page after the app's clean-up, as PNG. */
function prepared(canvas: Canvas): Buffer {
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const clean = bitmapToRgba(prepareForOcr({ width, height, data }));
  const image = ctx.createImageData(width, height);
  image.data.set(clean.data);
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/png");
}

describe("OCR accuracy (CA2)", () => {
  const page300 = testPage(300);

  it("clean page at 300 ppi: CER < 3%", { timeout: 60_000 }, async () => {
    const { data } = await worker.recognize(png(page300));
    const rate = cer(data.text);
    console.log(`CER limpio 300 ppp: ${(rate * 100).toFixed(2)} %`);
    expect(rate).toBeLessThan(0.03);
  });

  it(
    "noise and 3° skew at 300 ppi: CER < 8%",
    { timeout: 60_000 },
    async () => {
      const { data } = await worker.recognize(png(page300, 18, 3, 7));
      const rate = cer(data.text);
      console.log(`CER ruido + 3°, 300 ppp: ${(rate * 100).toFixed(2)} %`);
      expect(rate).toBeLessThan(0.08);
    },
  );

  it("150 ppi is recorded, not required", { timeout: 60_000 }, async () => {
    const { data } = await worker.recognize(png(testPage(150)));
    console.log(`CER limpio 150 ppp: ${(cer(data.text) * 100).toFixed(2)} %`);
  });
});
