/**
 * Automatic page detection (spec 002, HU2): finds the four corners of a sheet
 * of paper in a photo. Classic pipeline on a reduced image: blur → Canny →
 * Hough lines → best quadrilateral from two "horizontal" and two "vertical"
 * lines, scored by edge support along its sides and by the contrast between
 * the (brighter) paper and the background. Lines are then refitted to the
 * edge pixels near them.
 */
import { canny, houghLines, type Edges, type Line } from "./edges";
import { isConvex, quadArea, type Point, type Quad } from "./homography";
import { blur, fitSize, shrink, type Gray } from "./image";

export interface DetectOptions {
  /** Long side of the working image, pixels. */
  workSize?: number;
  /** Minimum score (0–1) to accept a page. */
  minScore?: number;
}

interface FitLine {
  /** Unit normal and offset: n·p = c. */
  nx: number;
  ny: number;
  c: number;
}

const fromHough = (l: Line): FitLine => ({
  nx: Math.cos(l.theta),
  ny: Math.sin(l.theta),
  c: l.rho,
});

function intersect(a: FitLine, b: FitLine): Point | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.c * b.ny - a.ny * b.c) / det,
    y: (a.nx * b.c - a.c * b.nx) / det,
  };
}

/** Orders four points as TL, TR, BR, BL (clockwise in image coordinates). */
export function orderCorners(points: Point[]): Quad {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // atan2 order with y down is clockwise; start at the top-left one.
  let start = 0;
  for (let i = 1; i < 4; i++)
    if (sorted[i]!.x + sorted[i]!.y < sorted[start]!.x + sorted[start]!.y)
      start = i;
  return [0, 1, 2, 3].map((k) => sorted[(start + k) % 4]!) as Quad;
}

/** Edge support and paper/background contrast along one side. */
function sideScore(
  edges: Edges,
  image: Gray,
  a: Point,
  b: Point,
  center: Point,
): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(8, Math.round(len / 2));
  // Normal pointing to the inside of the quad.
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if ((center.x - mx) * nx + (center.y - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const { width: w, height: h } = edges;
  let support = 0;
  let contrast = 0;
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    inside++;
    let hit = false;
    for (let o = -2; o <= 2 && !hit; o++) {
      const px = Math.round(x + nx * o);
      const py = Math.round(y + ny * o);
      if (px >= 0 && py >= 0 && px < w && py < h && edges.mask[py * w + px])
        hit = true;
    }
    if (hit) support++;
    const at = (d: number) => {
      const px = Math.min(w - 1, Math.max(0, Math.round(x + nx * d)));
      const py = Math.min(h - 1, Math.max(0, Math.round(y + ny * d)));
      return image.data[py * w + px]!;
    };
    if (at(4) - at(-4) > 20) contrast++;
  }
  // Sides that leave the photo count as half supported (the page may be cut).
  const outside = n - inside;
  return (support + contrast + outside) / (2 * n);
}

/** Refits a line to the edge pixels within `band` of it (least squares). */
function refit(
  edges: Edges,
  line: FitLine,
  a: Point,
  b: Point,
  band = 3,
): FitLine {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.round(len);
  const { width: w, height: h, mask } = edges;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(1, steps);
    // Skip the ends, where other sides meet.
    if (t < 0.08 || t > 0.92) continue;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    let best = -1;
    let bestD = Infinity;
    for (let o = -band; o <= band; o++) {
      const px = Math.round(x + line.nx * o);
      const py = Math.round(y + line.ny * o);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      if (mask[py * w + px] && Math.abs(o) < bestD) {
        bestD = Math.abs(o);
        best = py * w + px;
      }
    }
    if (best >= 0) {
      xs.push(best % w);
      ys.push(Math.floor(best / w));
    }
  }
  if (xs.length < 10) return line;
  // Total least squares: direction = principal axis of the points.
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction of the line
  let nx = -Math.sin(theta);
  let ny = Math.cos(theta);
  if (nx * line.nx + ny * line.ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  // Pixel centres: +0.5.
  return { nx, ny, c: nx * (mx + 0.5) + ny * (my + 0.5) };
}

