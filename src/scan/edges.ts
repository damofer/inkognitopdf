/**
 * Edges and straight lines (spec 002, HU2): Sobel, Canny and a Hough
 * transform restricted to each pixel's gradient direction.
 */
import type { Gray } from "./image";

export interface Edges {
  width: number;
  height: number;
  /** 1 where there is an edge. */
  mask: Uint8Array;
  /** Gradient direction (radians) at each pixel. */
  angle: Float32Array;
  magnitude: Float32Array;
}

function quantile(values: Float32Array, q: number): number {
  // Histogram over the range: exact enough and O(n).
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max === 0) return 0;
  const bins = new Uint32Array(1024);
  for (const v of values) bins[Math.min(1023, Math.floor((v / max) * 1023))]!++;
  const target = q * values.length;
  let seen = 0;
  for (let i = 0; i < 1024; i++) {
    seen += bins[i]!;
    if (seen >= target) return ((i + 1) / 1024) * max;
  }
  return max;
}

/** Canny edges of a (blurred) image. Thresholds are quantiles of the gradient. */
export function canny(src: Gray, highQuantile = 0.9, lowRatio = 0.4): Edges {
  const { width: w, height: h } = src;
  const d = src.data;
  const magnitude = new Float32Array(w * h);
  const angle = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        d[i - w + 1]! +
        2 * d[i + 1]! +
        d[i + w + 1]! -
        d[i - w - 1]! -
        2 * d[i - 1]! -
        d[i + w - 1]!;
      const gy =
        d[i + w - 1]! +
        2 * d[i + w]! +
        d[i + w + 1]! -
        d[i - w - 1]! -
        2 * d[i - w]! -
        d[i - w + 1]!;
      magnitude[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx);
    }
  // Non-maximum suppression along the gradient.
  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = magnitude[i]!;
      if (m === 0) continue;
      const a = angle[i]!;
      const dx = Math.round(Math.cos(a));
      const dy = Math.round(Math.sin(a));
      if (m >= magnitude[i + dy * w + dx]! && m > magnitude[i - dy * w - dx]!)
        thin[i] = m;
    }
  const high = Math.max(8, quantile(thin, highQuantile));
  const low = high * lowRatio;
  const mask = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++)
    if (thin[i]! >= high && !mask[i]) {
      mask[i] = 1;
      stack.push(i);
      while (stack.length > 0) {
        const j = stack.pop()!;
        const jx = j % w;
        const jy = (j - jx) / w;
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const nx = jx + ox;
            const ny = jy + oy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const k = ny * w + nx;
            if (!mask[k] && thin[k]! >= low) {
              mask[k] = 1;
              stack.push(k);
            }
          }
      }
    }
  return { width: w, height: h, mask, angle, magnitude };
}

/** A line x·cos θ + y·sin θ = ρ, with its vote count. */
export interface Line {
  theta: number;
  rho: number;
  votes: number;
}

/**
 * Hough transform. Each edge pixel votes only for directions within
 * `spread` of its gradient, which keeps text from flooding the accumulator.
 * Returns up to `count` peaks, at least `minGap` apart.
 */
export function houghLines(
  edges: Edges,
  count = 24,
  spread = (12 * Math.PI) / 180,
): Line[] {
  const { width: w, height: h, mask, angle } = edges;
  const steps = 180;
  const maxRho = Math.ceil(Math.hypot(w, h));
  const rhos = maxRho * 2 + 1;
  const acc = new Float32Array(steps * rhos);
  const cos = new Float32Array(steps);
  const sin = new Float32Array(steps);
  for (let t = 0; t < steps; t++) {
    cos[t] = Math.cos((t * Math.PI) / steps);
    sin[t] = Math.sin((t * Math.PI) / steps);
  }
  const reach = Math.ceil((spread / Math.PI) * steps);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // The line normal is the gradient direction, folded into [0, π).
      let a = angle[i]!;
      if (a < 0) a += Math.PI;
      const center = Math.round((a / Math.PI) * steps);
      for (let o = -reach; o <= reach; o++) {
        const t = (((center + o) % steps) + steps) % steps;
        const rho = Math.round(x * cos[t]! + y * sin[t]!);
        acc[t * rhos + rho + maxRho]! += 1;
      }
    }
  // Peaks: local maxima in a window, strongest first.
  const lines: Line[] = [];
  const winT = 2;
  const winR = 4;
  const candidates: number[] = [];
  for (let t = 0; t < steps; t++)
    for (let r = 0; r < rhos; r++)
      if (acc[t * rhos + r]! >= 20) candidates.push(t * rhos + r);
  candidates.sort((a, b) => acc[b]! - acc[a]!);
  const taken: { t: number; r: number }[] = [];
  for (const c of candidates) {
    if (lines.length >= count) break;
    const t = Math.floor(c / rhos);
    const r = c - t * rhos;
    const near = taken.some(
      (p) =>
        (Math.abs(p.t - t) <= winT || steps - Math.abs(p.t - t) <= winT) &&
        Math.abs(
          // Lines near θ = 0 and θ = π are the same with ρ negated.
          Math.abs(p.t - t) <= winT ? p.r - r : p.r - (rhos - 1 - r),
        ) <= winR,
    );
    if (near) continue;
    taken.push({ t, r });
    lines.push({
      theta: (t * Math.PI) / steps,
      rho: r - maxRho,
      votes: acc[c]!,
    });
  }
  return lines;
}
