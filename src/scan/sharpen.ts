/**
 * Focus (spec 031): a photo taken slightly out of focus gives soft letters.
 * How blurred the rectified page is gets measured on its edges, and the page
 * is sharpened in proportion; a page in focus is left as it is. Everything
 * runs on the device.
 */
import { blur, fastBlur, gray, toGray, type Gray, type Rgba } from "./image";

/** Re-blur used to measure the blur (pixels). */
const PROBE = 2;
/** Weakest edge (grey levels per pixel) taken into account. */
const MIN_EDGE = 12;
/** Fewer edges than this: nothing to judge (a blank page, a picture). */
const MIN_EDGES = 500;
/** Edges measured at most (an even sample of all of them). */
const MAX_EDGES = 20000;
/** Below this measured blur the page is in focus and is not touched. */
const IN_FOCUS = 0.55;
/** From this measured blur on, full strength. */
const FULL = 0.7;
/** Widest correction (pixels), so a hopeless photo is not turned to noise. */
const MAX_SIGMA = 3.5;
/** Correction rounds (each one restores what the blur still hides). */
const ROUNDS = 2;
/** Detail smaller than this (grey levels) is noise, not text. */
const NOISE = 4;

/** Gaussian weights of σ `sigma`, out to 3σ. */
function weights(sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma);
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++)
    sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  return k.map((v) => v / sum);
}

/**
 * Blur of a page (Gaussian σ, in its pixels), or null when it has too few
 * edges to tell. An edge blurred by σ loses √(σ² + p²) / σ of its slope when
 * blurred again by p, so the median of that ratio on the crests of the edges
 * gives σ. Thin strokes make it read low, which only makes it cautious.
 */
export function blurLevel(g: Gray): number | null {
  const { width: w, height: h, data: d } = g;
  const k = weights(PROBE);
  const r = (k.length - 1) / 2;
  // The page blurred by PROBE at one pixel (the inside only).
  const soft = (i: number) => {
    let s = 0;
    for (let a = 0, row = i - r * w - r; a < k.length; a++, row += w) {
      let t = 0;
      for (let b = 0; b < k.length; b++) t += d[row + b]! * k[b]!;
      s += t * k[a]!;
    }
    return s;
  };
  const slope2 = (i: number) => {
    const gx = d[i + 1]! - d[i - 1]!;
    const gy = d[i + w]! - d[i - w]!;
    return (gx * gx + gy * gy) / 4;
  };
  const crests: number[] = [];
  const edge2 = MIN_EDGE * MIN_EDGE;
  const m = r + 2;
  for (let y = m; y < h - m; y++)
    for (let x = m; x < w - m; x++) {
      const i = y * w + x;
      const v = slope2(i);
      if (v < edge2) continue;
      // Only the crest of each edge.
      if (v < slope2(i - 1) || v < slope2(i + 1)) continue;
      if (v < slope2(i - w) || v < slope2(i + w)) continue;
      crests.push(i);
    }
  // An even sample of them is enough, and keeps a grainy page fast.
  const step = Math.max(1, crests.length / MAX_EDGES);
  const ratios: number[] = [];
  for (let n = 0; n < crests.length; n += step) {
    const i = crests[Math.floor(n)]!;
    const gx = soft(i + 1) - soft(i - 1);
    const gy = soft(i + w) - soft(i - w);
    const s2 = (gx * gx + gy * gy) / 4;
    ratios.push(Math.sqrt(slope2(i) / Math.max(1e-6, s2)));
  }
  if (ratios.length < MIN_EDGES) return null;
  ratios.sort((a, b) => a - b);
  const ratio = ratios[ratios.length >> 1]!;
  return ratio > 1 ? PROBE / Math.sqrt(ratio * ratio - 1) : Infinity;
}

/**
 * Brightness to add to each pixel of `v` so that it looks as if blurred by
 * `sigma` less: van Cittert's iteration x ← x + (v − G_σ ∗ x), ignoring
 * differences under the noise level, scaled by `strength`.
 */
export function focusDelta(v: Gray, sigma: number, strength = 1): Float32Array {
  let x = v;
  for (let k = 0; k < ROUNDS; k++) {
    const b = sigma < 2 ? blur(x, sigma) : fastBlur(x, sigma);
    const next = gray(v.width, v.height);
    for (let i = 0; i < v.data.length; i++) {
      const d = v.data[i]! - b.data[i]!;
      const kept = d > NOISE ? d - NOISE : d < -NOISE ? d + NOISE : 0;
      next.data[i] = Math.min(255, Math.max(0, x.data[i]! + kept));
    }
    x = next;
  }
  const delta = new Float32Array(v.data.length);
  for (let i = 0; i < delta.length; i++)
    delta[i] = (x.data[i]! - v.data[i]!) * strength;
  return delta;
}

/**
 * The page sharpened as much as it is blurred (CA1–CA3); the same object when
 * it is in focus or cannot be judged. Colour is kept: the correction is on
 * brightness only.
 */
export function sharpen(page: Rgba): Rgba {
  const luma = toGray(page);
  const level = blurLevel(luma);
  if (level === null || level < IN_FOCUS) return page;
  const strength = Math.min(1, (level - IN_FOCUS) / (FULL - IN_FOCUS));
  const delta = focusDelta(luma, Math.min(MAX_SIGMA, 2 * level), strength);
  const out = new Uint8ClampedArray(page.data.length);
  for (let i = 0, j = 0; j < delta.length; i += 4, j++) {
    const d = delta[j]!;
    out[i] = page.data[i]! + d;
    out[i + 1] = page.data[i + 1]! + d;
    out[i + 2] = page.data[i + 2]! + d;
    out[i + 3] = page.data[i + 3]!;
  }
  return { width: page.width, height: page.height, data: out };
}
