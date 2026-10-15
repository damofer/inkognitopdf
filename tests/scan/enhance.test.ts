// Spec 002, CA5 and CA6: photocopy filter and the other modes.
import { describe, expect, it } from "vitest";
import { detectPage } from "../../src/scan/detect";
import {
  grayscale,
  photocopy,
  rotateRgba,
  rowBytes,
  type Bitmap,
} from "../../src/scan/enhance";
import { warp } from "../../src/scan/homography";
import { rankFilter, toGray, type Gray } from "../../src/scan/image";
import { synthPhoto, testPage } from "./synthPhoto";

const source = testPage(150);
const ideal = testPage(200);
const W = ideal.page.width;
const H = ideal.page.height;

const isInk = (b: Bitmap, i: number) => {
  const x = i % b.width;
  const y = (i - x) / b.width;
  return !(b.data[y * rowBytes(b.width) + (x >> 3)]! & (0x80 >> (x & 7)));
};

/** Mask (1/0) dilated by `r` pixels. */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const g: Gray = { width: w, height: h, data: Float32Array.from(mask) };
  return Uint8Array.from(rankFilter(g, r, true).data);
}

function measure(bw: Bitmap) {
  const n = W * H;
  const idealInk = new Uint8Array(n);
  for (let i = 0; i < n; i++) idealInk[i] = ideal.page.data[i]! < 128 ? 1 : 0;
  const outInk = new Uint8Array(n);
  for (let i = 0; i < n; i++) outInk[i] = isInk(bw, i) ? 1 : 0;
  const nearIdeal = dilate(idealInk, W, H, 2);
  const nearOut = dilate(outInk, W, H, 2);
  // Paper: far from any ink of the ideal page, and away from the page edge.
  const anyInk = Uint8Array.from(ideal.page.data, (v) => (v < 250 ? 1 : 0));
  const nearAny = dilate(anyInk, W, H, 4);
  let paper = 0;
  let white = 0;
  let outCount = 0;
  let outGood = 0;
  let idealCount = 0;
  let idealFound = 0;
  const m = 12;
  for (let y = m; y < H - m; y++)
    for (let x = m; x < W - m; x++) {
      const i = y * W + x;
      if (!nearAny[i]) {
        paper++;
        if (!outInk[i]) white++;
      }
      if (outInk[i]) {
        outCount++;
        if (nearIdeal[i]) outGood++;
      }
      if (idealInk[i]) {
        idealCount++;
        if (nearOut[i]) idealFound++;
      }
    }
  return {
    paperWhite: white / paper,
    precision: outGood / outCount,
    recall: idealFound / idealCount,
  };
}

describe("photocopy filter (CA5)", () => {
  for (const [seed, shadow, paperGrey] of [
    [301, 0.4, 200],
    [302, 0.4, 235],
    [303, 0.25, 210],
  ] as const)
    it(
      `shadow ${shadow * 100}%, paper ${paperGrey}`,
      { timeout: 60_000 },
      () => {
        const { photo } = synthPhoto({
          seed,
          page: source,
          shadow,
          paper: paperGrey,
          width: 2400,
          height: 1800,
          background: "texture",
        });
        const found = detectPage(toGray(photo))!;
        const page = warp(photo, found.quad, W, H);
        const t0 = performance.now();
        const bw = photocopy(page);
        const ms = performance.now() - t0;
        expect(bw.width).toBe(W);
        const m = measure(bw);
        console.log(seed, JSON.stringify(m), `${ms.toFixed(0)} ms`);
        expect(m.paperWhite).toBeGreaterThanOrEqual(0.99);
        expect(m.precision).toBeGreaterThanOrEqual(0.9);
        expect(m.recall).toBeGreaterThanOrEqual(0.9);
      },
    );
});

describe("other modes (CA6)", () => {
  it("greyscale normalises the paper and keeps the ink dark", () => {
    const { photo } = synthPhoto({
      seed: 310,
      page: source,
      shadow: 0.4,
      paper: 200,
    });
    const found = detectPage(toGray(photo))!;
    const page = warp(photo, found.quad, 600, 848);
    const g = grayscale(page);
    const sorted = Float32Array.from(g.data).sort();
    expect(sorted[Math.floor(sorted.length * 0.5)]!).toBeGreaterThan(240);
    expect(sorted[Math.floor(sorted.length * 0.005)]!).toBeLessThan(40);
  });

  it("rotates by quarter turns without losing pixels", () => {
    const data = new Uint8ClampedArray(3 * 2 * 4).map((_, i) => i);
    const img = { width: 3, height: 2, data };
    const r1 = rotateRgba(img, 1);
    expect([r1.width, r1.height]).toEqual([2, 3]);
    const back = rotateRgba(rotateRgba(rotateRgba(r1, 1), 1), 1);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });
});
