/**
 * Curved pages (spec 029): straightens a sheet that is not flat (an open
 * book, a sheet that was folded or rolled) from its lines of text.
 *
 * Model. The homography of spec 002 maps the plane through the page's four
 * corners onto a rectangle. A sheet bent across its width (its height Z over
 * that plane depends on x only) is seen, through that homography, with each
 * point moved along the line from the camera's foot on the plane, by Z / (Hc −
 * Z) of its distance to it (Hc: the camera's height). So, with page
 * coordinates u, v in [−0.5, 0.5], a line of text (straight on paper) is seen
 * on a curve where v = V + P(u) + Q(u)·v, V constant along the line, Q = Z /
 * Hc and P = −Q·(the foot's v). P and Q are low-degree polynomials fitted by
 * linear least squares to the centre lines of the text. Q also gives the
 * slope of the sheet, hence the true (arc) length across it: text squeezed
 * where the sheet turns away from the camera is widened back.
 */
import {
  focalLength,
  homography,
  sampleInto,
  warp,
  type Point,
  type Quad,
} from "./homography";
import { areaMean, integral, toGray, type Gray, type Rgba } from "./image";

/** Degree of the polynomials P and Q. */
const DEGREE = 4;
/** Long side of the page image the text lines are looked for in, pixels. */
const WORK_SIZE = 1200;
/** Least bend of a line (share of the page height) worth straightening. */
export const MIN_BEND = 0.004;
/**
 * Most bend believed (share of the page height): an open book's lines bend a
 * few per cent. More is a fit to drawings or slanted strokes, not to text.
 */
export const MAX_BEND = 0.12;
/** Lines of text this long (share of the page width) are needed... */
const LONG_LINE = 0.45;
/** ...this many of them. */
const MIN_LONG_LINES = 3;
/** Least share of the page width the text must cover. */
const MIN_SPAN = 0.6;
/** Largest |P|, |Q| and lift on the page: a sheet, not a whirl. */
const MAX_SHAPE = 0.35;
/** Most the straightened page may be wider than the flat one. */
const MAX_STRETCH = 1.4;

/** A fitted sheet shape. */
export interface Curl {
  /** Coefficients of P and Q on the basis u^i − mean(u^i), i = 1…DEGREE. */
  p: number[];
  q: number[];
  /** Range of u with text; outside it P and Q go on in a straight line. */
  u0: number;
  u1: number;
  /** Largest bend of a line of text, share of the page height. */
  bend: number;
  /** Lines of text the fit used. */
  lines: number;
  /** Of them, the ones spanning LONG_LINE of the page width or more. */
  long: number;
  /** Spread of the lines about their own mean before and after the fit. */
  before: number;
  after: number;
}

/** Mean of u^i over [−0.5, 0.5]: the basis has no constant term. */
const basisMean = (i: number) => (i % 2 ? 0 : 2 * 0.5 ** (i + 1)) / (i + 1);

function basis(u: number, out: number[]): void {
  let power = 1;
  for (let i = 1; i <= DEGREE; i++) {
    power *= u;
    out[i - 1] = power - basisMean(i);
  }
}

function polyAt(c: number[], u: number): number {
  let sum = 0;
  let power = 1;
  for (let i = 1; i <= DEGREE; i++) {
    power *= u;
    sum += c[i - 1]! * (power - basisMean(i));
  }
  return sum;
}

function slopeAt(c: number[], u: number): number {
  let sum = 0;
  let power = 1;
  for (let i = 1; i <= DEGREE; i++) {
    sum += c[i - 1]! * i * power;
    power *= u;
  }
  return sum;
}

/** P or Q at `u`, in a straight line beyond the text. */
function curlAt(curl: Curl, c: number[], u: number): number {
  if (u < curl.u0)
    return polyAt(c, curl.u0) + slopeAt(c, curl.u0) * (u - curl.u0);
  if (u > curl.u1)
    return polyAt(c, curl.u1) + slopeAt(c, curl.u1) * (u - curl.u1);
  return polyAt(c, u);
}

function curlSlope(curl: Curl, c: number[], u: number): number {
  return slopeAt(c, Math.min(curl.u1, Math.max(curl.u0, u)));
}

/**
 * Height of the sheet over the corners' plane, over the camera's height (Q
 * up to its unknown constant and tilt: the sheet meets that plane at its left
 * and right edges).
 */
