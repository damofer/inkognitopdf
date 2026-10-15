/**
 * Perspective correction (spec 002, HU4): 4-point homography, inverse bilinear
 * warp and the real aspect ratio of a photographed rectangle.
 */
import type { Rgba } from "./image";
import { ScanError } from "./protocol";

export interface Point {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Row-major 3×3 matrix. */
export type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Solves A x = b (n×n, row-major) by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Homography that maps each `from[i]` to `to[i]`. */
export function homography(from: Quad, to: Quad): Mat3 | null {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(a, b);
  if (!h) return null;
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function project(h: Mat3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Width / height of the real rectangle seen as `quad` in a photo of
 * `imageWidth` × `imageHeight`. Assumes square pixels and the principal point
 * at the image centre (Zhang & He, "Whiteboard scanning and image
 * enhancement", 2007). Falls back to the mean of opposite sides when the
 * focal length cannot be recovered (e.g. an almost fronto-parallel photo).
 */
export function aspectRatio(
  quad: Quad,
  imageWidth: number,
  imageHeight: number,
): number {
  const [tl, tr, br, bl] = quad;
  const fallback =
    (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br));
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const v = (p: Point): [number, number, number] => [p.x - cx, p.y - cy, 1];
  const m1 = v(tl);
  const m2 = v(tr);
  const m3 = v(bl);
  const m4 = v(br);
  const cross = (a: number[], b: number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const dot = (a: number[], b: number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((c, i) => k2 * c - m1[i]!);
  const n3 = m3.map((c, i) => k3 * c - m1[i]!);
  const [a1, a2, a3] = n2 as [number, number, number];
  const [b1, b2, b3] = n3 as [number, number, number];
  // Nearly affine: the vanishing points are at infinity, so f is unknown but
  // the ratio is the orthographic one.
  const scale = Math.max(imageWidth, imageHeight);
  if (Math.abs(a3 * b3) * scale * scale < 1e-6 * Math.abs(a1 * b1 + a2 * b2))
    return Math.sqrt((a1 * a1 + a2 * a2) / (b1 * b1 + b2 * b2)) || fallback;
  const f2 = -(a1 * b1 + a2 * b2) / (a3 * b3);
  if (!(f2 > 0) || !Number.isFinite(f2)) return fallback;
  const ratio = Math.sqrt(
    (a1 * a1 + a2 * a2 + f2 * a3 * a3) / (b1 * b1 + b2 * b2 + f2 * b3 * b3),
  );
  if (!Number.isFinite(ratio) || ratio <= 0) return fallback;
  // A wild estimate (unusual focal length) is worse than the simple one.
  if (ratio / fallback > 2 || fallback / ratio > 2) return fallback;
  return ratio;
}

/** Output size in pixels for `quad`: its longest side, with the real aspect ratio. */
export function outputSize(
  quad: Quad,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number } {
  const ratio = aspectRatio(quad, imageWidth, imageHeight);
  const [tl, tr, br, bl] = quad;
  const w = Math.max(dist(tl, tr), dist(bl, br));
  const h = Math.max(dist(tl, bl), dist(tr, br));
  if (w / ratio >= h)
    return { width: Math.round(w), height: Math.round(w / ratio) };
  return { width: Math.round(h * ratio), height: Math.round(h) };
}

/** Pixels of `quad` in `src` rectified to `width` × `height` (bilinear). */
export function warp(
  src: Rgba,
  quad: Quad,
  width: number,
  height: number,
): Rgba {
  const target: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const h = homography(target, quad);
  if (!h) throw new ScanError("scan.invalidQuad");
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const w = h[6] * px + h[7] * py + h[8];
      const fx = Math.min(
        Math.max((h[0] * px + h[1] * py + h[2]) / w - 0.5, 0),
        sw - 1,
      );
      const fy = Math.min(
        Math.max((h[3] * px + h[4] * py + h[5]) / w - 0.5, 0),
        sh - 1,
      );
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c]! * (1 - ax) + d[i10 + c]! * ax;
        const bottom = d[i01 + c]! * (1 - ax) + d[i11 + c]! * ax;
        out[o + c] = top * (1 - ay) + bottom * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** True when the four corners form a convex, non self-intersecting quad. */
export function isConvex(quad: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const c = quad[(i + 2) % 4]!;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function quadArea(quad: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i]!;
    const q = quad[(i + 1) % 4]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
