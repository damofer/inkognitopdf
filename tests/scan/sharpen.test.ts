// Spec 031: focus, on synthetic photos taken out of focus.
import { describe, expect, it } from "vitest";
import { photocopyGray, rowBytes, type Bitmap } from "../../src/scan/enhance";
import {
  blur,
  fastBlur,
  gray,
  toGray,
  type Gray,
  type Rgba,
} from "../../src/scan/image";
import { rectify } from "../../src/scan/pipeline";
import { blurLevel, sharpen } from "../../src/scan/sharpen";
import { rng, synthPhoto, testPage } from "./synthPhoto";

const page = testPage(200);
const { photo, corners } = synthPhoto({
  seed: 501,
  page,
  tilt: 20,
  width: 2400,
  height: 3200,
  noise: 0,
});

/** The photo as a camera out of focus by `sigma` would take it: blur, then sensor noise. */
function outOfFocus(sigma: number, noise = 4): Rgba {
  const next = rng(7);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  const out = new Uint8ClampedArray(photo.data.length);
  for (let c = 0; c < 3; c++) {
    const g = gray(photo.width, photo.height);
    for (let i = 0; i < g.data.length; i++) g.data[i] = photo.data[i * 4 + c]!;
    const b = sigma ? blur(g, sigma) : g;
    for (let i = 0; i < g.data.length; i++)
      out[i * 4 + c] = b.data[i]! + gauss() * noise;
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { width: photo.width, height: photo.height, data: out };
}

const scan = (image: Rgba) => rectify(image, corners, "auto", 200, false).image;

const scans = new Map<number, Rgba>();
/** The page scanned from the photo out of focus by `sigma` (made once). */
function softScan(sigma: number): Rgba {
  let s = scans.get(sigma);
  if (!s) scans.set(sigma, (s = scan(outOfFocus(sigma))));
  return s;
}

const ideal = toGray(scan(photo));
const idealCopy = photocopyGray(ideal);
const w = ideal.width;
// Pixels next to the letters, and paper far from them.
const nearInk = new Uint8Array(ideal.data.length);
const paper = new Uint8Array(ideal.data.length);
for (let y = 5; y < ideal.height - 5; y++)
  for (let x = 5; x < w - 5; x++) {
    let near = false;
    let any = false;
    for (let dy = -5; dy <= 5; dy++)
      for (let dx = -5; dx <= 5; dx++)
        if (ideal.data[(y + dy) * w + x + dx]! < 128) {
          any = true;
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) near = true;
        }
    nearInk[y * w + x] = near ? 1 : 0;
    paper[y * w + x] = any ? 0 : 1;
  }

const white = (b: Bitmap, x: number, y: number) =>
  (b.data[y * rowBytes(b.width) + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;

/** Share of the pixels around the letters that the B/W copy gets wrong. */
function copyError(g: Gray): number {
  const copy = photocopyGray(g);
  let wrong = 0;
  let total = 0;
  for (let y = 0; y < ideal.height; y++)
    for (let x = 0; x < w; x++) {
      if (!nearInk[y * w + x]) continue;
      total++;
      if (white(copy, x, y) !== white(idealCopy, x, y)) wrong++;
    }
  return wrong / total;
}

/** Mean grey difference to the photo in focus, on blank paper. */
function paperNoise(g: Gray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < g.data.length; i++)
    if (paper[i]) {
      sum += Math.abs(g.data[i]! - ideal.data[i]!);
      n++;
    }
  return sum / n;
}

describe("blurLevel", () => {
  it(
    "grows with the blur of the photo and reads low in focus",
    { timeout: 120_000 },
    () => {
      const levels = [0, 1, 2, 3].map((s) => blurLevel(toGray(softScan(s)))!);
      expect(levels[0]).toBeLessThan(0.55);
      for (let i = 1; i < levels.length; i++)
        expect(levels[i]).toBeGreaterThan(levels[i - 1]! + 0.15);
    },
  );

  it("does not judge a page without edges", () => {
    const blank = gray(400, 600);
    blank.data.fill(240);
    expect(blurLevel(blank)).toBeNull();
  });
});

describe("sharpen", () => {
  it("leaves a page in focus as it is (CA2)", { timeout: 60_000 }, () => {
    const sharp = softScan(0);
    expect(sharpen(sharp)).toBe(sharp);
  });

  it(
    "brings back the letters of a photo out of focus (CA1)",
    { timeout: 120_000 },
    () => {
      for (const [sigma, gain] of [
        [1, 0.5],
        [2, 0.8],
      ] as const) {
        const soft = softScan(sigma);
        const fixed = sharpen(soft);
        expect(fixed).not.toBe(soft);
        expect(copyError(toGray(fixed))).toBeLessThan(
          copyError(toGray(soft)) * gain,
        );
        // Without turning the paper grainy.
        expect(paperNoise(toGray(fixed))).toBeLessThan(
          paperNoise(toGray(soft)) + 0.5,
        );
      }
    },
  );

  it(
    "keeps the colours: every channel moves together",
    { timeout: 60_000 },
    () => {
      const soft = softScan(2);
      const fixed = sharpen(soft);
      let moved = 0;
      for (let i = 0; i < soft.data.length; i += 4) {
        const d = [0, 1, 2].map((c) => fixed.data[i + c]! - soft.data[i + c]!);
        const clipped = [0, 1, 2].some(
          (c) => fixed.data[i + c] === 0 || fixed.data[i + c] === 255,
        );
        if (!clipped)
          expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(1);
        if (d[0]) moved++;
      }
      expect(moved).toBeGreaterThan(0);
    },
  );
});

describe("fastBlur", () => {
  it("is close to a Gaussian blur", () => {
    const dot = gray(61, 61);
    dot.data[30 * 61 + 30] = 1000;
    for (const sigma of [2, 3.5]) {
      const exact = blur(dot, sigma);
      const fast = fastBlur(dot, sigma);
      const peak = Math.max(...exact.data);
      for (let i = 0; i < exact.data.length; i++)
        expect(Math.abs(fast.data[i]! - exact.data[i]!)).toBeLessThan(
          peak * 0.12,
        );
    }
  });
});