function liftAt(curl: Curl, u: number): number {
  const left = curlAt(curl, curl.q, -0.5);
  const right = curlAt(curl, curl.q, 0.5);
  return curlAt(curl, curl.q, u) - left - (right - left) * (u + 0.5);
}

function liftSlope(curl: Curl, u: number): number {
  return (
    curlSlope(curl, curl.q, u) -
    (curlAt(curl, curl.q, 0.5) - curlAt(curl, curl.q, -0.5))
  );
}

/**
 * Centre lines of the lines of text (and horizontal rules) of a page image,
 * as points in its pixels. Ink is smeared along rows so each line is one
 * band; the bands are cut into narrow columns and the pieces are chained
 * from left to right.
 */
export function textLines(page: Gray): Point[][] {
  const { width: w, height: h, data } = page;
  const table = integral(page);
  const r = Math.max(4, Math.round(w / 40));
  // The page's edge and its shadow are not text.
  const mx = Math.round(w * 0.03);
  const my = Math.round(h * 0.02);
  const ink = new Uint8Array(w * h);
  const gap = Math.max(3, Math.round(w * 0.02));
  for (let y = my; y < h - my; y++) {
    let last = -1;
    for (let x = mx; x < w - mx; x++) {
      const mean = areaMean(
        table,
        w,
        Math.max(0, x - r),
        Math.max(0, y - r),
        Math.min(w, x + r + 1),
        Math.min(h, y + r + 1),
      );
      const g = data[y * w + x]!;
      if (g < mean * 0.8 && g < mean - 20) {
        if (last >= 0 && x - last <= gap) ink.fill(1, y * w + last, y * w + x);
        ink[y * w + x] = 1;
        last = x;
      }
    }
  }

  const bin = Math.max(3, Math.round(w / 200));
  const maxThick = Math.max(4, h * 0.03);
  interface Chain {
    points: Point[];
    thick: number;
    bin: number;
  }
  const open: Chain[] = [];
  const done: Chain[] = [];
  const column = new Uint8Array(h);
  for (let b = 0; b * bin < w; b++) {
    const x0 = b * bin;
    const x1 = Math.min(w, x0 + bin);
    column.fill(0);
    for (let y = 0; y < h; y++)
      for (let x = x0; x < x1; x++)
        if (ink[y * w + x]) {
          column[y] = 1;
          break;
        }
    const taken = new Set<Chain>();
    for (let y = 0; y < h;) {
      if (!column[y]) {
        y++;
        continue;
      }
      const top = y;
      while (y < h && column[y]) y++;
      const thick = y - top;
      if (thick < 2 || thick > maxThick) continue;
      const centre = (top + y) / 2;
      let best: Chain | null = null;
      let bestDy = Infinity;
      for (const chain of open) {
        if (taken.has(chain) || b - chain.bin > 3) continue;
        const last = chain.points[chain.points.length - 1]!;
        const dy = Math.abs(last.y - centre);
        const ratio = thick / chain.thick;
        if (
          dy <= 0.6 * chain.thick + 1 &&
          ratio > 0.5 &&
          ratio < 2 &&
          dy < bestDy
        ) {
          best = chain;
          bestDy = dy;
        }
      }
      const point = { x: (x0 + x1) / 2, y: centre };
      if (best) {
        best.points.push(point);
        best.thick = 0.8 * best.thick + 0.2 * thick;
        best.bin = b;
        taken.add(best);
      } else {
        const chain = { points: [point], thick, bin: b };
        open.push(chain);
        taken.add(chain);
      }
    }
    for (let i = open.length - 1; i >= 0; i--)
      if (b - open[i]!.bin > 3) done.push(...open.splice(i, 1));
  }
  done.push(...open);

  const lines: Point[][] = [];
  for (const chain of done) {
    const pts = chain.points;
    if (pts.length < 10) continue;
    if (pts[pts.length - 1]!.x - pts[0]!.x < w * 0.12) continue;
    const kept = trimOutliers(pts);
    if (kept.length >= 8) lines.push(kept);
  }
  return lines;
}