/** Mean absolute brightness difference across a line, sampled along it. */
function crossContrast(image: Gray, line: FitLine): number {
  const { width: w, height: h } = image;
  // Direction along the line.
  const dx = -line.ny;
  const dy = line.nx;
  const x0 = line.nx * line.c;
  const y0 = line.ny * line.c;
  const reach = Math.hypot(w, h);
  let sum = 0;
  let n = 0;
  for (let t = -reach; t <= reach; t += 2) {
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const ax = Math.round(x + line.nx * 3);
    const ay = Math.round(y + line.ny * 3);
    const bx = Math.round(x - line.nx * 3);
    const by = Math.round(y - line.ny * 3);
    if (
      ax < 0 ||
      ay < 0 ||
      bx < 0 ||
      by < 0 ||
      ax >= w ||
      bx >= w ||
      ay >= h ||
      by >= h
    )
      continue;
    sum += Math.abs(image.data[ay * w + ax]! - image.data[by * w + bx]!);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

export interface Detection {
  quad: Quad;
  /** 0–1. */
  score: number;
}

/**
 * Corners of the page in `photo` (grey, full resolution), or null when no
 * convincing page is found.
 */
export function detectPage(
  photo: Gray,
  options: DetectOptions = {},
): Detection | null {
  const { width, height } = fitSize(
    photo.width,
    photo.height,
    options.workSize ?? 480,
  );
  const small = blur(shrink(photo, width, height), 1.2);
  const edges = canny(small);
  // Paper edges separate bright paper from a darker background; texture and
  // table rules do not. Rank the lines by votes × mean contrast across them.
  const lines = houghLines(edges, 60)
    .map((l) => ({
      line: fromHough(l),
      strength: l.votes * crossContrast(small, fromHough(l)),
    }))
    .sort((a, b) => b.strength - a.strength);
  const horizontal: FitLine[] = [];
  const vertical: FitLine[] = [];
  for (const { line: f } of lines) {
    if (Math.abs(f.ny) > Math.abs(f.nx)) {
      if (horizontal.length < 12) horizontal.push(f);
    } else if (vertical.length < 12) vertical.push(f);
  }
  const minArea = 0.15 * width * height;
  const margin = 0.08;
  const within = (p: Point) =>
    p.x > -margin * width &&
    p.y > -margin * height &&
    p.x < (1 + margin) * width &&
    p.y < (1 + margin) * height;

  let best: { quad: Quad; score: number; lines: FitLine[] } | null = null;
  for (let i = 0; i < horizontal.length; i++)
    for (let j = i + 1; j < horizontal.length; j++)
      for (let k = 0; k < vertical.length; k++)
        for (let l = k + 1; l < vertical.length; l++) {
          const hs = [horizontal[i]!, horizontal[j]!];
          const vs = [vertical[k]!, vertical[l]!];
          const pts: Point[] = [];
          for (const a of hs)
            for (const b of vs) {
              const p = intersect(a, b);
              if (p) pts.push(p);
            }
          if (pts.length !== 4 || !pts.every(within)) continue;
          const quad = orderCorners(pts);
          if (!isConvex(quad)) continue;
          const area = quadArea(quad);
          if (area < minArea) continue;
          const center = {
            x: pts.reduce((s, p) => s + p.x, 0) / 4,
            y: pts.reduce((s, p) => s + p.y, 0) / 4,
          };
          let sides = 0;
          let perimeter = 0;
          for (let s = 0; s < 4; s++) {
            const a = quad[s]!;
            const b = quad[(s + 1) % 4]!;
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            sides += sideScore(edges, small, a, b, center) * len;
            perimeter += len;
          }
          const support = sides / perimeter;
          // Prefer the largest well-supported quad (inner rules of a table
          // are well supported too, but enclose less).
          const score =
            support * (0.85 + 0.15 * Math.sqrt(area / (width * height)));
          if (!best || score > best.score)
            best = { quad, score, lines: [...hs, ...vs] };
        }
  if (!best || best.score < (options.minScore ?? 0.55)) return null;

  // Refine each side on the edge pixels, then intersect again.
  const [tl, tr, br, bl] = best.quad;
  const sideLine = (a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const line = { nx: -dy / len, ny: dx / len, c: 0 };
    line.c = line.nx * a.x + line.ny * a.y;
    return refit(edges, line, a, b);
  };
  const top = sideLine(tl, tr);
  const right = sideLine(tr, br);
  const bottom = sideLine(br, bl);
  const left = sideLine(bl, tl);
  const refined = [
    intersect(top, left),
    intersect(top, right),
    intersect(bottom, right),
    intersect(bottom, left),
  ];
  let quad = best.quad;
  if (refined.every((p): p is Point => p !== null)) {
    const q = refined as Quad;
    // Keep the refinement only if it stays close.
    const moved = Math.max(
      ...q.map((p, i) => Math.hypot(p.x - quad[i]!.x, p.y - quad[i]!.y)),
    );
    if (isConvex(q) && moved < 0.03 * Math.hypot(width, height)) quad = q;
  }
  return {
    quad: quad.map((p) => ({
      x: (p.x * photo.width) / width,
      y: (p.y * photo.height) / height,
    })) as Quad,
    score: best.score,
  };
}