/** Drops the points far from a parabola through the line. */
function trimOutliers(pts: Point[]): Point[] {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const sx = Math.max(1, Math.max(...pts.map((p) => Math.abs(p.x - cx))));
  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const rhs = [0, 0, 0];
  for (const p of pts) {
    const t = (p.x - cx) / sx;
    const f = [1, t, t * t];
    for (let i = 0; i < 3; i++) {
      rhs[i]! += f[i]! * p.y;
      for (let j = 0; j < 3; j++) a[i]![j]! += f[i]! * f[j]!;
    }
  }
  const c = solveSymmetric(a, rhs);
  if (!c) return pts;
  const res = pts.map((p) => {
    const t = (p.x - cx) / sx;
    return Math.abs(p.y - (c[0]! + c[1]! * t + c[2]! * t * t));
  });
  const limit = Math.max(1.5, 3 * 1.4826 * median(res));
  return pts.filter((_, i) => res[i]! <= limit);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Solves A x = b for a small symmetric positive matrix (Gaussian elimination). */
function solveSymmetric(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    if (Math.abs(m[p]![c]!) < 1e-15) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k <= n; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/**
 * Fits the sheet shape to lines of text found in a `width` × `height` page
 * image, or null when there are too few lines to tell.
 */
export function fitCurl(
  lines: Point[][],
  width: number,
  height: number,
): Curl | null {
  if (lines.length < 3) return null;
  const long = lines.filter(
    (line) => line[line.length - 1]!.x - line[0]!.x >= LONG_LINE * width,
  ).length;
  const n = 2 * DEGREE;
  const f = new Array<number>(DEGREE).fill(0);
  // Per line: features and v, each minus the line's mean (that removes V).
  let rows: { a: number[]; b: number; line: number }[] = [];
  let u0 = Infinity;
  let u1 = -Infinity;
  lines.forEach((line, k) => {
    const feats = line.map((p) => {
      const u = p.x / width - 0.5;
      const v = p.y / height - 0.5;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      basis(u, f);
      return { a: [...f, ...f.map((x) => x * v)], b: v };
    });
    for (const x of feats) rows.push({ ...x, line: k });
  });
  if (rows.length < 30) return null;

  let before = 0;
  let coef: number[] | null = null;
  for (let round = 0; round < 3; round++) {
    // Centre each line's rows.
    const groups = new Map<number, typeof rows>();
    for (const row of rows) {
      const g = groups.get(row.line);
      if (g) g.push(row);
      else groups.set(row.line, [row]);
    }
    const centred: { a: number[]; b: number; line: number }[] = [];
    for (const g of groups.values()) {
      if (g.length < 5) continue;
      const ma = new Array<number>(n).fill(0);
      let mb = 0;
      for (const row of g) {
        for (let i = 0; i < n; i++) ma[i]! += row.a[i]! / g.length;
        mb += row.b / g.length;
      }
      for (const row of g)
        centred.push({
          a: row.a.map((x, i) => x - ma[i]!),
          b: row.b - mb,
          line: row.line,
        });
    }
    if (groups.size < 3 || centred.length < 30) return null;
    if (round === 0)
      before = Math.sqrt(
        centred.reduce((s, r) => s + r.b * r.b, 0) / centred.length,
      );
    const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const atb = new Array<number>(n).fill(0);
    for (const { a, b } of centred)
      for (let i = 0; i < n; i++) {
        atb[i]! += a[i]! * b;
        for (let j = 0; j < n; j++) ata[i]![j]! += a[i]! * a[j]!;
      }
    let trace = 0;
    for (let i = 0; i < n; i++) trace += ata[i]![i]!;
    for (let i = 0; i < n; i++) ata[i]![i]! += 1e-6 * (trace / n) + 1e-12;
    coef = solveSymmetric(ata, atb);
    if (!coef) return null;
    const res = centred.map(({ a, b }) =>
      Math.abs(b - a.reduce((s, x, i) => s + x * coef![i]!, 0)),
    );
    const limit = Math.max(0.5 / height, 3 * 1.4826 * median(res));
    // Drop the outlying points; `centred` follows the groups' order.
    const kept: typeof rows = [];
    let index = 0;
    for (const g of groups.values()) {
      if (g.length < 5) continue;
      for (const row of g) {
        if (res[index]! <= limit) kept.push(row);
        index++;
      }
    }
    if (round === 2) {
      const after = Math.sqrt(
        res.reduce((s, x, i) => s + (res[i]! <= limit ? x * x : 0), 0) /
          Math.max(1, res.filter((x) => x <= limit).length),
      );
      const p = coef.slice(0, DEGREE);
      const q = coef.slice(DEGREE);
      const curl: Curl = {
        p,
        q,
        u0,
        u1,
        bend: 0,
        lines: groups.size,
        long,
        before,
        after,
      };
      curl.bend = bendOf(curl);
      return curl;
    }
    rows = kept;
  }
  return null;
}

/**
 * Largest bend of a line of the page over the text's width, share of the
 * page height. A tilt (the straight part) does not count.
 */
function bendOf(curl: Curl): number {
  let bend = 0;
  for (let v = -0.5; v <= 0.5001; v += 0.1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= 40; k++) {
      const u = curl.u0 + ((curl.u1 - curl.u0) * k) / 40;
      const d =
        polyAt(curl.p, u) +
        polyAt(curl.q, u) * v -
        (curl.p[0]! + curl.q[0]! * v) * u;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    bend = Math.max(bend, hi - lo);
  }
  return bend;
}

/**
 * A curl worth straightening: enough long lines across the page, a clear but
 * believable bend, a good fit and the shape of a sheet. Anything else (a
 * photo, drawings, a few words) is left flat.
 */
export function isCurled(curl: Curl | null): curl is Curl {
  return (
    !!curl &&
    curl.lines >= 3 &&
    curl.long >= MIN_LONG_LINES &&
    curl.u1 - curl.u0 >= MIN_SPAN &&
    curl.bend >= MIN_BEND &&
    curl.bend <= MAX_BEND &&
    curl.after < 0.6 * curl.before &&
    sheetLike(curl)
  );
}

/** P, Q and the lift stay small over the whole page. */
function sheetLike(curl: Curl): boolean {
  for (let k = 0; k <= 50; k++) {
    const u = -0.5 + k / 50;
    if (
      Math.abs(curlAt(curl, curl.p, u)) > MAX_SHAPE ||
      Math.abs(curlAt(curl, curl.q, u)) > MAX_SHAPE ||
      Math.abs(liftAt(curl, u)) > MAX_SHAPE
    )
      return false;
  }
  return true;
}

/**
 * Whether straightening with `curl` seen from `camera` gives a page: not much
 * wider than the flat one, and every column of the photo used once, in order
 * (no folds).
 */
export function warpsCleanly(
  curl: Curl,
  ratio: number,
  camera: CameraPose,
): boolean {
  if (flatRatio(curl, ratio, camera.height) > MAX_STRETCH * ratio) return false;
  let last = -Infinity;
  for (let k = 0; k <= 200; k++) {
    const u = -0.5 + k / 200;
    const lift = liftAt(curl, u);
    const seen = (u - camera.u * lift) / (1 - lift);
    if (!(seen > last) || Math.abs(seen) > 0.6) return false;
    last = seen;
  }
  return true;
}

/** The sheet's shape for the page inside `frame`, or null if it is flat. */
export function findCurl(photo: Rgba, frame: Quad, ratio: number): Curl | null {
  const ww = Math.round(ratio >= 1 ? WORK_SIZE : WORK_SIZE * ratio);
  const wh = Math.round(ratio >= 1 ? WORK_SIZE / ratio : WORK_SIZE);
  const page = toGray(warp(photo, frame, ww, wh));
  const curl = fitCurl(textLines(page), ww, wh);
  return isCurled(curl) ? curl : null;
}

/** Where the camera is, over the plane of the page's corners. */
export interface CameraPose {
  /** Its foot on that plane, in page coordinates (u, v in [−0.5, 0.5]). */
  u: number;
  v: number;
  /** Its height over the plane, in page heights. */
  height: number;
}

/**
 * The camera's pose relative to the page inside `frame`, from the
 * homography and the focal length the corners give (principal point at the
 * centre of the photo). A camera straight over the page's centre, at a usual
 * phone distance, when the photo is too frontal to tell.
 */
export function cameraPose(
  quad: Quad,
  frame: Quad,
  ratio: number,
  photoWidth: number,
  photoHeight: number,
): CameraPose {
  const fallback = { u: 0, v: 0, height: 1.2 };
  const f = focalLength(quad, photoWidth, photoHeight);
  if (!f) return fallback;
  const cx = photoWidth / 2;
  const cy = photoHeight / 2;
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: ratio, y: 0 },
      { x: ratio, y: 1 },
      { x: 0, y: 1 },
    ],
    frame.map((p) => ({ x: p.x - cx, y: p.y - cy })) as Quad,
  );
  if (!h) return fallback;
  // K⁻¹·H = λ·[r1 r2 t].
  const col = (j: number) => [h[j]! / f, h[3 + j]! / f, h[6 + j]!];
  let r1 = col(0);
  let r2 = col(1);
  let t = col(2);
  const norm = (a: number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
  // The page is in front of the camera: t_z > 0.
  const sign = t[2]! < 0 ? -1 : 1;
  const lambda = (2 * sign) / (norm(r1) + norm(r2));
  const n1 = norm(r1);
  const n2 = norm(r2);
  r1 = r1.map((x) => (x * sign) / n1);
  r2 = r2.map((x) => (x * sign) / n2);
  t = t.map((x) => x * lambda);
  const r3 = [
    r1[1]! * r2[2]! - r1[2]! * r2[1]!,
    r1[2]! * r2[0]! - r1[0]! * r2[2]!,
    r1[0]! * r2[1]! - r1[1]! * r2[0]!,
  ];
  const dot = (a: number[], b: number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  // The camera's centre in page coordinates: −Rᵀ·t.
  const pose = {
    u: -dot(r1, t) / ratio - 0.5,
    v: -dot(r2, t) - 0.5,
    height: Math.abs(dot(r3, t)),
  };
  if (![pose.u, pose.v, pose.height].every(Number.isFinite)) return fallback;
  pose.height = Math.min(5, Math.max(0.4, pose.height));
  return pose;
}

/** Arc length across the sheet, per unit of u, sampled on `steps`. */
function arcTable(
  curl: Curl,
  ratio: number,
  height: number,
  steps: number,
): Float64Array {
  const cum = new Float64Array(steps + 1);
  for (let k = 1; k <= steps; k++) {
    const u = -0.5 + (k - 0.5) / steps;
    const slope = Math.min(3, Math.abs((height * liftSlope(curl, u)) / ratio));
    cum[k] = cum[k - 1]! + Math.sqrt(1 + slope * slope) / steps;
  }
  return cum;
}

/**
 * Width / height of the flattened page: the chord's `ratio` stretched by the
 * arc length across the sheet. `height`: the camera's, in page heights.
 */
export function flatRatio(curl: Curl, ratio: number, height: number): number {
  const cum = arcTable(curl, ratio, height, 512);
  return ratio * cum[512]!;
}

/**
 * The page inside `frame` (the corner quad, in `src`) flattened to `width` ×
 * `height` pixels: lines of text straight, and the sheet's true width.
 * `ratio`: the chord's width / height.
 */
export function warpCurled(
  src: Rgba,
  frame: Quad,
  curl: Curl,
  ratio: number,
  camera: CameraPose,
  width: number,
  height: number,
): Rgba {
  const h = homography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    frame,
  )!;
  const steps = Math.max(512, width * 2);
  const cum = arcTable(curl, ratio, camera.height, steps);
  const total = cum[steps]!;
  // Per column: where it is seen across the page, and P and Q there.
  const colP = new Float64Array(width);
  const colQ = new Float64Array(width);
  const colU = new Float64Array(width);
  let k = 0;
  for (let x = 0; x < width; x++) {
    const s = ((x + 0.5) / width) * total;
    while (k < steps - 1 && cum[k + 1]! < s) k++;
    const t = (s - cum[k]!) / (cum[k + 1]! - cum[k]! || 1);
    const u = -0.5 + (k + t) / steps;
    // A raised point is seen further from the camera's foot.
    const lift = Math.min(0.5, Math.max(-0.5, liftAt(curl, u)));
    colU[x] = (u - camera.u * lift) / (1 - lift);
    colP[x] = curlAt(curl, curl.p, u);
    colQ[x] = curlAt(curl, curl.q, u);
  }
  // V of the top and bottom edges, from the corners.
  const lineV = (u: number, v: number) =>
    v - curlAt(curl, curl.p, u) - curlAt(curl, curl.q, u) * v;
  const top = (lineV(-0.5, -0.5) + lineV(0.5, -0.5)) / 2;
  const bottom = (lineV(-0.5, 0.5) + lineV(0.5, 0.5)) / 2;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const V = top + ((y + 0.5) / height) * (bottom - top);
    for (let x = 0; x < width; x++) {
      const px = colU[x]! + 0.5;
      const py = (V + colP[x]!) / (1 - colQ[x]!) + 0.5;
      const w = h[6] * px + h[7] * py + h[8];
      sampleInto(
        src,
        (h[0] * px + h[1] * py + h[2]) / w - 0.5,
        (h[3] * px + h[4] * py + h[5]) / w - 0.5,
        out,
        (y * width + x) * 4,
      );
    }
  }
  return { width, height, data: out };
}
